import fs from "node:fs";
import path from "node:path";
import {
  createRailgunAccount,
  createRailgunIndexer,
  RAILGUN_CONFIG_BY_CHAIN_ID,
  type RailgunAccount,
  type RailgunAddress,
  type RailgunNetworkConfig,
  type Indexer,
  type StorageLayer,
} from "@kohaku-eth/railgun";
import { viem as viemProvider, ViemSignerAdapter } from "@kohaku-eth/provider/viem";
import type { TxData } from "@kohaku-eth/provider";
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
import { type RuntimeConfig } from "./runtime-config";
import { signLocalActionId, verifyLocalActionId } from "./signed-action-id";
import { isSnapshotNeeded, loadBundledSnapshot, loadBundledAccountSnapshot } from "./railgun-snapshot";

const ARBITRUM_CHAIN_ID = "42161" as const;

// Kohaku alpha only ships mainnet + Sepolia configs.
// Register the Arbitrum One Railgun deployment so the indexer and account
// know which contract to watch and how to encode transactions.
if (!RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID]) {
  (RAILGUN_CONFIG_BY_CHAIN_ID as Record<string, RailgunNetworkConfig>)[ARBITRUM_CHAIN_ID] = {
    NAME: "Arbitrum",
    RAILGUN_ADDRESS: "0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9",
    GLOBAL_START_BLOCK: 56109834,
    CHAIN_ID: 42161n,
    RELAY_ADAPT_ADDRESS: "0x5aD95C537b002770a39dea342c4bb2b68B1497aA",
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    FEE_BASIS_POINTS: 25n,
  };
}

