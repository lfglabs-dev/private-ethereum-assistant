import fs from "node:fs";
import path from "node:path";
import leveldown from "leveldown";
import { groth16 } from "snarkjs";
import { ByteUtils, Mnemonic } from "@railgun-community/engine";
import {
  ArtifactStore,
  awaitWalletScan,
  balanceForERC20Token,
  createRailgunWallet,
  fullWalletForID,
  gasEstimateForShield,
  gasEstimateForShieldBaseToken,
  gasEstimateForUnprovenTransfer,
  gasEstimateForUnprovenUnshield,
  gasEstimateForUnprovenUnshieldBaseToken,
  generateTransferProof,
  generateUnshieldBaseTokenProof,
  generateUnshieldProof,
  getProver,
  getSerializedERC20Balances,
  getShieldPrivateKeySignatureMessage,
  loadProvider,
  loadWalletByID,
  populateProvedTransfer,
  populateProvedUnshield,
  populateProvedUnshieldBaseToken,
  populateShield,
  populateShieldBaseToken,
  refreshBalances,
  setBatchListCallback,
  setOnTXIDMerkletreeScanCallback,
  setOnUTXOMerkletreeScanCallback,
  setOnWalletPOIProofProgressCallback,
  startRailgunEngine,
  type SnarkJSGroth16,
} from "@railgun-community/wallet";
import {
  EVMGasType,
  type MerkletreeScanUpdateEvent,
  NETWORK_CONFIG,
  NetworkName,
  type POIProofProgressEvent,
  TXIDVersion,
  type TransactionGasDetails,
} from "@railgun-community/shared-models";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseUnits,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { config } from "./config";
import type { RuntimeConfig } from "./runtime-config";

const RAILGUN_NETWORK = NetworkName.Arbitrum;
const RAILGUN_TXID_VERSION = TXIDVersion.V2_PoseidonMerkle;
const RAILGUN_CHAIN = NETWORK_CONFIG[RAILGUN_NETWORK].chain;
const RAILGUN_DIR = path.join(process.cwd(), ".context", "railgun");
const RAILGUN_DB_PATH = path.join(RAILGUN_DIR, "db");
const RAILGUN_WALLET_META_PATH = path.join(RAILGUN_DIR, "wallet.json");

const TOKEN_ALIASES: Record<string, `0x${string}`> = {
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

type WalletMeta = {
  fingerprint: string;
  walletId: string;
  railgunAddress: string;
};

type ProofStage = {
  progress: number;
  status: string;
};

type RailgunToken = {
  tokenAddress: `0x${string}`;
  symbol: string;
  decimals: number;
  isNative: boolean;
};

type RailgunRuntimeState = {
  utxoScan?: MerkletreeScanUpdateEvent;
  txidScan?: MerkletreeScanUpdateEvent;
  poiProof?: POIProofProgressEvent;
  poiBatch?: {
    current: number;
    total: number;
    percent: number;
    status: string;
  };
  lastSyncAt?: string;
};

type RailgunRuntime = {
  walletId: string;
  railgunAddress: string;
  encryptionKey: string;
  state: RailgunRuntimeState;
};

export type RailgunToolRuntimeConfig = RuntimeConfig["railgun"] & {
  signerPrivateKey: string;
};

type RailgunBalanceRow = {
  tokenAddress: string;
  symbol: string;
  amount: string;
  rawAmount: string;
};

type RailgunOperationStage = {
  label: string;
  status: "completed" | "skipped";
  detail?: string;
};

type RailgunResult =
  | {
      railgun: true;
      status: "success";
      operation: "balance";
      network: string;
      railgunAddress: string;
      scan: RailgunRuntimeState;
      balances: RailgunBalanceRow[];
    }
  | {
      railgun: true;
      status: "success";
      operation: "shield" | "transfer" | "unshield";
      network: string;
      railgunAddress: string;
      token: string;
      amount: string;
      recipient?: string;
      txHash: string;
      explorerUrl: string;
      stages: RailgunOperationStage[];
      proofProgress?: ProofStage[];
      shieldedBalanceAfter?: string;
      publicBalanceAfter?: string;
      approvalTxHash?: string;
      privacyNote: string;
      scan: RailgunRuntimeState;
    }
  | {
      railgun: true;
      status: "error";
      operation: "balance" | "shield" | "transfer" | "unshield";
      network: string;
      message: string;
      setup?: string[];
    };

let initPromise: Promise<RailgunRuntime> | undefined;
const runtimeState: RailgunRuntimeState = {};
let operationQueue: Promise<void> = Promise.resolve();
let engineStarted = false;

function createDefaultRailgunToolRuntimeConfig(): RailgunToolRuntimeConfig {
  return {
    networkLabel: config.railgun.networkLabel,
    rpcUrl: config.railgun.rpcUrl,
    chainId: config.railgun.chainId,
    explorerTxBaseUrl: config.railgun.explorerTxBaseUrl,
    poiNodeUrls: config.railgun.poiNodeUrls,
    mnemonic: config.railgun.mnemonic || "",
    signerPrivateKey: config.railgun.signerPrivateKey || "",
    walletCreationBlock: config.railgun.walletCreationBlock,
    scanTimeoutMs: config.railgun.scanTimeoutMs,
    pollingIntervalMs: config.railgun.pollingIntervalMs,
  };
}

let currentConfig = createDefaultRailgunToolRuntimeConfig();
let currentConfigFingerprint = JSON.stringify(currentConfig);
let publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(currentConfig.rpcUrl),
});

