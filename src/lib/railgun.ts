import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import leveldown from "leveldown";
import { groth16 } from "snarkjs";
import {
  ByteUtils,
  Mnemonic,
} from "@railgun-community/engine";
import {
  ArtifactStore,
  balanceForERC20Token,
  createRailgunWallet,
  fullWalletForID,
  gasEstimateForShield,
  gasEstimateForShieldBaseToken,
  gasEstimateForUnprovenTransfer,
  gasEstimateForUnprovenUnshield,
  generateTransferProof,
  generateUnshieldProof,
  getProver,
  getSerializedERC20Balances,
  getShieldPrivateKeySignatureMessage,
  loadProvider,
  loadWalletByID,
  populateProvedTransfer,
  populateProvedUnshield,
  populateShield,
  populateShieldBaseToken,
  refreshBalances,
  rescanFullUTXOMerkletreesAndWallets,
  setBatchListCallback,
  setOnTXIDMerkletreeScanCallback,
  setOnUTXOMerkletreeScanCallback,
  setOnWalletPOIProofProgressCallback,
  startRailgunEngine,
  type SnarkJSGroth16,
} from "@railgun-community/wallet";
import {
  gasEstimateForUnprovenUnshieldToOrigin,
  populateProvedUnshieldToOrigin,
} from "../../node_modules/@railgun-community/wallet/dist/services/transactions/tx-unshield.js";
import { generateUnshieldToOriginProof } from "../../node_modules/@railgun-community/wallet/dist/services/transactions/tx-proof-unshield.js";
import {
  EVMGasType,
  type MerkletreeScanUpdateEvent,
  NETWORK_CONFIG,
  NetworkName,
  type POIProofProgressEvent,
  type RailgunERC20Amount,
  type RailgunERC20AmountRecipient,
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
const RAILGUN_NODE_PROVER_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "railgun-fullprove.mjs",
);
const RAILGUN_NODE_VERIFY_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "railgun-verify.mjs",
);

const TOKEN_ALIASES: Record<string, `0x${string}`> = {
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

type WalletMeta = {
  fingerprint: string;
  walletId: string;
  railgunAddress: string;
};

type RecentShieldRecord = {
  txHash: `0x${string}`;
  tokenAddress: string;
  ownerAddress: `0x${string}`;
  remainingAmountRaw: string;
  createdAt: string;
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

type RailgunBalanceSource = "live" | "cache";

type RailgunFreshness = {
  source: RailgunBalanceSource;
  updatedAt: string;
  ageMs: number;
  refreshing: boolean;
};

type RailgunOperationStage = {
  label: string;
  status: "completed" | "skipped";
  detail?: string;
};

type RailgunOperation = "shield" | "transfer" | "unshield";

type RailgunPrivateAction = "transfer" | "unshield";

type RailgunBalanceRouting = {
  requestedOperation: RailgunPrivateAction;
  route: "proceed" | "shield_then_retry" | "fund_public_wallet";
  token: string;
  requestedAmount: string;
  shieldedBalance: string;
  publicBalance: string;
  shortfall?: string;
  publicAddress: `0x${string}`;
  recommendation: string;
  privacyGuidance: string;
};

type RailgunApprovalStatus = "awaiting_local_approval" | "cancelled";

type RailgunApprovalState = {
  id: string;
  threshold: string;
  thresholdType: "token_amount";
  status: RailgunApprovalStatus;
  submitted: false;
  createdAt: string;
};

type RailgunActionResultBase = {
  railgun: true;
  operation: RailgunOperation;
  network: string;
  railgunAddress: string;
  token: string;
  amount: string;
  recipient?: string;
  summary: string;
  privacyImpact: string;
  privacyNote: string;
};

type RailgunPreparedOperationBase = {
  runtime: RailgunRuntime;
  token: RailgunToken;
  amount: string;
  amountRaw: bigint;
};

type RailgunPreparedShield = RailgunPreparedOperationBase;

type RailgunPreparedTransfer = RailgunPreparedOperationBase & {
  recipient: string;
};

type RailgunPreparedUnshield = RailgunPreparedOperationBase & {
  recipient: `0x${string}`;
  availablePrivateBalanceRaw: bigint;
  originShieldTxid?: `0x${string}`;
};

type PendingRailgunApproval = RailgunActionResultBase & {
  approval: RailgunApprovalState;
  execute: () => Promise<RailgunResult>;
};

type RailgunBalanceSuccessResult = {
  railgun: true;
  status: "success";
  operation: "balance";
  network: string;
  railgunAddress: string;
  scan: RailgunRuntimeState;
  balances: RailgunBalanceRow[];
  freshness: RailgunFreshness;
};

type RailgunActionSuccessResult = RailgunActionResultBase & {
  status: "success";
  txHash: string;
  explorerUrl: string;
  stages: RailgunOperationStage[];
  proofProgress?: ProofStage[];
  shieldedBalanceAfter?: string;
  publicBalanceAfter?: string;
  approvalTxHash?: string;
  scan: RailgunRuntimeState;
  balanceIndexing?: "pending" | "complete";
};

type RailgunBalanceSnapshot = {
  chainId: number;
  railgunAddress: string;
  balances: RailgunBalanceRow[];
  scan: RailgunRuntimeState;
  updatedAt: string;
};

type RailgunApprovalRequiredResult = RailgunActionResultBase & {
  status: "awaiting_local_approval";
  message: string;
  approval: RailgunApprovalState;
};

type RailgunCancelledResult = RailgunActionResultBase & {
  status: "cancelled";
  message: string;
  approval: RailgunApprovalState;
};

type RailgunErrorResult = {
  railgun: true;
  status: "error";
  operation: "balance" | "route" | "shield" | "transfer" | "unshield";
  network: string;
  message: string;
  setup?: string[];
  token?: string;
  amount?: string;
  recipient?: string;
  railgunAddress?: string;
  balanceRouting?: RailgunBalanceRouting;
};

type RailgunResult =
  | RailgunBalanceSuccessResult
  | {
      railgun: true;
      status: "success";
      operation: "route";
      network: string;
      railgunAddress: string;
      scan: RailgunRuntimeState;
      balanceRouting: RailgunBalanceRouting;
    }
  | RailgunActionSuccessResult
  | RailgunApprovalRequiredResult
  | RailgunCancelledResult
  | RailgunErrorResult;

let initPromise: Promise<RailgunRuntime> | undefined;
const runtimeState: RailgunRuntimeState = {};
let operationQueue: Promise<void> = Promise.resolve();
let engineStarted = false;
const RAILGUN_APPROVAL_TTL_MS = 10 * 60 * 1000;
const RAILGUN_RECENT_SHIELD_TTL_MS = 24 * 60 * 60 * 1000;
const RAILGUN_SYNC_FRESH_MS = 5 * 60 * 1000;
const RAILGUN_BALANCE_CACHE_MAX_AGE_MS = 60 * 1000;
const RAILGUN_NEW_WALLET_LOOKBACK_BLOCKS = 10_000n;
const pendingRailgunApprovals = new Map<string, PendingRailgunApproval>();
const optimisticShieldedBalances = new Map<string, bigint>();
let backgroundRefreshPromise: Promise<void> | undefined;
let backgroundRefreshTimer: ReturnType<typeof setTimeout> | undefined;
const LOG_REDACTED_KEYS = [
  "encryptionkey",
  "mnemonic",
  "privatekey",
  "secret",
  "signature",
] as const;
const runtimeLogState = {
  poiBatch: "",
  poiProof: "",
  txidScan: "",
  utxoScan: "",
};
let lastCompletedSyncAtMs = 0;

type RailgunLogLevel = "info" | "warn" | "error";

function shouldRedactLogKey(key: string) {
  const normalizedKey = key.toLowerCase();
  return LOG_REDACTED_KEYS.some((blockedKey) =>
    normalizedKey.includes(blockedKey),
  );
}

function normalizeLogValue(value: unknown, depth = 0): unknown {
  if (depth >= 4) {
    return "[truncated]";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => normalizeLogValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        shouldRedactLogKey(key)
          ? "[redacted]"
          : normalizeLogValue(entryValue, depth + 1),
      ]),
    );
  }

  return value;
}