const TOKEN_ALIASES: Record<string, `0x${string}`> = {
  USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

type RailgunToken = {
  tokenAddress: `0x${string}`;
  symbol: string;
  decimals: number;
  isNative: boolean;
};

type RailgunRuntimeState = {
  lastSyncAt?: string;
  syncStatus?: string;
};

type RailgunRuntime = {
  account: RailgunAccount;
  indexer: Indexer;
  railgunAddress: string;
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

type ProofStage = {
  progress: number;
  status: string;
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
const RAILGUN_APPROVAL_TTL_MS = 10 * 60 * 1000;
const RAILGUN_SYNC_FRESH_MS = 5 * 60 * 1000;
const RAILGUN_BALANCE_CACHE_MAX_AGE_MS = 60 * 1000;
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

// The kohaku SDK sprays console.log with internal debug noise
// ("waking producer", "yielded batch", "pump post wake", etc.).
// Mute console.log during SDK calls and re-emit only meaningful lines.
const SDK_NOISE_PATTERNS = [
  "waking producer", "waked producer", "yielded batch",
  "pump post wake", "received item", "pushed item",
  "[sync]: yielding", "[sync]: yielded", "call", "yield",
  "saving trees", "saving base storage", "transfer function created",
  "Registering account", "loading base storage",
];

async function suppressSdkNoise<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (SDK_NOISE_PATTERNS.some((p) => msg === p || msg.startsWith(p))) {
      return;
    }
    // Let through meaningful SDK logs (e.g. "Starting sync from block X")
    if (msg.startsWith("Starting sync from block")) {
      const match = msg.match(/from block\s+(\d+)\s+to block\s+(\d+)/);
      if (match) {
        railgunLog("info", "indexer:sync-range", {
          fromBlock: Number(match[1]),
          toBlock: Number(match[2]),
        });
      }
      return;
    }
    if (msg.startsWith("Processing batch of logs")) {
      return; // suppress per-batch noise
    }
    originalLog.apply(console, args);
  };
  try {
    return await fn();
  } finally {
    console.log = originalLog;
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

function createDefaultRailgunToolRuntimeConfig(): RailgunToolRuntimeConfig {
  return {
    networkLabel: config.railgun.networkLabel,
    rpcUrl: config.railgun.rpcUrl,
    chainId: config.railgun.chainId,
    explorerTxBaseUrl: config.railgun.explorerTxBaseUrl,
    privacyGuidanceText: config.railgun.privacyGuidanceText,
    mnemonic: "",
    signerPrivateKey: "",
    shieldApprovalThreshold: config.railgun.shieldApprovalThreshold,
    transferApprovalThreshold: config.railgun.transferApprovalThreshold,
    unshieldApprovalThreshold: config.railgun.unshieldApprovalThreshold,
  };
}

let currentConfig = createDefaultRailgunToolRuntimeConfig();
let currentConfigFingerprint = JSON.stringify(currentConfig);
let railgunConfigLocked = false;
let publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(currentConfig.rpcUrl),
});

function resetRuntimeState() {
  runtimeState.lastSyncAt = undefined;
  runtimeState.syncStatus = undefined;
  lastCompletedSyncAtMs = 0;
  optimisticShieldedBalances.clear();
}

function cloneRailgunToolRuntimeConfig(
  value: RailgunToolRuntimeConfig,
): RailgunToolRuntimeConfig {
  return { ...value };
}

function setRailgunToolRuntimeConfig(nextConfig: RailgunToolRuntimeConfig) {
  const fingerprint = JSON.stringify(nextConfig);

  if (fingerprint === currentConfigFingerprint) {
    return;
  }

  if (railgunConfigLocked) {
    throw new Error(
      "Railgun runtime config is fixed for this server process. Restart the app before changing Railgun settings.",
    );
  }

  currentConfig = nextConfig;
  currentConfigFingerprint = fingerprint;
  railgunConfigLocked = true;
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
    rpcUrl: currentConfig.rpcUrl,
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

const getRailgunBalanceSnapshotPath = () =>
  path.join(getRailgunStorageDir(), "balance-snapshot.json");

const getRailgunIndexerStoragePath = () =>
  path.join(getRailgunStorageDir(), "indexer-state.json");

const getRailgunAccountStoragePath = () =>
  path.join(getRailgunStorageDir(), "account-state.json");

const fileExists = async (targetPath: string) => {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const createFileStorageLayer = (filePath: string): StorageLayer => ({
  get: async () => {
    if (!(await fileExists(filePath))) {
      return undefined;
    }
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw) as object;
  },
  set: async (data: object) => {
    await ensureContextDir();
    await fs.promises.writeFile(filePath, JSON.stringify(data));
  },
});

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

const clearRailgunSecrets = () => [
  "Set a BIP39 seed phrase in Settings to derive your Railgun private keys.",
  "Set an EOA private key in Settings if you want the assistant to submit Arbitrum transactions on your behalf.",
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
  const mnemonic = currentConfig.mnemonic.trim();
  if (!mnemonic) {
    throw new Error(
      "Missing seed phrase. Configure it in Settings first.",
    );
  }
  return mnemonic;
};

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

const shouldSkipFreshSync = (force: boolean) =>
  !force &&
  lastCompletedSyncAtMs > 0 &&
  Date.now() - lastCompletedSyncAtMs < RAILGUN_SYNC_FRESH_MS;

const syncWalletState = async (
  runtime: RailgunRuntime,
  options?: {
    force?: boolean;
    reason?: string;
  },
) => {
  const force = options?.force ?? false;
  const reason = options?.reason ?? "general";

  if (shouldSkipFreshSync(force)) {
    railgunLog("info", "wallet:sync-skipped-fresh", {
      ageMs: Date.now() - lastCompletedSyncAtMs,
      railgunAddress: runtime.railgunAddress,
      reason,
    });
    return;
  }

  await withRailgunTiming(
    "wallet:sync",
    {
      force,
      railgunAddress: runtime.railgunAddress,
      reason,
    },
    async () => {
      runtimeState.syncStatus = "syncing";
      if (runtime.indexer.sync) {
        const startBlock = runtime.indexer.getEndBlock();
        try {
          await Promise.race([
            suppressSdkNoise(() => runtime.indexer.sync!()),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Railgun sync timed out.")),
                120_000,
              ),
            ),
          ]);
          const endBlock = runtime.indexer.getEndBlock();
          railgunLog("info", "wallet:sync-done", {
            fromBlock: startBlock,
            toBlock: endBlock,
            blocksScanned: endBlock - startBlock,
            reason,
          });
        } catch (syncError) {
          const endBlock = runtime.indexer.getEndBlock();
          // The kohaku RPC sync can fail on public RPCs with rate limits,
          // block-range errors, or simply take too long on initial load.
          // Treat sync failures as non-fatal — the wallet proceeds with
          // whatever state was already indexed.
          railgunLog("warn", "wallet:sync-partial", {
            fromBlock: startBlock,
            toBlock: endBlock,
            blocksScanned: endBlock - startBlock,
            error: syncError instanceof Error ? syncError.message : syncError,
            reason,
          });
        }
      }
      clearOptimisticShieldedBalances(`sync:${reason}`);
      markWalletStateFresh(`sync:${reason}`);
      runtimeState.syncStatus = "complete";
    },
  );
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

const initializeRailgun = async (): Promise<RailgunRuntime> => {
  return withRailgunTiming(
    "runtime:initialize",
    {
      chainId: currentConfig.chainId,
      network: currentConfig.networkLabel,
    },
    async () => {
      await ensureContextDir();

      const mnemonic = deriveRailgunMnemonic();
      const fingerprint = getWalletFingerprint(mnemonic);

      railgunLog("info", "runtime:wallet-derived", { fingerprint });

      const networkConfig = RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID];
      if (!networkConfig) {
        throw new Error(`No Railgun network config found for chain ID ${ARBITRUM_CHAIN_ID}`);
      }

      const provider = viemProvider(publicClient);

      const indexerStoragePath = getRailgunIndexerStoragePath();
      const indexerStorage = createFileStorageLayer(indexerStoragePath);
      const accountStorage = createFileStorageLayer(getRailgunAccountStoragePath());

      railgunLog("info", "indexer:create", {
        chainId: ARBITRUM_CHAIN_ID,
        network: networkConfig.NAME,
      });

      // Try loading from a bundled snapshot first (near-instant) before
      // falling back to a full RPC sync from scratch.
      const useSnapshot = await isSnapshotNeeded(indexerStoragePath);
      let indexer: Indexer;

      if (useSnapshot) {
        const snapshotData = await loadBundledSnapshot();
        if (snapshotData) {
          railgunLog("info", "indexer:loaded-from-snapshot", {
            endBlock: snapshotData.endBlock,
          });
          indexer = await suppressSdkNoise(() =>
            createRailgunIndexer({
              network: networkConfig,
              provider,
              loadState: snapshotData,
            }),
          );
          // Persist to file so subsequent launches resume from file storage
          await indexerStorage.set(indexer.getSerializedState());
        } else {
          railgunLog("warn", "indexer:snapshot-load-failed", {});
          // Fall back to normal storage-based init
          const currentBlock = Number(await provider.getBlockNumber());
          const defaultStartBlock = Math.max(
            currentBlock - 1_000_000,
            networkConfig.GLOBAL_START_BLOCK,
          );
          indexer = await suppressSdkNoise(() =>
            createRailgunIndexer({
              network: networkConfig,
              provider,
              storage: indexerStorage,
              startBlock: defaultStartBlock,
            }),
          );
        }
      } else {
        // Existing local state is fresher than snapshot — use it
        const currentBlock = Number(await provider.getBlockNumber());
        const defaultStartBlock = Math.max(
          currentBlock - 1_000_000,
          networkConfig.GLOBAL_START_BLOCK,
        );
        indexer = await suppressSdkNoise(() =>
          createRailgunIndexer({
            network: networkConfig,
            provider,
            storage: indexerStorage,
            startBlock: defaultStartBlock,
          }),
        );
      }

      railgunLog("info", "account:create", {
        accountIndex: 0,
      });

      // Seed account storage from snapshot if local file doesn't exist
      // and the snapshot matches this wallet's fingerprint.
      const accountStoragePath = getRailgunAccountStoragePath();
      if (useSnapshot && !(await fileExists(accountStoragePath))) {
        const accountSnapshotData = await loadBundledAccountSnapshot(fingerprint);
        if (accountSnapshotData) {
          railgunLog("info", "account:loaded-from-snapshot", {});
          await accountStorage.set(accountSnapshotData);
        }
      }

      const account = await suppressSdkNoise(() =>
        createRailgunAccount({
          credential: {
            type: "mnemonic",
            mnemonic,
            accountIndex: 0,
          },
          indexer,
          storage: accountStorage,
        }),
      );

      const railgunAddress = await account.getRailgunAddress();

      railgunLog("info", "runtime:wallet-ready", {
        railgunAddress,
        fingerprint,
      });

      return {
        account,
        indexer,
        railgunAddress,
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

      return { symbol, decimals };
    },
  );
};

const resolveToken = async (token: string): Promise<RailgunToken> => {
  const networkConfig = RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID];

  if (isNativeToken(token)) {
    railgunLog("info", "token:resolved-native", { token });
    return {
      tokenAddress: getAddress(networkConfig.WETH) as `0x${string}`,
      symbol: "ETH",
      decimals: 18,
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

const RAILGUN_FEE_BASIS_POINTS = 25n;

/**
 * Compute the maximum amount that can be unshielded/transferred from a
 * given balance, accounting for the Railgun protocol fee. The SDK adds the
 * fee on top of the requested amount, so trying to spend the full UTXO
 * value causes a ZK circuit assertion failure.
 */
const maxSpendableAfterFee = (balanceRaw: bigint): bigint =>
  (balanceRaw * 10000n) / (10000n + RAILGUN_FEE_BASIS_POINTS);

/**
 * Clamp the requested amount to the fee-adjusted maximum when it equals
 * or exceeds the available balance.  Returns the (possibly reduced) raw
 * amount and the corresponding human-readable string.
 */
const clampAmountForFee = (
  requestedAmountRaw: bigint,
  spendableBalanceRaw: bigint,
  decimals: number,
): { amountRaw: bigint; amount: string } => {
  if (requestedAmountRaw >= spendableBalanceRaw) {
    const clampedRaw = maxSpendableAfterFee(spendableBalanceRaw);
    return {
      amountRaw: clampedRaw,
      amount: formatUnits(clampedRaw, decimals),
    };
  }
  return { amountRaw: requestedAmountRaw, amount: formatUnits(requestedAmountRaw, decimals) };
};

const submitTxData = async (txData: TxData) => {
  return withRailgunTiming(
    "transaction:submit",
    {
      hasData: Boolean(txData.data),
      to: txData.to,
      value: txData.value,
    },
    async () => {
      const walletClient = getWalletClient();
      const account = getSignerAccount();

      const txHash = await walletClient.sendTransaction({
        account,
        chain: arbitrum,
        to: getAddress(txData.to),
        data: txData.data as `0x${string}`,
        value: txData.value,
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
      const networkConfig = RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID];
      const spender = getAddress(networkConfig.RAILGUN_ADDRESS);
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

const getShieldedBalanceForToken = async (runtime: RailgunRuntime, token: RailgunToken) => {
  return withRailgunTiming(
    "balance:shielded",
    {
      railgunAddress: runtime.railgunAddress,
      symbol: token.symbol,
      tokenAddress: token.tokenAddress,
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

      const amount = await runtime.account.getBalance(token.tokenAddress);
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
  options: { includeOptimistic?: boolean } = {},
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

  const amount = await runtime.account.getBalance(token.tokenAddress);
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
  // Query known token balances through the account
  // The account.getBalance() method returns the balance for a specific token
  // We need to track which tokens we know about
  const knownTokenAddresses = new Set<string>();

  // Add tokens from optimistic balances
  for (const tokenAddress of optimisticShieldedBalances.keys()) {
    knownTokenAddresses.add(tokenAddress);
  }

  // Add WETH and USDC as known tokens
  const networkConfig = RAILGUN_CONFIG_BY_CHAIN_ID[ARBITRUM_CHAIN_ID];
  knownTokenAddresses.add(getAddress(networkConfig.WETH));
  if (TOKEN_ALIASES.USDC) {
    knownTokenAddresses.add(getAddress(TOKEN_ALIASES.USDC));
  }

  const rows: RailgunBalanceRow[] = [];

  for (const tokenAddress of knownTokenAddresses) {
    const optimisticBalance = optimisticShieldedBalances.get(tokenAddress);
    const rawAmount = optimisticBalance ?? await runtime.account.getBalance(tokenAddress as `0x${string}`);

    if (rawAmount <= 0n) {
      continue;
    }

    const isWrappedNative = tokenAddress === getAddress(networkConfig.WETH);
    const metadata = isWrappedNative
      ? { symbol: "ETH", decimals: 18 }
      : await getTokenMetadata(tokenAddress as `0x${string}`);

    rows.push({
      tokenAddress,
      symbol: metadata.symbol,
      amount: formatUnits(rawAmount, metadata.decimals),
      rawAmount: rawAmount.toString(),
    });
  }

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

  const internalApprovalId = crypto.randomUUID();
  const approvalId = signLocalActionId(internalApprovalId, "railgun-approval");
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

  pendingRailgunApprovals.set(internalApprovalId, {
    ...base,
    approval,
    execute,
  });
  railgunLog("info", "approval:created", {
    amount,
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
  const requestedAmountRaw = parseTokenAmount(amount, resolvedToken.decimals);
  railgunLog("info", "transfer:context-build", {
    amount,
    recipient,
    token: resolvedToken.symbol,
    tokenAddress: resolvedToken.tokenAddress,
  });

  await syncWalletState(runtime, { force: true, reason: "transfer-context" });
  const spendableBalance = await getShieldedBalanceForToken(runtime, resolvedToken);
  const spendableBalanceRaw = parseTokenAmount(spendableBalance, resolvedToken.decimals);
  if (spendableBalanceRaw < requestedAmountRaw) {
    throw new Error(
      `Insufficient shielded balance. Available: ${spendableBalance} ${resolvedToken.symbol}.`,
    );
  }

  // Clamp the amount to the fee-adjusted maximum so the SDK fee doesn't
  // push the total spend above the available UTXO value.
  const clamped = clampAmountForFee(
    requestedAmountRaw,
    spendableBalanceRaw,
    resolvedToken.decimals,
  );

  if (clamped.amountRaw !== requestedAmountRaw) {
    railgunLog("info", "transfer:amount-clamped-for-fee", {
      requestedAmount: amount,
      clampedAmount: clamped.amount,
      spendableBalance,
    });
  }

  return {
    runtime,
    token: resolvedToken,
    amount: clamped.amount,
    amountRaw: clamped.amountRaw,
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
  const requestedAmountRaw = parseTokenAmount(amount, resolvedToken.decimals);
  const recipientAddress = getAddress(recipient) as `0x${string}`;
  const signerAddress = getSignerAccount().address as `0x${string}`;
  railgunLog("info", "unshield:context-build", {
    amount,
    recipient: recipientAddress,
    signerAddress,
    token: resolvedToken.symbol,
    tokenAddress: resolvedToken.tokenAddress,
  });

  await syncWalletState(runtime, { force: true, reason: "unshield-context" });
  const spendableBalanceRaw = await getSpendableShieldedBalanceRawForToken(
    runtime,
    resolvedToken,
    { includeOptimistic: false },
  );

  if (spendableBalanceRaw < requestedAmountRaw) {
    throw new Error(
      `Insufficient shielded balance. Available: ${formatUnits(spendableBalanceRaw, resolvedToken.decimals)} ${resolvedToken.symbol}.`,
    );
  }

  // Clamp the amount to the fee-adjusted maximum so the SDK fee doesn't
  // push the total spend above the available UTXO value.
  const clamped = clampAmountForFee(
    requestedAmountRaw,
    spendableBalanceRaw,
    resolvedToken.decimals,
  );

  if (clamped.amountRaw !== requestedAmountRaw) {
    railgunLog("info", "unshield:amount-clamped-for-fee", {
      requestedAmount: amount,
      clampedAmount: clamped.amount,
      spendableBalance: formatUnits(spendableBalanceRaw, resolvedToken.decimals),
    });
  }

  return {
    runtime,
    token: resolvedToken,
    amount: clamped.amount,
    amountRaw: clamped.amountRaw,
    availablePrivateBalanceRaw: spendableBalanceRaw,
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

      await syncWalletState(prepared.runtime, { force: true, reason: "shield-preflight" });
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

      railgunLog("info", "operation:shield-prepare", {
        isNative: prepared.token.isNative,
        token: prepared.token.symbol,
      });

      const txData = prepared.token.isNative
        ? await prepared.runtime.account.shieldNative(prepared.amountRaw)
        : await prepared.runtime.account.shield(
            prepared.token.tokenAddress,
            prepared.amountRaw,
          );

      stages.push({
        label: "Shield transaction prepared",
        status: "completed",
      });

      const txHash = await submitTxData(txData);
      stages.push({
        label: "Shield transaction confirmed",
        status: "completed",
        detail: txHash,
      });

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
      const stages: RailgunOperationStage[] = [];

      await syncWalletState(prepared.runtime, { force: true, reason: "transfer-preflight" });
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

      railgunLog("info", "operation:transfer-prepare", {
        token: prepared.token.symbol,
        amount: prepared.amount,
        recipient: prepared.recipient,
      });

      const txData = await prepared.runtime.account.transfer(
        prepared.token.tokenAddress,
        prepared.amountRaw,
        prepared.recipient as RailgunAddress,
      );

      stages.push({
        label: "Zero-knowledge proof generated",
        status: "completed",
      });

      const txHash = await submitTxData(txData);
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
      const stages: RailgunOperationStage[] = [];

      await syncWalletState(prepared.runtime, { force: true, reason: "unshield-preflight" });
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

      railgunLog("info", "operation:unshield-prepare", {
        token: prepared.token.symbol,
        amount: prepared.amount,
        recipient: prepared.recipient,
        isNative: prepared.token.isNative,
      });

      const txData = prepared.token.isNative
        ? await prepared.runtime.account.unshieldNative(
            prepared.amountRaw,
            prepared.recipient,
          )
        : await prepared.runtime.account.unshield(
            prepared.token.tokenAddress,
            prepared.amountRaw,
            prepared.recipient,
          );

      stages.push({
        label: "Zero-knowledge proof generated",
        status: "completed",
      });

      const txHash = await submitTxData(txData);
      stages.push({
        label: "Unshield transaction confirmed",
        status: "completed",
        detail: txHash,
      });

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
  const recommendationText = ` ${routing.recommendation}`;

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
      await syncWalletState(runtime, { reason: "routing" });
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
      await syncWalletState(runtime, { reason: "routing" });
      const tokenSelector = resolvedToken.isNative ? "ETH" : resolvedToken.tokenAddress;
      let prepared: RailgunPreparedUnshield;
      try {
        prepared = await buildUnshieldContext(recipient, tokenSelector, amount);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!errMsg.toLowerCase().includes("balance") && !errMsg.toLowerCase().includes("utxo")) {
          return { error: `Unshield failed: ${errMsg}` };
        }
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
  const internalApprovalId = verifyLocalActionId(approvalId, "railgun-approval");
  if (!internalApprovalId) {
    throw new Error("Railgun approval request was not found or has expired.");
  }

  const pendingApproval = pendingRailgunApprovals.get(internalApprovalId);

  if (!pendingApproval) {
    throw new Error("Railgun approval request was not found or has expired.");
  }

  pendingRailgunApprovals.delete(internalApprovalId);
  railgunLog("info", "approval:approved", {
    operation: pendingApproval.operation,
    railgunAddress: pendingApproval.railgunAddress,
  });
  return withRailgunLock("approve_railgun_action", () => pendingApproval.execute());
}

export function rejectRailgunAction(approvalId: string): RailgunResult {
  cleanupPendingRailgunApprovals();
  const internalApprovalId = verifyLocalActionId(approvalId, "railgun-approval");
  if (!internalApprovalId) {
    throw new Error("Railgun approval request was not found or has expired.");
  }

  const pendingApproval = pendingRailgunApprovals.get(internalApprovalId);

  if (!pendingApproval) {
    throw new Error("Railgun approval request was not found or has expired.");
  }

  pendingRailgunApprovals.delete(internalApprovalId);
  railgunLog("info", "approval:rejected", {
    operation: pendingApproval.operation,
    railgunAddress: pendingApproval.railgunAddress,
  });
  return buildCancelledApprovalResult(pendingApproval);
}