function resetRuntimeState() {
  runtimeState.utxoScan = undefined;
  runtimeState.txidScan = undefined;
  runtimeState.poiProof = undefined;
  runtimeState.poiBatch = undefined;
  runtimeState.lastSyncAt = undefined;
}

function setRailgunToolRuntimeConfig(nextConfig: RailgunToolRuntimeConfig) {
  const fingerprint = JSON.stringify({
    ...nextConfig,
    poiNodeUrls: [...nextConfig.poiNodeUrls],
  });

  if (fingerprint === currentConfigFingerprint) {
    return;
  }

  currentConfig = nextConfig;
  currentConfigFingerprint = fingerprint;
  initPromise = undefined;
  operationQueue = Promise.resolve();
  resetRuntimeState();
  publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(currentConfig.rpcUrl),
  });
}

const withRailgunLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = operationQueue;
  let release!: () => void;
  operationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await fn();
  } finally {
    release();
  }
};

const ensureContextDir = async () => {
  await fs.promises.mkdir(RAILGUN_DIR, { recursive: true });
};

const resolveRailgunStoragePath = (targetPath: string) =>
  path.isAbsolute(targetPath) ? targetPath : path.join(RAILGUN_DIR, targetPath);

const fileExists = async (targetPath: string) => {
  try {
    await fs.promises.access(resolveRailgunStoragePath(targetPath));
    return true;
  } catch {
    return false;
  }
};

const artifactStore = new ArtifactStore(
  async (targetPath) => {
    try {
      return await fs.promises.readFile(resolveRailgunStoragePath(targetPath));
    } catch {
      return null;
    }
  },
  async (dir, targetPath, data) => {
    await fs.promises.mkdir(resolveRailgunStoragePath(dir), { recursive: true });
    await fs.promises.writeFile(resolveRailgunStoragePath(targetPath), data);
  },
  fileExists,
);

const clearRailgunSecrets = () => [
  "Set a dedicated Railgun mnemonic in browser settings, or leave it blank to derive one from the configured EOA private key for testing.",
  "Set an EOA private key in browser settings if you want the assistant to submit Arbitrum transactions on your behalf.",
  "Optionally change the Railgun RPC URL and POI node URLs in settings if you want custom infrastructure.",
];

const snapshotState = (): RailgunRuntimeState =>
  JSON.parse(JSON.stringify(runtimeState)) as RailgunRuntimeState;

const getSignerPrivateKey = (): `0x${string}` => {
  const privateKey = currentConfig.signerPrivateKey.trim();

  if (!privateKey) {
    throw new Error(
      "Missing EOA private key for Arbitrum transaction signing. Add it in browser settings first.",
    );
  }

  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
};

const getSignerAccount = () => privateKeyToAccount(getSignerPrivateKey());