function stringifyLogValue(value: unknown) {
  try {
    return JSON.stringify(normalizeLogValue(value));
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function railgunLog(
  level: RailgunLogLevel,
  event: string,
  detail?: Record<string, unknown>,
) {
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    ...(detail ?? {}),
  };
  const line = `[railgun] ${stringifyLogValue(payload)}`;

  switch (level) {
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
    default:
      console.info(line);
  }
}

async function withRailgunTiming<T>(
  event: string,
  detail: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  railgunLog("info", `${event}:start`, detail);

  try {
    const result = await fn();
    railgunLog("info", `${event}:success`, {
      ...detail,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    railgunLog("error", `${event}:error`, {
      ...detail,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

function logRuntimeUpdate(
  key: keyof typeof runtimeLogState,
  event: string,
  value: unknown,
) {
  const summary = stringifyLogValue(value);
  if (runtimeLogState[key] === summary) {
    return;
  }

  runtimeLogState[key] = summary;
  railgunLog("info", event, { detail: normalizeLogValue(value) as Record<string, unknown> });
}

function createDefaultRailgunToolRuntimeConfig(): RailgunToolRuntimeConfig {
  return {
    networkLabel: config.railgun.networkLabel,
    rpcUrl: config.railgun.rpcUrl,
    chainId: config.railgun.chainId,
    explorerTxBaseUrl: config.railgun.explorerTxBaseUrl,
    privacyGuidanceText: config.railgun.privacyGuidanceText,
    poiNodeUrls: config.railgun.poiNodeUrls,
    mnemonic: config.railgun.mnemonic || "",
    signerPrivateKey: config.railgun.signerPrivateKey || "",
    walletCreationBlock: config.railgun.walletCreationBlock,
    scanTimeoutMs: config.railgun.scanTimeoutMs,
    pollingIntervalMs: config.railgun.pollingIntervalMs,
    shieldApprovalThreshold: config.railgun.shieldApprovalThreshold,
    transferApprovalThreshold: config.railgun.transferApprovalThreshold,
    unshieldApprovalThreshold: config.railgun.unshieldApprovalThreshold,
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
  lastCompletedSyncAtMs = 0;
  optimisticShieldedBalances.clear();
  runtimeLogState.utxoScan = "";
  runtimeLogState.txidScan = "";
  runtimeLogState.poiProof = "";
  runtimeLogState.poiBatch = "";
}

function cloneRailgunToolRuntimeConfig(
  value: RailgunToolRuntimeConfig,
): RailgunToolRuntimeConfig {
  return {
    ...value,
    poiNodeUrls: [...value.poiNodeUrls],
  };
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
  if (backgroundRefreshTimer) {
    clearTimeout(backgroundRefreshTimer);
    backgroundRefreshTimer = undefined;
  }
  resetRuntimeState();
  railgunLog("info", "config:updated", {
    chainId: currentConfig.chainId,
    network: currentConfig.networkLabel,
    poiNodeUrls: currentConfig.poiNodeUrls,
    pollingIntervalMs: currentConfig.pollingIntervalMs,
    rpcUrl: currentConfig.rpcUrl,
    scanTimeoutMs: currentConfig.scanTimeoutMs,
  });
  publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(currentConfig.rpcUrl),
  });
}

const withRailgunLock = async <T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const previous = operationQueue;
  let release!: () => void;
  const queuedAt = Date.now();
  operationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  railgunLog("info", "lock:queued", { operation });
  await previous;
  const waitMs = Date.now() - queuedAt;
  railgunLog("info", "lock:acquired", { operation, waitMs });

  try {
    return await fn();
  } finally {
    railgunLog("info", "lock:released", {
      heldMs: Date.now() - queuedAt - waitMs,
      operation,
    });
    release();
  }
};

const ensureContextDir = async () => {
  await fs.promises.mkdir(getRailgunStorageDir(), { recursive: true });
};

const getRailgunStorageNamespace = () => {
  const namespace = process.env.RAILGUN_STORAGE_NAMESPACE?.trim();
  return namespace || "default";
};

const getRailgunStorageDir = () => {
  const namespace = getRailgunStorageNamespace();
  return path.join(
    process.cwd(),
    ".context",
    namespace === "default" ? "railgun" : `railgun-${namespace}`,
  );
};

const getRailgunDbPath = () => path.join(getRailgunStorageDir(), "db");

const getRailgunWalletMetaPath = () =>
  path.join(getRailgunStorageDir(), "wallet.json");

const getRailgunRecentShieldsPath = () =>
  path.join(getRailgunStorageDir(), "recent-shields.json");

const getRailgunBalanceSnapshotPath = () =>
  path.join(getRailgunStorageDir(), "balance-snapshot.json");

const loadRecentShieldRecords = async (): Promise<RecentShieldRecord[]> => {
  if (!(await fileExists(getRailgunRecentShieldsPath()))) {
    return [];
  }

  const raw = await fs.promises.readFile(getRailgunRecentShieldsPath(), "utf8");
  return JSON.parse(raw) as RecentShieldRecord[];
};

const saveRecentShieldRecords = async (records: RecentShieldRecord[]) => {
  await ensureContextDir();
  await fs.promises.writeFile(
    getRailgunRecentShieldsPath(),
    JSON.stringify(records, null, 2),
  );
};

const loadBalanceSnapshot = async (): Promise<RailgunBalanceSnapshot | null> => {
  if (!(await fileExists(getRailgunBalanceSnapshotPath()))) {
    return null;
  }

  const raw = await fs.promises.readFile(getRailgunBalanceSnapshotPath(), "utf8");
  return JSON.parse(raw) as RailgunBalanceSnapshot;
};

const saveBalanceSnapshot = async (snapshot: RailgunBalanceSnapshot) => {
  await ensureContextDir();
  await fs.promises.writeFile(
    getRailgunBalanceSnapshotPath(),
    JSON.stringify(snapshot, null, 2),
  );
};

const pruneRecentShieldRecords = (records: RecentShieldRecord[]) => {
  const now = Date.now();

  return records.filter((record) => {
    const createdAtMs = Date.parse(record.createdAt);
    if (!Number.isFinite(createdAtMs)) {
      return false;
    }

    if (now - createdAtMs >= RAILGUN_RECENT_SHIELD_TTL_MS) {
      return false;
    }

    return BigInt(record.remainingAmountRaw) > 0n;
  });
};

const rememberRecentShield = async (
  txHash: `0x${string}`,
  token: RailgunToken,
  ownerAddress: `0x${string}`,
  amountRaw: bigint,
) => {
  const records = pruneRecentShieldRecords(await loadRecentShieldRecords());
  records.unshift({
    txHash,
    tokenAddress: getShieldedBalanceKey(token.tokenAddress),
    ownerAddress: getAddress(ownerAddress) as `0x${string}`,
    remainingAmountRaw: amountRaw.toString(),
    createdAt: new Date().toISOString(),
  });
  await saveRecentShieldRecords(records);
  railgunLog("info", "shield:recent-recorded", {
    ownerAddress,
    tokenAddress: getShieldedBalanceKey(token.tokenAddress),
    txHash,
  });
};

const findRecentOriginShield = async (
  token: RailgunToken,
  recipient: `0x${string}`,
  amountRaw: bigint,
) => {
  const records = pruneRecentShieldRecords(await loadRecentShieldRecords());
  await saveRecentShieldRecords(records);

  const tokenAddress = getShieldedBalanceKey(token.tokenAddress);
  const ownerAddress = getAddress(recipient);
  return records.find(
    (record) =>
      record.tokenAddress === tokenAddress &&
      record.ownerAddress === ownerAddress &&
      BigInt(record.remainingAmountRaw) >= amountRaw,
  );
};

const consumeRecentOriginShield = async (
  txHash: `0x${string}`,
  amountRaw: bigint,
) => {
  const records = pruneRecentShieldRecords(await loadRecentShieldRecords());
  const updatedRecords = records
    .map((record) => {
      if (record.txHash !== txHash) {
        return record;
      }

      const remainingAmountRaw = BigInt(record.remainingAmountRaw) - amountRaw;
      return {
        ...record,
        remainingAmountRaw: (remainingAmountRaw > 0n ? remainingAmountRaw : 0n).toString(),
      };
    })
    .filter((record) => BigInt(record.remainingAmountRaw) > 0n);

  await saveRecentShieldRecords(updatedRecords);
  railgunLog("info", "shield:recent-consumed", {
    amountRaw,
    txHash,
  });
};

const resolveRailgunStoragePath = (targetPath: string) =>
  path.isAbsolute(targetPath)
    ? targetPath
    : path.join(getRailgunStorageDir(), targetPath);

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

const shouldUseNodeSnarkjsProver = () =>
  Boolean(process.versions.bun) &&
  process.env.RAILGUN_USE_NODE_PROVER !== "0";

const snarkJSGroth16 = groth16 as SnarkJSGroth16 & {
  fullProve: (
    formattedInputs: unknown,
    wasm: unknown,
    zkey: unknown,
    logger?: { debug?: (message: string) => void },
  ) => Promise<unknown>;
  verify: SnarkJSGroth16["verify"];
};

const stringifyRailgunJson = (value: unknown) =>
  JSON.stringify(value, (_key, entryValue) =>
    typeof entryValue === "bigint" ? entryValue.toString() : entryValue,
  );

const runNodeSnarkjsFullProve = async (
  formattedInputs: unknown,
  wasm: ArrayLike<number>,
  zkey: ArrayLike<number>,
) => {
  await ensureContextDir();
  const tempDir = await fs.promises.mkdtemp(
    path.join(getRailgunStorageDir(), "node-prover-"),
  );
  const inputPath = path.join(tempDir, "inputs.json");
  const wasmPath = path.join(tempDir, "circuit.wasm");
  const zkeyPath = path.join(tempDir, "circuit.zkey");
  const outputPath = path.join(tempDir, "proof.json");

  try {
    railgunLog("info", "prover:node-subprocess-start", {
      tempDir,
    });
    await fs.promises.writeFile(inputPath, stringifyRailgunJson(formattedInputs));
    await fs.promises.writeFile(wasmPath, Buffer.from(Uint8Array.from(wasm)));
    await fs.promises.writeFile(zkeyPath, Buffer.from(Uint8Array.from(zkey)));

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "node",
        [RAILGUN_NODE_PROVER_SCRIPT, inputPath, wasmPath, zkeyPath, outputPath],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        railgunLog("error", "prover:node-subprocess-error", {
          code,
          stderr: stderr.trim(),
        });
        reject(
          new Error(
            `Node snarkjs prover exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`,
          ),
        );
      });
    });

    railgunLog("info", "prover:node-subprocess-success", {
      tempDir,
    });
    return JSON.parse(await fs.promises.readFile(outputPath, "utf8"));
  } finally {
    await fs.promises.rm(tempDir, { force: true, recursive: true });
  }
};

const runNodeSnarkjsVerify = async (
  vkey: unknown,
  publicSignals: unknown,
  proof: unknown,
) => {
  await ensureContextDir();
  const tempDir = await fs.promises.mkdtemp(
    path.join(getRailgunStorageDir(), "node-verify-"),
  );
  const vkeyPath = path.join(tempDir, "vkey.json");
  const publicSignalsPath = path.join(tempDir, "public-signals.json");
  const proofPath = path.join(tempDir, "proof.json");
  const outputPath = path.join(tempDir, "result.json");

  try {
    railgunLog("info", "prover:node-verify-start", {
      tempDir,
    });
    await fs.promises.writeFile(vkeyPath, stringifyRailgunJson(vkey));
    await fs.promises.writeFile(
      publicSignalsPath,
      stringifyRailgunJson(publicSignals),
    );
    await fs.promises.writeFile(proofPath, stringifyRailgunJson(proof));

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "node",
        [
          RAILGUN_NODE_VERIFY_SCRIPT,
          vkeyPath,
          publicSignalsPath,
          proofPath,
          outputPath,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        railgunLog("error", "prover:node-verify-error", {
          code,
          stderr: stderr.trim(),
        });
        reject(
          new Error(
            `Node snarkjs verifier exited with code ${code}.${stderr ? ` ${stderr.trim()}` : ""}`,
          ),
        );
      });
    });

    railgunLog("info", "prover:node-verify-success", {
      tempDir,
    });
    const result = JSON.parse(await fs.promises.readFile(outputPath, "utf8")) as {
      verified?: unknown;
    };
    return result.verified === true;
  } finally {
    await fs.promises.rm(tempDir, { force: true, recursive: true });
  }
};

const getRailgunGroth16 = (): SnarkJSGroth16 => {
  if (!shouldUseNodeSnarkjsProver()) {
    return snarkJSGroth16;
  }

  return {
    ...snarkJSGroth16,
    fullProve: async (formattedInputs, wasm, zkey, logger) => {
      logger?.debug?.("Using Node subprocess snarkjs prover");
      return runNodeSnarkjsFullProve(
        formattedInputs,
        wasm as ArrayLike<number>,
        zkey as ArrayLike<number>,
      );
    },
    verify: async (
      vkey: Parameters<SnarkJSGroth16["verify"]>[0],
      publicSignals: Parameters<SnarkJSGroth16["verify"]>[1],
      proof: Parameters<SnarkJSGroth16["verify"]>[2],
    ) => {
      return runNodeSnarkjsVerify(vkey, publicSignals, proof);
    },
  } as SnarkJSGroth16;
};