const getWalletClient = () =>
  createWalletClient({
    account: getSignerAccount(),
    chain: arbitrum,
    transport: http(currentConfig.rpcUrl),
  });

const deriveRailgunMnemonic = () => {
  const explicitMnemonic = currentConfig.mnemonic.trim();
  if (explicitMnemonic) {
    return explicitMnemonic;
  }

  const privateKey = currentConfig.signerPrivateKey.trim();
  if (privateKey) {
    return Mnemonic.fromEntropy(ByteUtils.strip0x(privateKey));
  }

  throw new Error(
    "Missing Railgun mnemonic and EOA private key. Add one of them in browser settings first.",
  );
};

const deriveEncryptionKey = (mnemonic: string) =>
  keccak256(stringToHex(`railgun-db:${mnemonic}`)).slice(2);

const getWalletFingerprint = (mnemonic: string) =>
  keccak256(stringToHex(`railgun-wallet:${mnemonic}`));

const loadWalletMeta = async (): Promise<WalletMeta | null> => {
  if (!(await fileExists(RAILGUN_WALLET_META_PATH))) {
    return null;
  }

  const raw = await fs.promises.readFile(RAILGUN_WALLET_META_PATH, "utf8");
  return JSON.parse(raw) as WalletMeta;
};

const saveWalletMeta = async (meta: WalletMeta) => {
  await ensureContextDir();
  await fs.promises.writeFile(
    RAILGUN_WALLET_META_PATH,
    JSON.stringify(meta, null, 2),
  );
};

const initializeCallbacks = () => {
  setOnUTXOMerkletreeScanCallback((scanData) => {
    runtimeState.utxoScan = scanData;
  });

  setOnTXIDMerkletreeScanCallback((scanData) => {
    runtimeState.txidScan = scanData;
  });

  setOnWalletPOIProofProgressCallback((poiProof) => {
    runtimeState.poiProof = poiProof;
  });

  setBatchListCallback((batch) => {
    runtimeState.poiBatch = batch;
  });
};

const waitForTxidScanIfRequired = async () => {
  const deadline = Date.now() + currentConfig.scanTimeoutMs;

  while (Date.now() < deadline) {
    if (runtimeState.txidScan?.scanStatus === "Complete") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Railgun TXID scan timed out before private balances were ready.");
};

const syncWalletState = async (runtime: RailgunRuntime) => {
  await refreshBalances(RAILGUN_CHAIN, [runtime.walletId]);
  await Promise.race([
    awaitWalletScan(runtime.walletId, RAILGUN_CHAIN),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Railgun wallet scan timed out.")),
        currentConfig.scanTimeoutMs,
      ),
    ),
  ]);
  await waitForTxidScanIfRequired();
  runtimeState.lastSyncAt = new Date().toISOString();
};

const createFallbackProviderConfig = () => ({
  chainId: currentConfig.chainId,
  providers: [
    {
      provider: currentConfig.rpcUrl,
      priority: 1,
      weight: 2,
      maxLogsPerBatch: 32,
      stallTimeout: 5_000,
    },
  ],
});

const initializeRailgun = async (): Promise<RailgunRuntime> => {
  await ensureContextDir();

  const mnemonic = deriveRailgunMnemonic();
  const fingerprint = getWalletFingerprint(mnemonic);
  const encryptionKey = deriveEncryptionKey(mnemonic);

  if (!engineStarted) {
    await startRailgunEngine(
      "railgunchat",
      leveldown(RAILGUN_DB_PATH),
      false,
      artifactStore,
      false,
      false,
      currentConfig.poiNodeUrls,
    );
    engineStarted = true;
  }

  initializeCallbacks();
  getProver().setSnarkJSGroth16(groth16 as SnarkJSGroth16);

  await loadProvider(
    createFallbackProviderConfig(),
    RAILGUN_NETWORK,
    currentConfig.pollingIntervalMs,
  );

  const existingMeta = await loadWalletMeta();
  const creationBlockNumbers = {
    [RAILGUN_NETWORK]: currentConfig.walletCreationBlock,
  };

  const walletInfo =
    existingMeta && existingMeta.fingerprint === fingerprint
      ? await loadWalletByID(encryptionKey, existingMeta.walletId, false)
      : await createRailgunWallet(encryptionKey, mnemonic, creationBlockNumbers);

  const meta: WalletMeta = {
    fingerprint,
    walletId: walletInfo.id,
    railgunAddress: walletInfo.railgunAddress,
  };

  await saveWalletMeta(meta);

  return {
    walletId: walletInfo.id,
    railgunAddress: walletInfo.railgunAddress,
    encryptionKey,
    state: runtimeState,
  };
};

const getRuntime = async () => {
  if (!initPromise) {
    initPromise = initializeRailgun().catch((error) => {
      initPromise = undefined;
      throw error;
    });
  }

  return initPromise;
};

const explorerUrlForTx = (txHash: string) =>
  `${currentConfig.explorerTxBaseUrl}${txHash}`;

const isNativeToken = (token: string) => token.trim().toUpperCase() === "ETH";

const getTokenAliasAddress = (token: string) => {
  const alias = TOKEN_ALIASES[token.trim().toUpperCase()];
  return alias ? getAddress(alias) : null;
};

const getTokenMetadata = async (tokenAddress: `0x${string}`) => {
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  return {
    symbol,
    decimals,
  };
};

const resolveToken = async (token: string): Promise<RailgunToken> => {
  if (isNativeToken(token)) {
    return {
      tokenAddress: getAddress(
        NETWORK_CONFIG[RAILGUN_NETWORK].baseToken.wrappedAddress,
      ) as `0x${string}`,
      symbol: "ETH",
      decimals: NETWORK_CONFIG[RAILGUN_NETWORK].baseToken.decimals,
      isNative: true,
    };
  }

  const aliasAddress = getTokenAliasAddress(token);
  const rawAddress = aliasAddress ?? token.trim();

  if (!rawAddress.startsWith("0x")) {
    throw new Error(
      "Token symbols are only supported for ETH and USDC right now. For other tokens, pass the Arbitrum token contract address.",
    );
  }

  const tokenAddress = getAddress(rawAddress) as `0x${string}`;
  const metadata = await getTokenMetadata(tokenAddress);

  return {
    tokenAddress,
    symbol: metadata.symbol,
    decimals: metadata.decimals,
    isNative: false,
  };
};

const parseTokenAmount = (amount: string, decimals: number) => {
  try {
    return parseUnits(amount, decimals);
  } catch {
    throw new Error(`Invalid amount: ${amount}`);
  }
};

const getGasDetails = async (gasEstimate: bigint): Promise<TransactionGasDetails> => {
  const fees = await publicClient.estimateFeesPerGas();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? BigInt(0);

  if (!maxFeePerGas) {
    throw new Error("Could not determine Arbitrum gas fees.");
  }

  return {
    evmGasType: EVMGasType.Type2,
    gasEstimate,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
};

const toBigIntValue = (value: bigint | number | string | null | undefined) => {
  if (value == null) {
    return undefined;
  }

  return typeof value === "bigint" ? value : BigInt(value.toString());
};

const submitContractTransaction = async (transaction: {
  to?: string | null;
  data?: string | null;
  value?: bigint | number | string | null;
  gasLimit?: bigint | number | string | null;
  gasPrice?: bigint | number | string | null;
  maxFeePerGas?: bigint | number | string | null;
  maxPriorityFeePerGas?: bigint | number | string | null;
  nonce?: number | null;
}) => {
  const walletClient = getWalletClient();
  const account = getSignerAccount();

  if (!transaction.to) {
    throw new Error("Railgun returned a transaction without a destination.");
  }

  const baseRequest = {
    account,
    chain: arbitrum,
    to: getAddress(transaction.to),
    data: transaction.data ? (transaction.data as `0x${string}`) : undefined,
    value: toBigIntValue(transaction.value),
    gas: toBigIntValue(transaction.gasLimit),
    nonce: transaction.nonce ?? undefined,
  } as const;

  const maxFeePerGas = toBigIntValue(transaction.maxFeePerGas);
  const maxPriorityFeePerGas = toBigIntValue(transaction.maxPriorityFeePerGas);
  const gasPrice = toBigIntValue(transaction.gasPrice);

  const txHash =
    maxFeePerGas != null || maxPriorityFeePerGas != null
      ? await walletClient.sendTransaction({
          ...baseRequest,
          maxFeePerGas,
          maxPriorityFeePerGas: maxPriorityFeePerGas ?? BigInt(0),
        })
      : await walletClient.sendTransaction({
          ...baseRequest,
          gasPrice,
        });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return txHash;
};

const ensureAllowance = async (
  token: RailgunToken,
  amount: bigint,
): Promise<`0x${string}` | undefined> => {
  if (token.isNative) {
    return undefined;
  }

  const account = getSignerAccount();
  const walletClient = getWalletClient();
  const spender = getAddress(NETWORK_CONFIG[RAILGUN_NETWORK].proxyContract);
  const allowance = await publicClient.readContract({
    address: token.tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, spender],
  });

  if (allowance >= amount) {
    return undefined;
  }

  const approvalTxHash = await walletClient.writeContract({
    account,
    chain: arbitrum,
    address: token.tokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxUint256],
  });

  await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
  return approvalTxHash;
};