const clearRailgunSecrets = () => [
  "Set a dedicated Railgun mnemonic in Settings, or leave it blank to derive one from the configured EOA private key for testing.",
  "Set an EOA private key in Settings if you want the assistant to submit Arbitrum transactions on your behalf.",
  "Optionally change the Railgun RPC URL and POI node URLs in settings if you want custom infrastructure.",
];

const snapshotState = (): RailgunRuntimeState =>
  JSON.parse(JSON.stringify(runtimeState)) as RailgunRuntimeState;

const getFreshness = (
  updatedAt: string,
  source: RailgunBalanceSource,
  refreshing: boolean,
): RailgunFreshness => {
  const updatedAtMs = Date.parse(updatedAt);
  return {
    source,
    updatedAt,
    ageMs: Number.isFinite(updatedAtMs) ? Math.max(Date.now() - updatedAtMs, 0) : 0,
    refreshing,
  };
};

const getSignerPrivateKey = (): `0x${string}` => {
  const privateKey = currentConfig.signerPrivateKey.trim();

  if (!privateKey) {
    throw new Error(
      "Missing EOA private key for Arbitrum transaction signing. Add it in Settings first.",
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
    if (process.env.RAILGUN_DERIVE_NAMESPACE_MNEMONIC === "1") {
      const namespaceEntropy = keccak256(
        stringToHex(
          `railgun-test-wallet:${privateKey}:${getRailgunStorageNamespace()}`,
        ),
      );
      return Mnemonic.fromEntropy(ByteUtils.strip0x(namespaceEntropy));
    }
    return Mnemonic.fromEntropy(ByteUtils.strip0x(privateKey));
  }

  throw new Error(
    "Missing Railgun mnemonic and EOA private key. Add one of them in Settings first.",
  );
};

const deriveEncryptionKey = (mnemonic: string) =>
  keccak256(stringToHex(`railgun-db:${mnemonic}`)).slice(2);

const getWalletFingerprint = (mnemonic: string) =>
  keccak256(stringToHex(`railgun-wallet:${mnemonic}`));

const getShieldedBalanceKey = (tokenAddress: `0x${string}` | string) =>
  getAddress(tokenAddress);

const clearOptimisticShieldedBalances = (reason: string) => {
  if (optimisticShieldedBalances.size === 0) {
    return;
  }

  railgunLog("info", "balance:shielded-optimistic-cleared", {
    reason,
    tokenAddresses: Array.from(optimisticShieldedBalances.keys()),
  });
  optimisticShieldedBalances.clear();
};

const setOptimisticShieldedBalance = (
  token: RailgunToken,
  amountRaw: bigint,
  reason: string,
) => {
  const tokenAddress = getShieldedBalanceKey(token.tokenAddress);
  optimisticShieldedBalances.set(tokenAddress, amountRaw);
  railgunLog("info", "balance:shielded-optimistic-set", {
    amountRaw,
    amount: formatUnits(amountRaw, token.decimals),
    reason,
    symbol: token.symbol,
    tokenAddress,
  });
};

const getOptimisticShieldedBalance = (token: RailgunToken) =>
  optimisticShieldedBalances.get(getShieldedBalanceKey(token.tokenAddress));

const markWalletStateFresh = (reason: string) => {
  runtimeState.lastSyncAt = new Date().toISOString();
  lastCompletedSyncAtMs = Date.now();
  railgunLog("info", "wallet:freshness-updated", {
    lastSyncAt: runtimeState.lastSyncAt,
    reason,
  });
};

const loadWalletMeta = async (): Promise<WalletMeta | null> => {
  if (!(await fileExists(getRailgunWalletMetaPath()))) {
    return null;
  }

  const raw = await fs.promises.readFile(getRailgunWalletMetaPath(), "utf8");
  return JSON.parse(raw) as WalletMeta;
};

const saveWalletMeta = async (meta: WalletMeta) => {
  await ensureContextDir();
  await fs.promises.writeFile(
    getRailgunWalletMetaPath(),
    JSON.stringify(meta, null, 2),
  );
};

const resolveWalletCreationBlock = async (existingMeta: WalletMeta | null) => {
  const configuredCreationBlock = currentConfig.walletCreationBlock;
  const usingExplicitMnemonic = currentConfig.mnemonic.trim().length > 0;

  if (existingMeta || usingExplicitMnemonic) {
    railgunLog("info", "runtime:wallet-creation-block", {
      configuredCreationBlock,
      mode: existingMeta ? "existing-wallet" : "explicit-mnemonic",
      resolvedCreationBlock: configuredCreationBlock,
    });
    return configuredCreationBlock;
  }

  const latestBlock = await publicClient.getBlockNumber();
  const lookbackStart =
    latestBlock > RAILGUN_NEW_WALLET_LOOKBACK_BLOCKS
      ? latestBlock - RAILGUN_NEW_WALLET_LOOKBACK_BLOCKS
      : 0n;
  const resolvedCreationBlock = Math.max(
    configuredCreationBlock,
    Number(lookbackStart),
  );

  railgunLog("info", "runtime:wallet-creation-block", {
    configuredCreationBlock,
    latestBlock,
    lookbackBlocks: RAILGUN_NEW_WALLET_LOOKBACK_BLOCKS,
    mode: "derived-mnemonic-new-wallet",
    resolvedCreationBlock,
  });

  return resolvedCreationBlock;
};

const initializeCallbacks = () => {
  setOnUTXOMerkletreeScanCallback((scanData) => {
    runtimeState.utxoScan = scanData;
    logRuntimeUpdate("utxoScan", "scan:utxo", scanData);
  });

  setOnTXIDMerkletreeScanCallback((scanData) => {
    runtimeState.txidScan = scanData;
    logRuntimeUpdate("txidScan", "scan:txid", scanData);
  });

  setOnWalletPOIProofProgressCallback((poiProof) => {
    runtimeState.poiProof = poiProof;
    logRuntimeUpdate("poiProof", "poi:proof", poiProof);
  });

  setBatchListCallback((batch) => {
    runtimeState.poiBatch = batch;
    logRuntimeUpdate("poiBatch", "poi:batch", batch);
  });
};

const getScanProgressSnapshot = () => ({
  txidProgress: runtimeState.txidScan?.progress ?? null,
  txidStatus: runtimeState.txidScan?.scanStatus ?? "pending",
  utxoProgress: runtimeState.utxoScan?.progress ?? null,
  utxoStatus: runtimeState.utxoScan?.scanStatus ?? "pending",
});

const waitForPrivateBalanceScans = async (options?: {
  requireTxidComplete?: boolean;
}) => {
  const requireTxidComplete = options?.requireTxidComplete ?? false;
  const deadline = Date.now() + currentConfig.scanTimeoutMs;
  let lastLoggedState = "";
  let nextHeartbeatAt = 0;

  while (Date.now() < deadline) {
    const utxoComplete = runtimeState.utxoScan?.scanStatus === "Complete";
    const txidComplete = runtimeState.txidScan?.scanStatus === "Complete";

    if (utxoComplete && (!requireTxidComplete || txidComplete)) {
      railgunLog("info", "scan:private-balances-ready", {
        requireTxidComplete,
        scan: getScanProgressSnapshot(),
      });
      return;
    }

    const scanSummary = stringifyLogValue(getScanProgressSnapshot());
    if (scanSummary !== lastLoggedState || Date.now() >= nextHeartbeatAt) {
      lastLoggedState = scanSummary;
      nextHeartbeatAt = Date.now() + 5_000;
      railgunLog("info", "scan:awaiting-private-balances", {
        msRemaining: Math.max(deadline - Date.now(), 0),
        requireTxidComplete,
        scan: getScanProgressSnapshot(),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  railgunLog("error", "scan:private-balances-timeout", {
    requireTxidComplete,
    scanTimeoutMs: currentConfig.scanTimeoutMs,
    scan: getScanProgressSnapshot(),
  });
  throw new Error(
    "Railgun wallet scan timed out before private balances were ready.",
  );
};

const resetScanProgressForSync = () => {
  runtimeState.utxoScan = undefined;
  runtimeState.txidScan = undefined;
  runtimeState.poiProof = undefined;
  runtimeState.poiBatch = undefined;
  runtimeLogState.utxoScan = "";
  runtimeLogState.txidScan = "";
  runtimeLogState.poiProof = "";
  runtimeLogState.poiBatch = "";
};

const shouldSkipFreshSync = (force: boolean) =>
  !force &&
  lastCompletedSyncAtMs > 0 &&
  Date.now() - lastCompletedSyncAtMs < RAILGUN_SYNC_FRESH_MS;

const shouldUseIncrementalSync = (reason: string) =>
  lastCompletedSyncAtMs > 0 && reason.endsWith("post-transaction");

const shouldIgnoreCompletedUTXORescanError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    runtimeState.utxoScan?.scanStatus === "Complete" &&
    error.message.includes(
      "Cannot re-scan railgun txids. Must get UTXO history first.",
    )
  );
};

const shouldIgnorePOIRefreshError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Failed to refresh POIs");
};

const syncWalletState = async (
  runtime: RailgunRuntime,
  options?: {
    force?: boolean;
    requireTxidComplete?: boolean;
    reason?: string;
  },
) => {
  const force = options?.force ?? false;
  const requireTxidComplete = options?.requireTxidComplete ?? false;
  const reason = options?.reason ?? "general";

  if (shouldSkipFreshSync(force)) {
    railgunLog("info", "wallet:sync-skipped-fresh", {
      ageMs: Date.now() - lastCompletedSyncAtMs,
      railgunAddress: runtime.railgunAddress,
      reason,
      walletId: runtime.walletId,
    });
    return;
  }

  await withRailgunTiming(
    "wallet:sync",
    {
      force,
      requireTxidComplete,
      railgunAddress: runtime.railgunAddress,
      reason,
      walletId: runtime.walletId,
    },
    async () => {
      resetScanProgressForSync();
      if (shouldUseIncrementalSync(reason)) {
        railgunLog("info", "wallet:refresh-balances", {
          reason,
          walletId: runtime.walletId,
        });
        let refreshBalancesError: unknown;
        void refreshBalances(RAILGUN_CHAIN, [runtime.walletId]).catch((error) => {
          refreshBalancesError = error;
          railgunLog("warn", "wallet:refresh-balances-background-error", {
            error,
            reason,
            walletId: runtime.walletId,
          });
        });
        await waitForPrivateBalanceScans({ requireTxidComplete });
        if (refreshBalancesError) {
          if (!shouldIgnorePOIRefreshError(refreshBalancesError)) {
            throw refreshBalancesError;
          }

          railgunLog("warn", "wallet:refresh-balances-ignored-error", {
            error: refreshBalancesError,
            reason,
            walletId: runtime.walletId,
          });
        }
      } else {
        railgunLog("info", "wallet:rescan-utxo", {
          walletId: runtime.walletId,
        });
        try {
          await rescanFullUTXOMerkletreesAndWallets(RAILGUN_CHAIN, [runtime.walletId]);
        } catch (error) {
          if (
            !shouldIgnoreCompletedUTXORescanError(error) &&
            !shouldIgnorePOIRefreshError(error)
          ) {
            throw error;
          }

          railgunLog("warn", "wallet:rescan-utxo-ignored-error", {
            error,
            walletId: runtime.walletId,
          });
        }
      }
      if (!shouldUseIncrementalSync(reason)) {
        railgunLog("info", "wallet:wait-for-private-balances", {
          requireTxidComplete,
          scanTimeoutMs: currentConfig.scanTimeoutMs,
          walletId: runtime.walletId,
        });
        await waitForPrivateBalanceScans({ requireTxidComplete });
      }
      clearOptimisticShieldedBalances(`sync:${reason}`);
      markWalletStateFresh(`sync:${reason}`);
      railgunLog("info", "wallet:sync-state", {
        lastSyncAt: runtimeState.lastSyncAt,
        scan: snapshotState(),
      });
    },
  );
};

const refreshWalletStateForRouting = async (runtime: RailgunRuntime) => {
  await syncWalletState(runtime, { reason: "routing" });
};

const canWarmRailgun = () =>
  currentConfig.mnemonic.trim().length > 0 ||
  currentConfig.signerPrivateKey.trim().length > 0;

const startBackgroundRefresh = (
  reason: string,
  options?: { delayMs?: number },
) => {
  if (!canWarmRailgun()) {
    return false;
  }

  if (backgroundRefreshPromise || backgroundRefreshTimer) {
    return true;
  }

  const launchRefresh = () => {
    backgroundRefreshTimer = undefined;
    backgroundRefreshPromise = withRailgunLock("railgun_background_refresh", async () => {
      try {
        const runtime = await getRuntime();
        await syncWalletState(runtime, { reason });
        await persistBalanceSnapshot(runtime);
        railgunLog("info", "wallet:background-refresh-complete", { reason });
      } catch (error) {
        railgunLog("warn", "wallet:background-refresh-failed", { error, reason });
      } finally {
        backgroundRefreshPromise = undefined;
      }
    });
  };

  const delayMs = options?.delayMs ?? 0;
  if (delayMs > 0) {
    backgroundRefreshTimer = setTimeout(() => {
      launchRefresh();
    }, delayMs);
    return true;
  }

  launchRefresh();

  return true;
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
  return withRailgunTiming(
    "runtime:initialize",
    {
      chainId: currentConfig.chainId,
      network: currentConfig.networkLabel,
      pollingIntervalMs: currentConfig.pollingIntervalMs,
      walletCreationBlock: currentConfig.walletCreationBlock,
    },
    async () => {
      await ensureContextDir();

      const mnemonic = deriveRailgunMnemonic();
      const fingerprint = getWalletFingerprint(mnemonic);
      const encryptionKey = deriveEncryptionKey(mnemonic);

      railgunLog("info", "runtime:wallet-derived", {
        fingerprint,
      });

      if (!engineStarted) {
        railgunLog("info", "engine:start", {
          dbPath: getRailgunDbPath(),
          poiNodeUrls: currentConfig.poiNodeUrls,
          storageNamespace: getRailgunStorageNamespace(),
        });
        await startRailgunEngine(
          "railgunchat",
          leveldown(getRailgunDbPath()),
          false,
          artifactStore,
          false,
          false,
          currentConfig.poiNodeUrls,
        );
        engineStarted = true;
        railgunLog("info", "engine:started");
      }

      initializeCallbacks();
      getProver().setSnarkJSGroth16(getRailgunGroth16());
      railgunLog("info", "prover:ready", {
        mode: shouldUseNodeSnarkjsProver() ? "node-subprocess" : "in-process",
      });

      await loadProvider(
        createFallbackProviderConfig(),
        RAILGUN_NETWORK,
        currentConfig.pollingIntervalMs,
      );
      railgunLog("info", "provider:loaded", {
        pollingIntervalMs: currentConfig.pollingIntervalMs,
        rpcUrl: currentConfig.rpcUrl,
      });

      const existingMeta = await loadWalletMeta();
      const walletCreationBlock = await resolveWalletCreationBlock(existingMeta);
      const creationBlockNumbers = {
        [RAILGUN_NETWORK]: walletCreationBlock,
      };

      railgunLog("info", "runtime:wallet-meta", {
        existingWalletId: existingMeta?.walletId,
        hasExistingMeta: Boolean(existingMeta),
        metaFingerprintMatches: existingMeta?.fingerprint === fingerprint,
        walletCreationBlock,
      });

      const walletInfo =
        existingMeta && existingMeta.fingerprint === fingerprint
          ? await loadWalletByID(encryptionKey, existingMeta.walletId, false)
          : await createRailgunWallet(
              encryptionKey,
              mnemonic,
              creationBlockNumbers,
            );

      const meta: WalletMeta = {
        fingerprint,
        walletId: walletInfo.id,
        railgunAddress: walletInfo.railgunAddress,
      };

      await saveWalletMeta(meta);
      railgunLog("info", "runtime:wallet-ready", {
        railgunAddress: walletInfo.railgunAddress,
        reusedExistingWallet:
          Boolean(existingMeta) && existingMeta?.fingerprint === fingerprint,
        walletId: walletInfo.id,
      });

      return {
        walletId: walletInfo.id,
        railgunAddress: walletInfo.railgunAddress,
        encryptionKey,
        state: runtimeState,
      };
    },
  );
};

const getRuntime = async () => {
  if (!initPromise) {
    railgunLog("info", "runtime:init-requested");
    initPromise = initializeRailgun().catch((error) => {
      railgunLog("error", "runtime:init-reset", { error });
      initPromise = undefined;
      throw error;
    });
  } else {
    railgunLog("info", "runtime:init-reused");
  }

  return initPromise;
};

export async function warmRailgun(
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<{ started: boolean }> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return {
    started: startBackgroundRefresh("background-warm"),
  };
}

const explorerUrlForTx = (txHash: string) =>
  `${currentConfig.explorerTxBaseUrl}${txHash}`;

const isNativeToken = (token: string) => token.trim().toUpperCase() === "ETH";

const getTokenAliasAddress = (token: string) => {
  const alias = TOKEN_ALIASES[token.trim().toUpperCase()];
  return alias ? getAddress(alias) : null;
};

const getTokenMetadata = async (tokenAddress: `0x${string}`) => {
  return withRailgunTiming(
    "token:metadata",
    { tokenAddress },
    async () => {
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
    },
  );
};

const resolveToken = async (token: string): Promise<RailgunToken> => {
  if (isNativeToken(token)) {
    railgunLog("info", "token:resolved-native", { token });
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
  railgunLog("info", "token:resolved-erc20", {
    symbol: metadata.symbol,
    token,
    tokenAddress,
  });

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
  return withRailgunTiming(
    "gas:details",
    { gasEstimate },
    async () => {
      const fees = await publicClient.estimateFeesPerGas();
      const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
      const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? BigInt(0);

      if (!maxFeePerGas) {
        throw new Error("Could not determine Arbitrum gas fees.");
      }

      const gasDetails = {
        evmGasType: EVMGasType.Type2 as const,
        gasEstimate,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
      railgunLog("info", "gas:details-ready", gasDetails);
      return gasDetails;
    },
  );
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
  return withRailgunTiming(
    "transaction:submit",
    {
      gasLimit: transaction.gasLimit,
      hasData: Boolean(transaction.data),
      nonce: transaction.nonce,
      to: transaction.to,
      value: transaction.value,
    },
    async () => {
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

      railgunLog("info", "transaction:submitted", { txHash });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      railgunLog("info", "transaction:confirmed", { txHash });

      return txHash;
    },
  );
};

const ensureAllowance = async (
  token: RailgunToken,
  amount: bigint,
): Promise<`0x${string}` | undefined> => {
  if (token.isNative) {
    railgunLog("info", "allowance:skipped-native", {
      amount: amount.toString(),
      symbol: token.symbol,
    });
    return undefined;
  }

  return withRailgunTiming(
    "allowance:ensure",
    {
      amount,
      symbol: token.symbol,
      tokenAddress: token.tokenAddress,
    },
    async () => {
      const account = getSignerAccount();
      const walletClient = getWalletClient();
      const spender = getAddress(NETWORK_CONFIG[RAILGUN_NETWORK].proxyContract);
      const allowance = await publicClient.readContract({
        address: token.tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account.address, spender],
      });

      railgunLog("info", "allowance:checked", {
        account: account.address,
        allowance,
        amount,
        spender,
        tokenAddress: token.tokenAddress,
      });

      if (allowance >= amount) {
        railgunLog("info", "allowance:sufficient", {
          amount,
          tokenAddress: token.tokenAddress,
        });
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

      railgunLog("info", "allowance:approval-submitted", {
        approvalTxHash,
        spender,
      });
      await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
      railgunLog("info", "allowance:approval-confirmed", {
        approvalTxHash,
      });
      return approvalTxHash;
    },
  );
};

const getShieldPrivateKey = async () => {
  return withRailgunTiming(
    "shield-key:derive",
    {
      account: getSignerAccount().address,
    },
    async () => {
      const walletClient = getWalletClient();
      const account = getSignerAccount();
      const signature = await walletClient.signMessage({
        account,
        message: getShieldPrivateKeySignatureMessage(),
      });

      railgunLog("info", "shield-key:derived", {
        account: account.address,
      });
      return keccak256(signature);
    },
  );
};

const getShieldedBalanceForToken = async (runtime: RailgunRuntime, token: RailgunToken) => {
  return withRailgunTiming(
    "balance:shielded",
    {
      railgunAddress: runtime.railgunAddress,
      symbol: token.symbol,
      tokenAddress: token.tokenAddress,
      walletId: runtime.walletId,
    },
    async () => {
      const optimisticBalance = getOptimisticShieldedBalance(token);
      if (optimisticBalance !== undefined) {
        const formattedAmount = formatUnits(optimisticBalance, token.decimals);
        railgunLog("info", "balance:shielded-optimistic-result", {
          amount: formattedAmount,
          rawAmount: optimisticBalance,
          symbol: token.symbol,
        });
        return formattedAmount;
      }

      const wallet = fullWalletForID(runtime.walletId);
      const amount = await balanceForERC20Token(
        RAILGUN_TXID_VERSION,
        wallet,
        RAILGUN_NETWORK,
        token.tokenAddress,
        true,
      );
      const formattedAmount = formatUnits(amount, token.decimals);
      railgunLog("info", "balance:shielded-result", {
        amount: formattedAmount,
        rawAmount: amount,
        symbol: token.symbol,
      });
      return formattedAmount;
    },
  );
};

const getSpendableShieldedBalanceRawForToken = async (
  runtime: RailgunRuntime,
  token: RailgunToken,
  options: {
    includeOptimistic?: boolean;
  } = {},
) => {
  const includeOptimistic = options.includeOptimistic ?? true;
  const optimisticBalance = getOptimisticShieldedBalance(token);
  if (includeOptimistic && optimisticBalance !== undefined) {
    railgunLog("info", "balance:shielded-raw-optimistic-result", {
      rawAmount: optimisticBalance,
      symbol: token.symbol,
    });
    return optimisticBalance;
  }

  const wallet = fullWalletForID(runtime.walletId);
  const amount = await balanceForERC20Token(
    RAILGUN_TXID_VERSION,
    wallet,
    RAILGUN_NETWORK,
    token.tokenAddress,
    true,
  );
  railgunLog("info", "balance:shielded-raw-result", {
    rawAmount: amount,
    symbol: token.symbol,
  });
  return amount;
};

const getPublicBalanceForToken = async (recipientAddress: `0x${string}`, token: RailgunToken) => {
  return withRailgunTiming(
    "balance:public",
    {
      address: recipientAddress,
      symbol: token.symbol,
      tokenAddress: token.tokenAddress,
    },
    async () => {
      if (token.isNative) {
        const balance = await publicClient.getBalance({ address: recipientAddress });
        const formattedAmount = formatUnits(balance, token.decimals);
        railgunLog("info", "balance:public-result", {
          address: recipientAddress,
          amount: formattedAmount,
          rawAmount: balance,
          symbol: token.symbol,
        });
        return formattedAmount;
      }

      const balance = await publicClient.readContract({
        address: token.tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [recipientAddress],
      });
      const formattedAmount = formatUnits(balance, token.decimals);
      railgunLog("info", "balance:public-result", {
        address: recipientAddress,
        amount: formattedAmount,
        rawAmount: balance,
        symbol: token.symbol,
      });
      return formattedAmount;
    },
  );
};

const collectShieldedBalanceRows = async (
  runtime: RailgunRuntime,
): Promise<RailgunBalanceRow[]> => {
  const wallet = fullWalletForID(runtime.walletId);
  const balances = await wallet.getTokenBalances(
    RAILGUN_TXID_VERSION,
    RAILGUN_CHAIN,
    true,
  );

  const serialized = getSerializedERC20Balances(balances);
  let rows = await Promise.all(
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

  if (optimisticShieldedBalances.size === 0) {
    return rows;
  }

  const overriddenRows = await Promise.all(
    Array.from(optimisticShieldedBalances.entries()).map(
      async ([tokenAddress, amountRaw]) => {
        const existingRow = rows.find(
          (row) => getAddress(row.tokenAddress) === tokenAddress,
        );
        const isWrappedNative =
          tokenAddress ===
          getAddress(NETWORK_CONFIG[RAILGUN_NETWORK].baseToken.wrappedAddress);
        const metadata = isWrappedNative
          ? {
              symbol: "ETH",
              decimals: NETWORK_CONFIG[RAILGUN_NETWORK].baseToken.decimals,
            }
          : await getTokenMetadata(tokenAddress as `0x${string}`);

        if (existingRow) {
          return {
            ...existingRow,
            symbol: metadata.symbol,
            amount: formatUnits(amountRaw, metadata.decimals),
            rawAmount: amountRaw.toString(),
          };
        }

        return {
          tokenAddress,
          symbol: metadata.symbol,
          amount: formatUnits(amountRaw, metadata.decimals),
          rawAmount: amountRaw.toString(),
        };
      },
    ),
  );

  rows = rows.filter(
    (row) => !optimisticShieldedBalances.has(getAddress(row.tokenAddress)),
  );
  rows.push(...overriddenRows);
  return rows;
};

const filterBalanceRows = async (
  rows: RailgunBalanceRow[],
  token?: string,
) => {
  if (!token) {
    return rows;
  }

  const resolvedToken = await resolveToken(token);
  return rows.filter(
    (row) => getAddress(row.tokenAddress) === getAddress(resolvedToken.tokenAddress),
  );
};

const persistBalanceSnapshot = async (runtime: RailgunRuntime) => {
  const snapshot: RailgunBalanceSnapshot = {
    chainId: currentConfig.chainId,
    railgunAddress: runtime.railgunAddress,
    balances: await collectShieldedBalanceRows(runtime),
    scan: snapshotState(),
    updatedAt: new Date().toISOString(),
  };
  await saveBalanceSnapshot(snapshot);
  return snapshot;
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

const getPrivacyImpact = (
  operation: RailgunOperation,
  networkLabel: string,
) => {
  switch (operation) {
    case "shield":
      return `This deposit is public on ${networkLabel}, but once shielded the resulting private balance can be spent without publicly linking future Railgun transfers to the deposit address.`;
    case "transfer":
      return `This Railgun transfer remains private on ${networkLabel}. Observers can see the chain transaction, but they should not be able to link the sender, recipient 0zk address, token, and amount the way they can with a public transfer.`;
    case "unshield":
      return `This exits the Railgun privacy pool on ${networkLabel}. The unshield target address and resulting public balance become visible after confirmation.`;
  }
};

const buildActionSummary = (
  operation: RailgunOperation,
  amount: string,
  tokenSymbol: string,
  networkLabel: string,
  recipient?: string,
) => {
  switch (operation) {
    case "shield":
      return `Shield ${amount} ${tokenSymbol} from the public wallet into Railgun on ${networkLabel}.`;
    case "transfer":
      return `Privately transfer ${amount} ${tokenSymbol} to Railgun address ${recipient ?? "unknown"} on ${networkLabel}.`;
    case "unshield":
      return `Unshield ${amount} ${tokenSymbol} from Railgun to public address ${recipient ?? "unknown"} on ${networkLabel}.`;
  }
};

const getApprovalThreshold = (operation: RailgunOperation) => {
  switch (operation) {
    case "shield":
      return currentConfig.shieldApprovalThreshold;
    case "transfer":
      return currentConfig.transferApprovalThreshold;
    case "unshield":
      return currentConfig.unshieldApprovalThreshold;
  }
};

const requiresLocalApproval = (
  operation: RailgunOperation,
  amountRaw: bigint,
  decimals: number,
) => {
  const threshold = getApprovalThreshold(operation);
  const thresholdRaw = parseTokenAmount(threshold, decimals);
  return amountRaw >= thresholdRaw;
};

const cleanupPendingRailgunApprovals = () => {
  const now = Date.now();
  for (const [approvalId, pendingApproval] of pendingRailgunApprovals.entries()) {
    const createdAt = Date.parse(pendingApproval.approval.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt >= RAILGUN_APPROVAL_TTL_MS) {
      pendingRailgunApprovals.delete(approvalId);
    }
  }
};

const buildActionResultBase = (
  operation: RailgunOperation,
  runtime: RailgunRuntime,
  token: RailgunToken,
  amount: string,
  recipient?: string,
): RailgunActionResultBase => {
  const privacyImpact = getPrivacyImpact(operation, currentConfig.networkLabel);

  return {
    railgun: true,
    operation,
    network: currentConfig.networkLabel,
    railgunAddress: runtime.railgunAddress,
    token: token.symbol,
    amount,
    recipient,
    summary: buildActionSummary(
      operation,
      amount,
      token.symbol,
      currentConfig.networkLabel,
      recipient,
    ),
    privacyImpact,
    privacyNote: privacyImpact,
  };
};

const createPendingApprovalResult = (
  operation: RailgunOperation,
  runtime: RailgunRuntime,
  token: RailgunToken,
  amount: string,
  amountRaw: bigint,
  execute: () => Promise<RailgunResult>,
  recipient?: string,
): RailgunApprovalRequiredResult => {
  cleanupPendingRailgunApprovals();

  const approvalId = crypto.randomUUID();
  const threshold = getApprovalThreshold(operation);
  const createdAt = new Date().toISOString();
  const base = buildActionResultBase(operation, runtime, token, amount, recipient);
  const approval: RailgunApprovalState = {
    id: approvalId,
    threshold,
    thresholdType: "token_amount",
    status: "awaiting_local_approval",
    submitted: false,
    createdAt,
  };

  pendingRailgunApprovals.set(approvalId, {
    ...base,
    approval,
    execute,
  });
  railgunLog("info", "approval:created", {
    amount,
    approvalId,
    operation,
    railgunAddress: runtime.railgunAddress,
    recipient,
    threshold,
    token: token.symbol,
  });

  if (amountRaw < parseTokenAmount(threshold, token.decimals)) {
    throw new Error("Approval state mismatch.");
  }

  return {
    ...base,
    status: "awaiting_local_approval",
    message:
      "Local approval is required before signing this Railgun action. Review the exact action summary and privacy impact below, then approve or cancel on this device.",
    approval,
  };
};

const buildCancelledApprovalResult = (
  pendingApproval: PendingRailgunApproval,
): RailgunCancelledResult => {
  return {
    railgun: true,
    operation: pendingApproval.operation,
    network: pendingApproval.network,
    railgunAddress: pendingApproval.railgunAddress,
    token: pendingApproval.token,
    amount: pendingApproval.amount,
    recipient: pendingApproval.recipient,
    summary: pendingApproval.summary,
    privacyImpact: pendingApproval.privacyImpact,
    privacyNote: pendingApproval.privacyNote,
    status: "cancelled",
    message:
      "Local approval was rejected. No Railgun transaction was signed or submitted.",
    approval: {
      ...pendingApproval.approval,
      status: "cancelled",
    },
  };
};

const buildShieldContext = async (
  token: string,
  amount: string,
): Promise<RailgunPreparedShield> => {
  const runtime = await getRuntime();
  const resolvedToken = await resolveToken(token);
  const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
  const signerAddress = getSignerAccount().address;
  railgunLog("info", "shield:context-build", {
    amount,
    signerAddress,
    token: resolvedToken.symbol,
    tokenAddress: resolvedToken.tokenAddress,
  });

  if (resolvedToken.isNative) {
    const publicBalance = await publicClient.getBalance({ address: signerAddress });
    railgunLog("info", "shield:public-balance-check", {
      amount,
      publicBalance,
      signerAddress,
      token: resolvedToken.symbol,
    });
    if (publicBalance < amountRaw) {
      throw new Error(
        `Insufficient public balance. Available: ${formatUnits(publicBalance, resolvedToken.decimals)} ${resolvedToken.symbol}.`,
      );
    }
  } else {
    const publicBalance = await publicClient.readContract({
      address: resolvedToken.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [signerAddress],
    });
    railgunLog("info", "shield:public-balance-check", {
      amount,
      publicBalance,
      signerAddress,
      token: resolvedToken.symbol,
      tokenAddress: resolvedToken.tokenAddress,
    });

    if (publicBalance < amountRaw) {
      throw new Error(
        `Insufficient public balance. Available: ${formatUnits(publicBalance, resolvedToken.decimals)} ${resolvedToken.symbol}.`,
      );
    }
  }

  return {
    runtime,
    token: resolvedToken,
    amount,
    amountRaw,
  };
};

const buildTransferContext = async (
  recipient: string,
  token: string,
  amount: string,
): Promise<RailgunPreparedTransfer> => {
  if (!recipient.startsWith("0zk")) {
    throw new Error("Railgun transfer recipients must use a 0zk address.");
  }

  const runtime = await getRuntime();
  const resolvedToken = await resolveToken(token);
  const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
  railgunLog("info", "transfer:context-build", {
    amount,
    recipient,
    token: resolvedToken.symbol,
    tokenAddress: resolvedToken.tokenAddress,
  });

  await syncWalletState(runtime, { reason: "transfer-context" });
  const spendableBalance = await getShieldedBalanceForToken(runtime, resolvedToken);
  const spendableBalanceRaw = parseTokenAmount(spendableBalance, resolvedToken.decimals);
  if (spendableBalanceRaw < amountRaw) {
    throw new Error(
      `Insufficient shielded balance. Available: ${spendableBalance} ${resolvedToken.symbol}.`,
    );
  }

  return {
    runtime,
    token: resolvedToken,
    amount,
    amountRaw,
    recipient,
  };
};

const buildUnshieldContext = async (
  recipient: string,
  token: string,
  amount: string,
): Promise<RailgunPreparedUnshield> => {
  const runtime = await getRuntime();
  const resolvedToken = await resolveToken(token);
  const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
  const recipientAddress = getAddress(recipient) as `0x${string}`;
  const signerAddress = getSignerAccount().address as `0x${string}`;
  railgunLog("info", "unshield:context-build", {
    amount,
    recipient: recipientAddress,
    signerAddress,
    token: resolvedToken.symbol,
    tokenAddress: resolvedToken.tokenAddress,
  });

  await syncWalletState(runtime, { reason: "unshield-context" });
  const spendableBalance = await getShieldedBalanceForToken(runtime, resolvedToken);
  const spendableBalanceRaw = await getSpendableShieldedBalanceRawForToken(
    runtime,
    resolvedToken,
    { includeOptimistic: false },
  );
  const recentOriginShield =
    spendableBalanceRaw < amountRaw
      ? await findRecentOriginShield(resolvedToken, signerAddress, amountRaw)
      : undefined;

  if (spendableBalanceRaw < amountRaw && !recentOriginShield) {
    throw new Error(
      `Insufficient shielded balance. Available: ${spendableBalance} ${resolvedToken.symbol}.`,
    );
  }

  const availablePrivateBalanceRaw =
    recentOriginShield
      ? BigInt(recentOriginShield.remainingAmountRaw)
      : spendableBalanceRaw;

  if (recentOriginShield) {
    railgunLog("warn", "unshield:using-origin-override", {
      actualSpendableBalanceRaw: spendableBalanceRaw,
      amount,
      originShieldTxid: recentOriginShield.txHash,
      recipient: recipientAddress,
      spendableBalance,
      token: resolvedToken.symbol,
    });
  }

  return {
    runtime,
    token: resolvedToken,
    amount,
    amountRaw,
    availablePrivateBalanceRaw,
    originShieldTxid: recentOriginShield?.txHash,
    recipient: recipientAddress,
  };
};

const buildErrorResult = (
  operation: RailgunResult["operation"],
  error: unknown,
  context?: Pick<
    RailgunErrorResult,
    "amount" | "balanceRouting" | "railgunAddress" | "recipient" | "token"
  >,
): RailgunErrorResult => {
  const message =
    error instanceof Error ? error.message : "Unknown Railgun error occurred.";
  railgunLog("error", "operation:error-result", {
    context,
    error,
    message,
    operation,
    scan: snapshotState(),
  });

  return {
    railgun: true,
    status: "error",
    operation,
    network: currentConfig.networkLabel,
    message,
    ...context,
    setup: clearRailgunSecrets(),
  };
};

async function executeShield(
  prepared: RailgunPreparedShield,
): Promise<RailgunActionSuccessResult> {
  return withRailgunTiming(
    "operation:shield",
    {
      amount: prepared.amount,
      railgunAddress: prepared.runtime.railgunAddress,
      token: prepared.token.symbol,
      tokenAddress: prepared.token.tokenAddress,
    },
    async () => {
      const stages: RailgunOperationStage[] = [];

      await syncWalletState(prepared.runtime, { reason: "shield-preflight" });
      stages.push({
        label: "Wallet sync complete",
        status: "completed",
        detail: prepared.runtime.state.lastSyncAt,
      });

      const shieldedBalanceBeforeRaw = await getSpendableShieldedBalanceRawForToken(
        prepared.runtime,
        prepared.token,
      );

      const approvalTxHash = await ensureAllowance(prepared.token, prepared.amountRaw);
      stages.push({
        label: prepared.token.isNative ? "Token approval" : "Token approval ready",
        status: approvalTxHash ? "completed" : "skipped",
        detail: approvalTxHash,
      });

      const shieldPrivateKey = await getShieldPrivateKey();
      railgunLog("info", "operation:shield-gas-estimate", {
        isNative: prepared.token.isNative,
        token: prepared.token.symbol,
      });
      const gasEstimate = prepared.token.isNative
        ? await gasEstimateForShieldBaseToken(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            prepared.runtime.railgunAddress,
            shieldPrivateKey,
            {
              tokenAddress: prepared.token.tokenAddress,
              amount: prepared.amountRaw,
            },
            getSignerAccount().address,
          )
        : await gasEstimateForShield(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            shieldPrivateKey,
            [
              {
                tokenAddress: prepared.token.tokenAddress,
                amount: prepared.amountRaw,
                recipientAddress: prepared.runtime.railgunAddress,
              },
            ],
            [],
            getSignerAccount().address,
          );
      railgunLog("info", "operation:shield-gas-estimated", {
        gasEstimate: gasEstimate.gasEstimate,
      });
      const gasDetails = await getGasDetails(gasEstimate.gasEstimate);

      railgunLog("info", "operation:shield-populate", {
        gasEstimate: gasEstimate.gasEstimate,
      });
      const populated = prepared.token.isNative
        ? await populateShieldBaseToken(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            prepared.runtime.railgunAddress,
            shieldPrivateKey,
            {
              tokenAddress: prepared.token.tokenAddress,
              amount: prepared.amountRaw,
            },
            gasDetails,
          )
        : await populateShield(
            RAILGUN_TXID_VERSION,
            RAILGUN_NETWORK,
            shieldPrivateKey,
            [
              {
                tokenAddress: prepared.token.tokenAddress,
                amount: prepared.amountRaw,
                recipientAddress: prepared.runtime.railgunAddress,
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
      await rememberRecentShield(
        txHash,
        prepared.token,
        getSignerAccount().address as `0x${string}`,
        prepared.amountRaw,
      );
      const optimisticShieldedBalanceAfterRaw =
        shieldedBalanceBeforeRaw + prepared.amountRaw;
      setOptimisticShieldedBalance(
        prepared.token,
        optimisticShieldedBalanceAfterRaw,
        "shield-post-transaction",
      );
      markWalletStateFresh("shield-post-transaction-optimistic");
      const shieldedBalanceAfter = formatUnits(
        optimisticShieldedBalanceAfterRaw,
        prepared.token.decimals,
      );
      void startBackgroundRefresh("shield-post-transaction", { delayMs: 2_000 });
      stages.push({
        label: "Private balance indexing in background",
        status: "completed",
        detail: shieldedBalanceAfter,
      });

      railgunLog("info", "operation:shield-complete", {
        shieldedBalanceAfter,
        txHash,
      });

      return {
        ...buildActionResultBase(
          "shield",
          prepared.runtime,
          prepared.token,
          prepared.amount,
        ),
        status: "success",
        txHash,
        explorerUrl: explorerUrlForTx(txHash),
        approvalTxHash,
        stages,
        shieldedBalanceAfter,
        balanceIndexing: "pending",
        scan: snapshotState(),
      };
    },
  );
}

async function executeTransfer(
  prepared: RailgunPreparedTransfer,
): Promise<RailgunActionSuccessResult> {
  return withRailgunTiming(
    "operation:transfer",
    {
      amount: prepared.amount,
      railgunAddress: prepared.runtime.railgunAddress,
      recipient: prepared.recipient,
      token: prepared.token.symbol,
      tokenAddress: prepared.token.tokenAddress,
    },
    async () => {
      const proofProgress: ProofStage[] = [];
      const stages: RailgunOperationStage[] = [];
      let lastProofLog = "";

      await syncWalletState(prepared.runtime, { reason: "transfer-preflight" });
      stages.push({
        label: "Wallet sync complete",
        status: "completed",
        detail: prepared.runtime.state.lastSyncAt,
      });

      const spendableBalance = await getShieldedBalanceForToken(
        prepared.runtime,
        prepared.token,
      );
      const spendableBalanceRaw = parseTokenAmount(
        spendableBalance,
        prepared.token.decimals,
      );
      if (spendableBalanceRaw < prepared.amountRaw) {
        throw new Error(
          `Insufficient shielded balance. Available: ${spendableBalance} ${prepared.token.symbol}.`,
        );
      }

      const originalGasDetails = await getGasDetails(BigInt(0));
      const gasEstimate = await gasEstimateForUnprovenTransfer(
        RAILGUN_TXID_VERSION,
        RAILGUN_NETWORK,
        prepared.runtime.walletId,
        prepared.runtime.encryptionKey,
        undefined,
        [
          {
            tokenAddress: prepared.token.tokenAddress,
            amount: prepared.amountRaw,
            recipientAddress: prepared.recipient,
          },
        ],
        [],
        originalGasDetails,
        undefined,
        true,
      );
      railgunLog("info", "operation:transfer-gas-estimated", {
        gasEstimate: gasEstimate.gasEstimate,
      });
      const gasDetails = await getGasDetails(gasEstimate.gasEstimate);
      stages.push({
        label: "Gas estimated",
        status: "completed",
        detail: gasEstimate.gasEstimate.toString(),
      });

      await generateTransferProof(
        RAILGUN_TXID_VERSION,
        RAILGUN_NETWORK,
        prepared.runtime.walletId,
        prepared.runtime.encryptionKey,
        false,
        undefined,
        [
          {
            tokenAddress: prepared.token.tokenAddress,
            amount: prepared.amountRaw,
            recipientAddress: prepared.recipient,
          },
        ],
        [],
        undefined,
        true,
        undefined,
        (progress, status) => {
          proofProgress.push({ progress, status });
          const nextLog = `${progress}:${status}`;
          if (nextLog !== lastProofLog) {
            lastProofLog = nextLog;
            railgunLog("info", "operation:transfer-proof-progress", {
              progress,
              status,
            });
          }
        },
      );
      stages.push({
        label: "Zero-knowledge proof generated",
        status: "completed",
      });

      railgunLog("info", "operation:transfer-populate");
      const populated = await populateProvedTransfer(
        RAILGUN_TXID_VERSION,
        RAILGUN_NETWORK,
        prepared.runtime.walletId,
        false,
        undefined,
        [
          {
            tokenAddress: prepared.token.tokenAddress,
            amount: prepared.amountRaw,
            recipientAddress: prepared.recipient,
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

      const shieldedBalanceAfterRaw = spendableBalanceRaw - prepared.amountRaw;
      setOptimisticShieldedBalance(
        prepared.token,
        shieldedBalanceAfterRaw,
        "transfer-post-transaction",
      );
      markWalletStateFresh("transfer-post-transaction");
      const shieldedBalanceAfter = formatUnits(
        shieldedBalanceAfterRaw,
        prepared.token.decimals,
      );
      stages.push({
        label: "Shielded balance updated",
        status: "completed",
        detail: shieldedBalanceAfter,
      });

      railgunLog("info", "operation:transfer-complete", {
        shieldedBalanceAfter,
        txHash,
      });

      return {
        ...buildActionResultBase(
          "transfer",
          prepared.runtime,
          prepared.token,
          prepared.amount,
          prepared.recipient,
        ),
        status: "success",
        txHash,
        explorerUrl: explorerUrlForTx(txHash),
        stages,
        proofProgress: dedupeProofStages(proofProgress),
        shieldedBalanceAfter,
        scan: snapshotState(),
      };
    },
  );
}

async function executeUnshield(
  prepared: RailgunPreparedUnshield,
): Promise<RailgunActionSuccessResult> {
  return withRailgunTiming(
    "operation:unshield",
    {
      amount: prepared.amount,
      railgunAddress: prepared.runtime.railgunAddress,
      recipient: prepared.recipient,
      token: prepared.token.symbol,
      tokenAddress: prepared.token.tokenAddress,
    },
    async () => {
      const proofProgress: ProofStage[] = [];
      const stages: RailgunOperationStage[] = [];
      let lastProofLog = "";
      const wrappedAmount: RailgunERC20Amount = {
        tokenAddress: prepared.token.tokenAddress,
        amount: prepared.amountRaw,
      };
      const recipientAmount: RailgunERC20AmountRecipient = {
        ...wrappedAmount,
        recipientAddress: prepared.recipient,
      };

      await syncWalletState(prepared.runtime, { reason: "unshield-preflight" });
      stages.push({
        label: "Wallet sync complete",
        status: "completed",
        detail: prepared.runtime.state.lastSyncAt,
      });

      if (prepared.availablePrivateBalanceRaw < prepared.amountRaw) {
        throw new Error(
          `Insufficient shielded balance. Available: ${formatUnits(prepared.availablePrivateBalanceRaw, prepared.token.decimals)} ${prepared.token.symbol}.`,
        );
      }

      const originalGasDetails = await getGasDetails(BigInt(0));
      const gasEstimate =
        prepared.originShieldTxid
          ? await gasEstimateForUnprovenUnshieldToOrigin(
              prepared.originShieldTxid,
              RAILGUN_TXID_VERSION,
              RAILGUN_NETWORK,
              prepared.runtime.walletId,
              prepared.runtime.encryptionKey,
              [recipientAmount],
              [],
            )
          : await gasEstimateForUnprovenUnshield(
              RAILGUN_TXID_VERSION,
              RAILGUN_NETWORK,
              prepared.runtime.walletId,
              prepared.runtime.encryptionKey,
              [recipientAmount],
              [],
              originalGasDetails,
              undefined,
              true,
            );
      railgunLog("info", "operation:unshield-gas-estimated", {
        gasEstimate: gasEstimate.gasEstimate,
        isNative: prepared.token.isNative,
        originShieldTxid: prepared.originShieldTxid,
      });
      const gasDetails = await getGasDetails(gasEstimate.gasEstimate);
      stages.push({
        label: "Gas estimated",
        status: "completed",
        detail: gasEstimate.gasEstimate.toString(),
      });
      if (prepared.originShieldTxid) {
        stages.push({
          label: "Using fresh shield override",
          status: "completed",
          detail: prepared.originShieldTxid,
        });
      }

      if (prepared.originShieldTxid) {
        await generateUnshieldToOriginProof(
          prepared.originShieldTxid,
          RAILGUN_TXID_VERSION,
          RAILGUN_NETWORK,
          prepared.runtime.walletId,
          prepared.runtime.encryptionKey,
          [recipientAmount],
          [],
          (progress: number, status: string) => {
            proofProgress.push({ progress, status });
            const nextLog = `${progress}:${status}`;
            if (nextLog !== lastProofLog) {
              lastProofLog = nextLog;
              railgunLog("info", "operation:unshield-proof-progress", {
                originShieldTxid: prepared.originShieldTxid,
                progress,
                status,
              });
            }
          },
        );
      } else {
        await generateUnshieldProof(
          RAILGUN_TXID_VERSION,
          RAILGUN_NETWORK,
          prepared.runtime.walletId,
          prepared.runtime.encryptionKey,
          [recipientAmount],
          [],
          undefined,
          true,
          undefined,
          (progress, status) => {
            proofProgress.push({ progress, status });
            const nextLog = `${progress}:${status}`;
            if (nextLog !== lastProofLog) {
              lastProofLog = nextLog;
              railgunLog("info", "operation:unshield-proof-progress", {
                progress,
                status,
              });
            }
          },
        );
      }
      stages.push({
        label: "Zero-knowledge proof generated",
        status: "completed",
      });

      railgunLog("info", "operation:unshield-populate");
      const populated =
        prepared.originShieldTxid
          ? await populateProvedUnshieldToOrigin(
              RAILGUN_TXID_VERSION,
              RAILGUN_NETWORK,
              prepared.runtime.walletId,
              [recipientAmount],
              [],
              gasDetails,
            )
          : await populateProvedUnshield(
              RAILGUN_TXID_VERSION,
              RAILGUN_NETWORK,
              prepared.runtime.walletId,
              [recipientAmount],
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

      if (prepared.originShieldTxid) {
        await consumeRecentOriginShield(prepared.originShieldTxid, prepared.amountRaw);
      }
      const shieldedBalanceAfterRaw =
        prepared.availablePrivateBalanceRaw - prepared.amountRaw;
      setOptimisticShieldedBalance(
        prepared.token,
        shieldedBalanceAfterRaw,
        "unshield-post-transaction",
      );
      markWalletStateFresh("unshield-post-transaction");
      const shieldedBalanceAfter = formatUnits(
        shieldedBalanceAfterRaw,
        prepared.token.decimals,
      );
      const publicBalanceAfter = await getPublicBalanceForToken(
        prepared.recipient,
        prepared.token,
      );
      stages.push({
        label: "Balances updated",
        status: "completed",
        detail: `${shieldedBalanceAfter} private / ${publicBalanceAfter} public`,
      });

      railgunLog("info", "operation:unshield-complete", {
        publicBalanceAfter,
        shieldedBalanceAfter,
        txHash,
      });

      return {
        ...buildActionResultBase(
          "unshield",
          prepared.runtime,
          prepared.token,
          prepared.amount,
          prepared.recipient,
        ),
        status: "success",
        txHash,
        explorerUrl: explorerUrlForTx(txHash),
        stages,
        proofProgress: dedupeProofStages(proofProgress),
        shieldedBalanceAfter,
        publicBalanceAfter,
        scan: snapshotState(),
      };
    },
  );
}

const buildBalanceRouting = async (
  runtime: RailgunRuntime,
  token: RailgunToken,
  amount: string,
  amountRaw: bigint,
  requestedOperation: RailgunPrivateAction,
): Promise<RailgunBalanceRouting> => {
  const shieldedBalance = await getShieldedBalanceForToken(runtime, token);
  const shieldedBalanceRaw = parseTokenAmount(shieldedBalance, token.decimals);
  const publicAddress = getSignerAccount().address as `0x${string}`;
  const publicBalance = await getPublicBalanceForToken(publicAddress, token);
  const publicBalanceRaw = parseTokenAmount(publicBalance, token.decimals);
  railgunLog("info", "balance:routing-evaluated", {
    amount,
    publicAddress,
    publicBalance,
    requestedOperation,
    shieldedBalance,
    token: token.symbol,
  });

  if (shieldedBalanceRaw >= amountRaw) {
    return {
      requestedOperation,
      route: "proceed",
      token: token.symbol,
      requestedAmount: amount,
      shieldedBalance,
      publicBalance,
      publicAddress,
      recommendation: `Private balance is sufficient. Proceed with the Railgun ${requestedOperation}.`,
      privacyGuidance: currentConfig.privacyGuidanceText,
    };
  }

  const shortfallRaw = amountRaw - shieldedBalanceRaw;
  const shortfall = formatUnits(shortfallRaw, token.decimals);
  if (publicBalanceRaw >= shortfallRaw) {
    return {
      requestedOperation,
      route: "shield_then_retry",
      token: token.symbol,
      requestedAmount: amount,
      shieldedBalance,
      publicBalance,
      shortfall,
      publicAddress,
      recommendation: `Shield at least ${shortfall} ${token.symbol} from ${publicAddress} into Railgun, then retry the private ${requestedOperation}.`,
      privacyGuidance: currentConfig.privacyGuidanceText,
    };
  }

  return {
    requestedOperation,
    route: "fund_public_wallet",
    token: token.symbol,
    requestedAmount: amount,
    shieldedBalance,
    publicBalance,
    shortfall,
    publicAddress,
    recommendation: `You need ${amount} ${token.symbol} for the private ${requestedOperation}, but only ${shieldedBalance} is private and ${publicBalance} is public. Fund the public wallet first, then shield the shortfall into Railgun.`,
    privacyGuidance: currentConfig.privacyGuidanceText,
  };
};

function buildInsufficientPrivateBalanceResult(
  operation: RailgunPrivateAction,
  routing: RailgunBalanceRouting,
  runtime: RailgunRuntime,
  amount: string,
  recipient: string,
): Extract<RailgunResult, { status: "error" }> {
  const shortfallText = routing.shortfall
    ? ` Shortfall: ${routing.shortfall} ${routing.token}.`
    : "";
  const recommendationText =
    routing.route === "shield_then_retry"
      ? ` ${routing.recommendation}`
      : ` ${routing.recommendation}`;

  return {
    railgun: true,
    status: "error",
    operation,
    network: currentConfig.networkLabel,
    token: routing.token,
    amount,
    recipient,
    railgunAddress: runtime.railgunAddress,
    balanceRouting: routing,
    message:
      `Insufficient private balance for this Railgun ${operation}. ` +
      `Private: ${routing.shieldedBalance} ${routing.token}. ` +
      `Public: ${routing.publicBalance} ${routing.token}.${shortfallText}${recommendationText}`,
    setup: clearRailgunSecrets(),
  };
}

export async function railgunBalance(
  token?: string,
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<RailgunResult> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return withRailgunLock("railgun_balance", async () => {
    try {
      railgunLog("info", "tool:railgun_balance", { token: token ?? "all" });
      const runtime = await getRuntime();
      const cachedSnapshot = await loadBalanceSnapshot();
      const cachedAgeMs = cachedSnapshot
        ? Math.max(Date.now() - Date.parse(cachedSnapshot.updatedAt), 0)
        : Number.POSITIVE_INFINITY;
      const shouldUseCached =
        cachedSnapshot != null &&
        cachedSnapshot.railgunAddress === runtime.railgunAddress &&
        cachedSnapshot.chainId === currentConfig.chainId;

      if (shouldUseCached && cachedSnapshot) {
        const refreshing =
          cachedAgeMs >= Math.floor(RAILGUN_BALANCE_CACHE_MAX_AGE_MS / 2)
            ? startBackgroundRefresh("balance-cache-refresh", { delayMs: 2_000 })
            : Boolean(backgroundRefreshPromise || backgroundRefreshTimer);

        return {
          railgun: true,
          status: "success",
          operation: "balance",
          network: currentConfig.networkLabel,
          railgunAddress: cachedSnapshot.railgunAddress,
          scan: cachedSnapshot.scan,
          balances: await filterBalanceRows(cachedSnapshot.balances, token),
          freshness: getFreshness(cachedSnapshot.updatedAt, "cache", refreshing),
        };
      }

      await syncWalletState(runtime, { reason: "balance-tool" });
      const snapshot = await persistBalanceSnapshot(runtime);

      return {
        railgun: true,
        status: "success",
        operation: "balance",
        network: currentConfig.networkLabel,
        railgunAddress: snapshot.railgunAddress,
        scan: snapshot.scan,
        balances: await filterBalanceRows(snapshot.balances, token),
        freshness: getFreshness(snapshot.updatedAt, "live", false),
      };
    } catch (error) {
      return buildErrorResult("balance", error);
    }
  });
}

export async function railgunBalanceRoute(
  requestedOperation: RailgunPrivateAction,
  token: string,
  amount: string,
  runtimeConfig?: RailgunToolRuntimeConfig,
): Promise<RailgunResult> {
  if (runtimeConfig) {
    setRailgunToolRuntimeConfig(runtimeConfig);
  }

  return withRailgunLock("railgun_balance_route", async () => {
    try {
      railgunLog("info", "tool:railgun_balance_route", {
        amount,
        requestedOperation,
        token,
      });
      const runtime = await getRuntime();
      const resolvedToken = await resolveToken(token);
      const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);

      await refreshWalletStateForRouting(runtime);
      const balanceRouting = await buildBalanceRouting(
        runtime,
        resolvedToken,
        amount,
        amountRaw,
        requestedOperation,
      );

      return {
        railgun: true,
        status: "success",
        operation: "route",
        network: currentConfig.networkLabel,
        railgunAddress: runtime.railgunAddress,
        scan: snapshotState(),
        balanceRouting,
      };
    } catch (error) {
      return buildErrorResult("route", error);
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

  return withRailgunLock("railgun_shield", async () => {
    try {
      railgunLog("info", "tool:railgun_shield", { amount, token });
      const prepared = await buildShieldContext(token, amount);
      if (
        requiresLocalApproval(
          "shield",
          prepared.amountRaw,
          prepared.token.decimals,
        )
      ) {
        const capturedConfig = cloneRailgunToolRuntimeConfig(currentConfig);
        const tokenSelector = prepared.token.isNative
          ? "ETH"
          : prepared.token.tokenAddress;

        return createPendingApprovalResult(
          "shield",
          prepared.runtime,
          prepared.token,
          prepared.amount,
          prepared.amountRaw,
          async () => {
            setRailgunToolRuntimeConfig(capturedConfig);
            try {
              return await executeShield(
                await buildShieldContext(tokenSelector, prepared.amount),
              );
            } catch (error) {
              return buildErrorResult("shield", error);
            }
          },
        );
      }

      return await executeShield(prepared);
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

  return withRailgunLock("railgun_transfer", async () => {
    try {
      railgunLog("info", "tool:railgun_transfer", { amount, recipient, token });
      const runtime = await getRuntime();
      const normalizedRecipient = recipient.trim();
      if (!normalizedRecipient.startsWith("0zk")) {
        throw new Error(
          "Railgun private transfers require a 0zk recipient. For ENS names or public 0x addresses, resolve ENS first and use railgun_unshield instead.",
        );
      }

      const resolvedToken = await resolveToken(token);
      const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
      await refreshWalletStateForRouting(runtime);
      const balanceRouting = await buildBalanceRouting(
        runtime,
        resolvedToken,
        amount,
        amountRaw,
        "transfer",
      );
      if (balanceRouting.route !== "proceed") {
        return buildInsufficientPrivateBalanceResult(
          "transfer",
          balanceRouting,
          runtime,
          amount,
          recipient,
        );
      }

      const tokenSelector = resolvedToken.isNative ? "ETH" : resolvedToken.tokenAddress;
      if (
        requiresLocalApproval(
          "transfer",
          amountRaw,
          resolvedToken.decimals,
        )
      ) {
        const capturedConfig = cloneRailgunToolRuntimeConfig(currentConfig);
        return createPendingApprovalResult(
          "transfer",
          runtime,
          resolvedToken,
          amount,
          amountRaw,
          async () => {
            setRailgunToolRuntimeConfig(capturedConfig);
            try {
              return await executeTransfer(
                await buildTransferContext(
                  normalizedRecipient,
                  tokenSelector,
                  amount,
                ),
              );
            } catch (error) {
              return buildErrorResult("transfer", error, {
                amount,
                recipient: normalizedRecipient,
                token: resolvedToken.symbol,
              });
            }
          },
          normalizedRecipient,
        );
      }

      const prepared = await buildTransferContext(
        normalizedRecipient,
        tokenSelector,
        amount,
      );
      return await executeTransfer(prepared);
    } catch (error) {
      return buildErrorResult("transfer", error, { amount, recipient, token });
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

  return withRailgunLock("railgun_unshield", async () => {
    try {
      railgunLog("info", "tool:railgun_unshield", { amount, recipient, token });
      const runtime = await getRuntime();
      const resolvedToken = await resolveToken(token);
      await refreshWalletStateForRouting(runtime);
      const tokenSelector = resolvedToken.isNative ? "ETH" : resolvedToken.tokenAddress;
      let prepared: RailgunPreparedUnshield;
      try {
        prepared = await buildUnshieldContext(recipient, tokenSelector, amount);
      } catch {
        const amountRaw = parseTokenAmount(amount, resolvedToken.decimals);
        const balanceRouting = await buildBalanceRouting(
          runtime,
          resolvedToken,
          amount,
          amountRaw,
          "unshield",
        );
        return buildInsufficientPrivateBalanceResult(
          "unshield",
          balanceRouting,
          runtime,
          amount,
          recipient,
        );
      }
      if (
        requiresLocalApproval(
          "unshield",
          prepared.amountRaw,
          prepared.token.decimals,
        )
      ) {
        const capturedConfig = cloneRailgunToolRuntimeConfig(currentConfig);
        return createPendingApprovalResult(
          "unshield",
          prepared.runtime,
          prepared.token,
          prepared.amount,
          prepared.amountRaw,
          async () => {
            setRailgunToolRuntimeConfig(capturedConfig);
            try {
              return await executeUnshield(
                await buildUnshieldContext(
                  prepared.recipient,
                  tokenSelector,
                  prepared.amount,
                ),
              );
            } catch (error) {
              return buildErrorResult("unshield", error);
            }
          },
          prepared.recipient,
        );
      }

      return await executeUnshield(prepared);
    } catch (error) {
      return buildErrorResult("unshield", error, { amount, recipient, token });
    }
  });
}

export async function approveRailgunAction(
  approvalId: string,
): Promise<RailgunResult> {
  cleanupPendingRailgunApprovals();
  const pendingApproval = pendingRailgunApprovals.get(approvalId);

  if (!pendingApproval) {
    throw new Error("Railgun approval request was not found or has expired.");
  }

  pendingRailgunApprovals.delete(approvalId);
  railgunLog("info", "approval:approved", {
    approvalId,
    operation: pendingApproval.operation,
    railgunAddress: pendingApproval.railgunAddress,
  });
  return withRailgunLock("approve_railgun_action", () => pendingApproval.execute());
}

export function rejectRailgunAction(approvalId: string): RailgunResult {
  cleanupPendingRailgunApprovals();
  const pendingApproval = pendingRailgunApprovals.get(approvalId);

  if (!pendingApproval) {
    throw new Error("Railgun approval request was not found or has expired.");
  }

  pendingRailgunApprovals.delete(approvalId);
  railgunLog("info", "approval:rejected", {
    approvalId,
    operation: pendingApproval.operation,
    railgunAddress: pendingApproval.railgunAddress,
  });
  return buildCancelledApprovalResult(pendingApproval);
}