const getShieldPrivateKey = async () => {
  const walletClient = getWalletClient();
  const account = getSignerAccount();
  const signature = await walletClient.signMessage({
    account,
    message: getShieldPrivateKeySignatureMessage(),
  });

  return keccak256(signature);
};

const getShieldedBalanceForToken = async (runtime: RailgunRuntime, token: RailgunToken) => {
  const wallet = fullWalletForID(runtime.walletId);
  const amount = await balanceForERC20Token(
    RAILGUN_TXID_VERSION,
    wallet,
    RAILGUN_NETWORK,
    token.tokenAddress,
    true,
  );

  return formatUnits(amount, token.decimals);
};

const getPublicBalanceForToken = async (recipientAddress: `0x${string}`, token: RailgunToken) => {
  if (token.isNative) {
    const balance = await publicClient.getBalance({ address: recipientAddress });
    return formatUnits(balance, token.decimals);
  }

  const balance = await publicClient.readContract({
    address: token.tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipientAddress],
  });

  return formatUnits(balance, token.decimals);
};

const dedupeProofStages = (stages: ProofStage[]) => {
  const uniqueStages: ProofStage[] = [];

  for (const stage of stages) {
    const previous = uniqueStages[uniqueStages.length - 1];
    if (
      previous &&
      previous.status === stage.status &&
      previous.progress === stage.progress
    ) {
      continue;
    }
    uniqueStages.push(stage);
  }

  return uniqueStages;
};

const buildErrorResult = (
  operation: RailgunResult["operation"],
  error: unknown,
): Extract<RailgunResult, { status: "error" }> => {
  const message =
    error instanceof Error ? error.message : "Unknown Railgun error occurred.";

  return {
    railgun: true,
    status: "error",
    operation,
    network: currentConfig.networkLabel,
    message,
    setup: clearRailgunSecrets(),
  };
};

export async function railgunBalance(
  token?: string,
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<RailgunResult> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return withRailgunLock(async () => {
    try {
      const runtime = await getRuntime();
      await syncWalletState(runtime);
      const wallet = fullWalletForID(runtime.walletId);
      const balances = await wallet.getTokenBalances(
        RAILGUN_TXID_VERSION,
        RAILGUN_CHAIN,
        true,
      );

      const serialized = getSerializedERC20Balances(balances);
      const rows = await Promise.all(
        serialized.map(async (balance) => {
          const isWrappedNative =
            getAddress(balance.tokenAddress) ===
            getAddress(NETWORK_CONFIG[RAILGUN_NETWORK].baseToken.wrappedAddress);

          const metadata = isWrappedNative
            ? {
                symbol: "ETH",
                decimals: NETWORK_CONFIG[RAILGUN_NETWORK].baseToken.decimals,
              }
            : await getTokenMetadata(getAddress(balance.tokenAddress) as `0x${string}`);

          return {
            tokenAddress: balance.tokenAddress,
            symbol: metadata.symbol,
            amount: formatUnits(balance.amount, metadata.decimals),
            rawAmount: balance.amount.toString(),
          };
        }),
      );

      let filteredBalances = rows;
      if (token) {
        const resolvedToken = await resolveToken(token);
        filteredBalances = rows.filter(
          (row) =>
            getAddress(row.tokenAddress) === getAddress(resolvedToken.tokenAddress),
        );
      }

      return {
        railgun: true,
        status: "success",
        operation: "balance",
        network: currentConfig.networkLabel,
        railgunAddress: runtime.railgunAddress,
        scan: snapshotState(),
        balances: filteredBalances,
      };
    } catch (error) {
      return buildErrorResult("balance", error);
    }
  });
}

export async function railgunShield(
  token: string,
  amount: string,
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<RailgunResult> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return withRailgunLock(async () => {
    try {
      const runtime = await getRuntime();
      const resolvedToken = await resolveToken(token);
      const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
      const stages: RailgunOperationStage[] = [];

      await syncWalletState(runtime);
      stages.push({
        label: "Wallet sync complete",
        status: "completed",
        detail: runtime.state.lastSyncAt,
      });

      const approvalTxHash = await ensureAllowance(resolvedToken, amountRaw);
      stages.push({
        label: resolvedToken.isNative ? "Token approval" : "Token approval ready",
        status: approvalTxHash ? "completed" : "skipped",
        detail: approvalTxHash,
      });

      const shieldPrivateKey = await getShieldPrivateKey();
      const gasEstimate = resolvedToken.isNative
        ? await gasEstimateForShieldBaseToken(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            runtime.railgunAddress,
            shieldPrivateKey,
            {
              tokenAddress: resolvedToken.tokenAddress,
              amount: amountRaw,
            },
            getSignerAccount().address,
          )
        : await gasEstimateForShield(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            shieldPrivateKey,
            [
              {
                tokenAddress: resolvedToken.tokenAddress,
                amount: amountRaw,
                recipientAddress: runtime.railgunAddress,
              },
            ],
            [],
            getSignerAccount().address,
          );
      const gasDetails = await getGasDetails(gasEstimate.gasEstimate);

      const populated = resolvedToken.isNative
        ? await populateShieldBaseToken(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            runtime.railgunAddress,
            shieldPrivateKey,
            {
              tokenAddress: resolvedToken.tokenAddress,
              amount: amountRaw,
            },
            gasDetails,
          )
        : await populateShield(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            shieldPrivateKey,
            [
              {
                tokenAddress: resolvedToken.tokenAddress,
                amount: amountRaw,
                recipientAddress: runtime.railgunAddress,
              },
            ],
            [],
            gasDetails,
          );
      stages.push({
        label: "Shield transaction prepared",
        status: "completed",
      });

      const txHash = await submitContractTransaction(populated.transaction);
      stages.push({
        label: "Shield transaction confirmed",
        status: "completed",
        detail: txHash,
      });

      await syncWalletState(runtime);
      const shieldedBalanceAfter = await getShieldedBalanceForToken(runtime, resolvedToken);
      stages.push({
        label: "Shielded balance refreshed",
        status: "completed",
        detail: shieldedBalanceAfter,
      });

      return {
        railgun: true,
        status: "success",
        operation: "shield",
        network: currentConfig.networkLabel,
        railgunAddress: runtime.railgunAddress,
        token: resolvedToken.symbol,
        amount,
        txHash,
        explorerUrl: explorerUrlForTx(txHash),
        approvalTxHash,
        stages,
        shieldedBalanceAfter,
        privacyNote:
          "This deposit is public on Arbitrum, but once shielded the resulting private balance can be spent without publicly linking future Railgun transfers to the deposit address.",
        scan: snapshotState(),
      };
    } catch (error) {
      return buildErrorResult("shield", error);
    }
  });
}

export async function railgunTransfer(
  recipient: string,
  token: string,
  amount: string,
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<RailgunResult> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return withRailgunLock(async () => {
    const proofProgress: ProofStage[] = [];

    try {
      const runtime = await getRuntime();
      const normalizedRecipient = recipient.trim();
      if (!normalizedRecipient.startsWith("0zk")) {
        throw new Error(
          "Railgun private transfers require a 0zk recipient. For ENS names or public 0x addresses, resolve ENS first and use railgun_unshield instead.",
        );
      }
      const resolvedToken = await resolveToken(token);
      const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
      const stages: RailgunOperationStage[] = [];

      await syncWalletState(runtime);
      stages.push({
        label: "Wallet sync complete",
        status: "completed",
        detail: runtime.state.lastSyncAt,
      });

      const spendableBalance = await getShieldedBalanceForToken(runtime, resolvedToken);
      const spendableBalanceRaw = parseTokenAmount(spendableBalance, resolvedToken.decimals);
      if (spendableBalanceRaw < amountRaw) {
        throw new Error(
          `Insufficient shielded balance. Available: ${spendableBalance} ${resolvedToken.symbol}.`,
        );
      }

      const originalGasDetails = await getGasDetails(BigInt(0));
      const gasEstimate = await gasEstimateForUnprovenTransfer(
        RAILGUN_TXID_VERSION,
        RAILGUN_NETWORK,
        runtime.walletId,
        runtime.encryptionKey,
        undefined,
        [
          {
            tokenAddress: resolvedToken.tokenAddress,
            amount: amountRaw,
            recipientAddress: normalizedRecipient,
          },
        ],
        [],
        originalGasDetails,
        undefined,
        true,
      );
      const gasDetails = await getGasDetails(gasEstimate.gasEstimate);
      stages.push({
        label: "Gas estimated",
        status: "completed",
        detail: gasEstimate.gasEstimate.toString(),
      });

      await generateTransferProof(
        RAILGUN_TXID_VERSION,
        RAILGUN_NETWORK,
        runtime.walletId,
        runtime.encryptionKey,
        false,
        undefined,
        [
          {
            tokenAddress: resolvedToken.tokenAddress,
            amount: amountRaw,
            recipientAddress: normalizedRecipient,
          },
        ],
        [],
        undefined,
        true,
        undefined,
        (progress, status) => {
          proofProgress.push({ progress, status });
        },
      );
      stages.push({
        label: "Zero-knowledge proof generated",
        status: "completed",
      });

      const populated = await populateProvedTransfer(
        RAILGUN_TXID_VERSION,
        RAILGUN_NETWORK,
        runtime.walletId,
        false,
        undefined,
        [
          {
            tokenAddress: resolvedToken.tokenAddress,
            amount: amountRaw,
            recipientAddress: normalizedRecipient,
          },
        ],
        [],
        undefined,
        true,
        undefined,
        gasDetails,
      );

      const txHash = await submitContractTransaction(populated.transaction);
      stages.push({
        label: "Private transfer confirmed",
        status: "completed",
        detail: txHash,
      });

      await syncWalletState(runtime);
      const shieldedBalanceAfter = await getShieldedBalanceForToken(runtime, resolvedToken);
      stages.push({
        label: "Shielded balance refreshed",
        status: "completed",
        detail: shieldedBalanceAfter,
      });

      return {
        railgun: true,
        status: "success",
        operation: "transfer",
        network: currentConfig.networkLabel,
        railgunAddress: runtime.railgunAddress,
        token: resolvedToken.symbol,
        amount,
        recipient: normalizedRecipient,
        txHash,
        explorerUrl: explorerUrlForTx(txHash),
        stages,
        proofProgress: dedupeProofStages(proofProgress),
        shieldedBalanceAfter,
        privacyNote:
          "The Railgun transfer occurs privately. Observers can see the Arbitrum transaction, but they should not be able to link the sender, recipient 0zk address, token, and amount the way they can with a public ERC-20 transfer.",
        scan: snapshotState(),
      };
    } catch (error) {
      return buildErrorResult("transfer", error);
    }
  });
}

export async function railgunUnshield(
  recipient: string,
  token: string,
  amount: string,
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<RailgunResult> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return withRailgunLock(async () => {
    const proofProgress: ProofStage[] = [];

    try {
      const runtime = await getRuntime();
      const resolvedToken = await resolveToken(token);
      const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
      const stages: RailgunOperationStage[] = [];
      const recipientAddress = getAddress(recipient) as `0x${string}`;

      await syncWalletState(runtime);
      stages.push({
        label: "Wallet sync complete",
        status: "completed",
        detail: runtime.state.lastSyncAt,
      });

      const spendableBalance = await getShieldedBalanceForToken(runtime, resolvedToken);
      const spendableBalanceRaw = parseTokenAmount(spendableBalance, resolvedToken.decimals);
      if (spendableBalanceRaw < amountRaw) {
        throw new Error(
          `Insufficient shielded balance. Available: ${spendableBalance} ${resolvedToken.symbol}.`,
        );
      }

      const originalGasDetails = await getGasDetails(BigInt(0));
      const gasEstimate = resolvedToken.isNative
        ? await gasEstimateForUnprovenUnshieldBaseToken(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            recipientAddress,
            runtime.walletId,
            runtime.encryptionKey,
            {
              tokenAddress: resolvedToken.tokenAddress,
              amount: amountRaw,
            },
            originalGasDetails,
            undefined,
            true,
          )
        : await gasEstimateForUnprovenUnshield(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            runtime.walletId,
            runtime.encryptionKey,
            [
              {
                tokenAddress: resolvedToken.tokenAddress,
                amount: amountRaw,
                recipientAddress,
              },
            ],
            [],
            originalGasDetails,
            undefined,
            true,
          );
      const gasDetails = await getGasDetails(gasEstimate.gasEstimate);
      stages.push({
        label: "Gas estimated",
        status: "completed",
        detail: gasEstimate.gasEstimate.toString(),
      });

      if (resolvedToken.isNative) {
        await generateUnshieldBaseTokenProof(
          RAILGUN_TXID_VERSION,
          RAILGUN_NETWORK,
          recipientAddress,
          runtime.walletId,
          runtime.encryptionKey,
          {
            tokenAddress: resolvedToken.tokenAddress,
            amount: amountRaw,
          },
          undefined,
          true,
          undefined,
          (progress, status) => {
            proofProgress.push({ progress, status });
          },
        );
      } else {
        await generateUnshieldProof(
          RAILGUN_TXID_VERSION,
          RAILGUN_NETWORK,
          runtime.walletId,
          runtime.encryptionKey,
          [
            {
              tokenAddress: resolvedToken.tokenAddress,
              amount: amountRaw,
              recipientAddress,
            },
          ],
          [],
          undefined,
          true,
          undefined,
          (progress, status) => {
            proofProgress.push({ progress, status });
          },
        );
      }
      stages.push({
        label: "Zero-knowledge proof generated",
        status: "completed",
      });

      const populated = resolvedToken.isNative
        ? await populateProvedUnshieldBaseToken(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            recipientAddress,
            runtime.walletId,
            {
              tokenAddress: resolvedToken.tokenAddress,
              amount: amountRaw,
            },
            undefined,
            true,
            undefined,
            gasDetails,
          )
        : await populateProvedUnshield(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            runtime.walletId,
            [
              {
                tokenAddress: resolvedToken.tokenAddress,
                amount: amountRaw,
                recipientAddress,
              },
            ],
            [],
            undefined,
            true,
            undefined,
            gasDetails,
          );

      const txHash = await submitContractTransaction(populated.transaction);
      stages.push({
        label: "Unshield transaction confirmed",
        status: "completed",
        detail: txHash,
      });

      await syncWalletState(runtime);
      const shieldedBalanceAfter = await getShieldedBalanceForToken(runtime, resolvedToken);
      const publicBalanceAfter = await getPublicBalanceForToken(
        recipientAddress,
        resolvedToken,
      );
      stages.push({
        label: "Balances refreshed",
        status: "completed",
        detail: `${shieldedBalanceAfter} private / ${publicBalanceAfter} public`,
      });

      return {
        railgun: true,
        status: "success",
        operation: "unshield",
        network: currentConfig.networkLabel,
        railgunAddress: runtime.railgunAddress,
        token: resolvedToken.symbol,
        amount,
        recipient: recipientAddress,
        txHash,
        explorerUrl: explorerUrlForTx(txHash),
        stages,
        proofProgress: dedupeProofStages(proofProgress),
        shieldedBalanceAfter,
        publicBalanceAfter,
        privacyNote:
          "This exits the Railgun privacy pool. The unshield target address and resulting public balance become visible on Arbitrum after confirmation.",
        scan: snapshotState(),
      };
    } catch (error) {
      return buildErrorResult("unshield", error);
    }
  });
}
