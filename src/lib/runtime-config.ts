import { isAddress } from "viem";
import { z } from "zod";
import { config } from "./config";
import { DEFAULT_NETWORK_CONFIG, NETWORK_PRESETS, type NetworkConfig } from "./ethereum";

export const RUNTIME_CONFIG_STORAGE_KEY =
  "private-ethereum-assistant.runtime-config.v1";
export const RUNTIME_CONFIG_STORAGE_EVENT =
  "private-ethereum-assistant.runtime-config.changed";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_MODEL = "qwen/qwen3.5-27b";
export const LOCAL_DEFAULT_MODEL = config.llm.model;
export const DEVELOPER_MODE_PLACEHOLDER_PRIVATE_KEY =
  `0x${"0".repeat(64)}` as const;

let cachedRuntimeConfigRaw: string | null = null;
let cachedRuntimeConfigValue: RuntimeConfig | null = null;

export const llmProviderSchema = z.enum(["openrouter", "local"]);
export const appModeSchema = z.enum(["standard", "developer"]);
export const activeActorSchema = z.enum(["eoa", "safe", "railgun"]);

const positiveIntegerSchema = z.coerce.number().int().positive();
const nonNegativeIntegerSchema = z.coerce.number().int().nonnegative();
const tokenAmountSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a non-negative token amount.");

const addressSchema = z
  .string()
  .trim()
  .refine((value) => isAddress(value), "Enter a valid 0x address.");

const privateKeySchema = z
  .string()
  .trim()
  .transform((value) => (value.startsWith("0x") ? value : `0x${value}`))
  .refine(
    (value) => /^0x[0-9a-fA-F]{64}$/.test(value),
    "Enter a valid 32-byte private key.",
  );

const optionalPrivateKeySchema = z
  .string()
  .trim()
  .transform((value) => {
    if (!value) {
      return "";
    }

    return value.startsWith("0x") ? value : `0x${value}`;
  })
  .refine(
    (value) => value === "" || /^0x[0-9a-fA-F]{64}$/.test(value),
    "Enter a valid 32-byte private key or leave it blank.",
  );

export const runtimeConfigSchema = z.object({
  version: z.literal(1),
  llm: z.object({
    provider: llmProviderSchema,
    localBaseUrl: z.string().trim().url(),
    localModel: z.string().trim().min(1, "Enter a local model name."),
    openRouterModel: z
      .string()
      .trim()
      .min(1, "Enter an OpenRouter model name."),
    timeoutMs: positiveIntegerSchema,
  }),
  network: z.object({
    chainId: positiveIntegerSchema,
    rpcUrl: z.string().trim().url(),
  }),
  safe: z.object({
    address: addressSchema,
    chainId: positiveIntegerSchema,
    rpcUrl: z.string().trim().url(),
    signerPrivateKey: optionalPrivateKeySchema,
  }),
  wallet: z.object({
    eoaPrivateKey: privateKeySchema,
    approvalPolicy: z.object({
      enabled: z.boolean(),
      nativeThreshold: tokenAmountSchema,
      erc20Threshold: tokenAmountSchema,
    }),
  }),
  actor: z.object({
    type: activeActorSchema,
  }),
  railgun: z.object({
    networkLabel: z.string().trim().min(1, "Enter a Railgun network label."),
    chainId: positiveIntegerSchema,
    rpcUrl: z.string().trim().url(),
    explorerTxBaseUrl: z.string().trim().url(),
    privacyGuidanceText: z
      .string()
      .trim()
      .min(1, "Enter the Railgun privacy guidance text."),
    poiNodeUrls: z
      .array(z.string().trim().url())
      .min(1, "Enter at least one Railgun POI node URL."),
    mnemonic: z.string().trim(),
    walletCreationBlock: nonNegativeIntegerSchema,
    scanTimeoutMs: positiveIntegerSchema,
    pollingIntervalMs: positiveIntegerSchema,
    shieldApprovalThreshold: tokenAmountSchema,
    transferApprovalThreshold: tokenAmountSchema,
    unshieldApprovalThreshold: tokenAmountSchema,
  }),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type AppMode = z.infer<typeof appModeSchema>;
export type ActiveActor = z.infer<typeof activeActorSchema>;

export type RuntimeConfigDraft = {
  llm: {
    provider: LlmProvider;
    localBaseUrl: string;
    localModel: string;
    openRouterModel: string;
    timeoutMs: string;
  };
  network: {
    chainId: string;
    rpcUrl: string;
  };
  safe: {
    address: string;
    chainId: string;
    rpcUrl: string;
    signerPrivateKey: string;
  };
  wallet: {
    eoaPrivateKey: string;
    approvalPolicy: {
      enabled: boolean;
      nativeThreshold: string;
      erc20Threshold: string;
    };
  };
  actor: {
    type: ActiveActor;
  };
  railgun: {
    networkLabel: string;
    chainId: string;
    rpcUrl: string;
    explorerTxBaseUrl: string;
    privacyGuidanceText: string;
    poiNodeUrls: string;
    mnemonic: string;
    walletCreationBlock: string;
    scanTimeoutMs: string;
    pollingIntervalMs: string;
    shieldApprovalThreshold: string;
    transferApprovalThreshold: string;
    unshieldApprovalThreshold: string;
  };
};

function getArbitrumNetworkConfig(): NetworkConfig {
  const arbitrumPreset = NETWORK_PRESETS.find((preset) => preset.id === "arbitrum");
  if (!arbitrumPreset) {
    return DEFAULT_NETWORK_CONFIG;
  }

  return {
    chainId: arbitrumPreset.chainId,
    rpcUrl: arbitrumPreset.rpcUrl,
  };
}

function getDeveloperWalletPrivateKey() {
  const value = process.env.EOA_PRIVATE_KEY ?? process.env.WALLET_PRIVATE_KEY;
  if (!value) {
    throw new Error(
      "Developer mode requires EOA_PRIVATE_KEY or WALLET_PRIVATE_KEY in the environment.",
    );
  }

  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Developer mode wallet private key is not a valid 32-byte hex value.");
  }

  return normalized;
}

export function getAppMode(): AppMode {
  return process.env.APP_MODE === "developer" ||
    process.env.NEXT_PUBLIC_APP_MODE === "developer"
    ? "developer"
    : "standard";
}

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    version: 1,
    llm: {
      provider: "openrouter",
      localBaseUrl: config.llm.baseURL,
      localModel: LOCAL_DEFAULT_MODEL,
      openRouterModel: OPENROUTER_DEFAULT_MODEL,
      timeoutMs: config.llm.timeoutMs,
    },
    network: {
      chainId: DEFAULT_NETWORK_CONFIG.chainId,
      rpcUrl: DEFAULT_NETWORK_CONFIG.rpcUrl,
    },
    safe: {
      address: config.ethereum.safeAddress,
      chainId: 8453,
      rpcUrl: "https://mainnet.base.org",
      signerPrivateKey: "",
    },
    wallet: {
      eoaPrivateKey: "",
      approvalPolicy: {
        enabled: true,
        nativeThreshold: config.ethereum.localApprovalNativeThreshold,
        erc20Threshold: config.ethereum.localApprovalErc20Threshold,
      },
    },
    actor: {
      type: "eoa",
    },
    railgun: {
      networkLabel: config.railgun.networkLabel,
      chainId: config.railgun.chainId,
      rpcUrl: config.railgun.rpcUrl,
      explorerTxBaseUrl: config.railgun.explorerTxBaseUrl,
      privacyGuidanceText: config.railgun.privacyGuidanceText,
      poiNodeUrls: config.railgun.poiNodeUrls,
      mnemonic: config.railgun.mnemonic || "",
      walletCreationBlock: config.railgun.walletCreationBlock,
      scanTimeoutMs: config.railgun.scanTimeoutMs,
      pollingIntervalMs: config.railgun.pollingIntervalMs,
      shieldApprovalThreshold: config.railgun.shieldApprovalThreshold,
      transferApprovalThreshold: config.railgun.transferApprovalThreshold,
      unshieldApprovalThreshold: config.railgun.unshieldApprovalThreshold,
    },
  } as RuntimeConfig;
}

export function createDeveloperDisplayRuntimeConfig(): RuntimeConfig {
  const runtimeConfig = createDefaultRuntimeConfig();

  return {
    ...runtimeConfig,
    llm: {
      ...runtimeConfig.llm,
      provider: "openrouter",
      openRouterModel: OPENROUTER_DEFAULT_MODEL,
    },
    network: getArbitrumNetworkConfig(),
    wallet: {
      ...runtimeConfig.wallet,
      eoaPrivateKey: DEVELOPER_MODE_PLACEHOLDER_PRIVATE_KEY,
    },
  };
}

export function createDeveloperRuntimeConfig(): RuntimeConfig {
  const displayRuntimeConfig = createDeveloperDisplayRuntimeConfig();
  const developerWalletPrivateKey = getDeveloperWalletPrivateKey();

  return {
    ...displayRuntimeConfig,
    safe: {
      ...displayRuntimeConfig.safe,
      signerPrivateKey: developerWalletPrivateKey,
    },
    wallet: {
      ...displayRuntimeConfig.wallet,
      eoaPrivateKey: developerWalletPrivateKey,
    },
  };
}

function mergeRuntimeConfigOverrides(
  baseConfig: RuntimeConfig,
  overrides?: RuntimeConfig | null,
  networkConfig?: NetworkConfig,
): RuntimeConfig {
  if (!overrides) {
    return networkConfig
      ? {
          ...baseConfig,
          network: networkConfig,
        }
      : baseConfig;
  }

  return {
    ...baseConfig,
    llm: overrides.llm,
    network: networkConfig ?? overrides.network,
    safe: {
      ...baseConfig.safe,
      address: overrides.safe.address,
      chainId: overrides.safe.chainId,
      rpcUrl: overrides.safe.rpcUrl,
    },
    wallet: {
      ...baseConfig.wallet,
      approvalPolicy: overrides.wallet.approvalPolicy,
    },
    actor: overrides.actor,
    railgun: {
      ...baseConfig.railgun,
      networkLabel: overrides.railgun.networkLabel,
      chainId: overrides.railgun.chainId,
      rpcUrl: overrides.railgun.rpcUrl,
      explorerTxBaseUrl: overrides.railgun.explorerTxBaseUrl,
      privacyGuidanceText: overrides.railgun.privacyGuidanceText,
      poiNodeUrls: overrides.railgun.poiNodeUrls,
      mnemonic: overrides.railgun.mnemonic,
      walletCreationBlock: overrides.railgun.walletCreationBlock,
      scanTimeoutMs: overrides.railgun.scanTimeoutMs,
      pollingIntervalMs: overrides.railgun.pollingIntervalMs,
      shieldApprovalThreshold: overrides.railgun.shieldApprovalThreshold,
      transferApprovalThreshold: overrides.railgun.transferApprovalThreshold,
      unshieldApprovalThreshold: overrides.railgun.unshieldApprovalThreshold,
    },
  };
}

export function mergeDeveloperDisplayRuntimeConfig(
  overrides?: RuntimeConfig | null,
  networkConfig?: NetworkConfig,
) {
  return mergeRuntimeConfigOverrides(
    createDeveloperDisplayRuntimeConfig(),
    overrides,
    networkConfig,
  );
}

export function mergeDeveloperRuntimeConfig(
  overrides?: RuntimeConfig | null,
  networkConfig?: NetworkConfig,
) {
  return mergeRuntimeConfigOverrides(createDeveloperRuntimeConfig(), overrides, networkConfig);
}

export function getRuntimeConfigForNetwork(
  networkConfig: NetworkConfig = DEFAULT_NETWORK_CONFIG,
): RuntimeConfig {
  return {
    ...createDefaultRuntimeConfig(),
    network: {
      chainId: networkConfig.chainId,
      rpcUrl: networkConfig.rpcUrl,
    },
  };
}

export function createRuntimeConfigDraft(
  runtimeConfig: RuntimeConfig = createDefaultRuntimeConfig(),
): RuntimeConfigDraft {
  return {
    llm: {
      provider: runtimeConfig.llm.provider,
      localBaseUrl: runtimeConfig.llm.localBaseUrl,
      localModel: runtimeConfig.llm.localModel,
      openRouterModel: runtimeConfig.llm.openRouterModel,
      timeoutMs: String(runtimeConfig.llm.timeoutMs),
    },
    network: {
      chainId: String(runtimeConfig.network.chainId),
      rpcUrl: runtimeConfig.network.rpcUrl,
    },
    safe: {
      address: runtimeConfig.safe.address,
      chainId: String(runtimeConfig.safe.chainId),
      rpcUrl: runtimeConfig.safe.rpcUrl,
      signerPrivateKey: runtimeConfig.safe.signerPrivateKey,
    },
    wallet: {
      eoaPrivateKey: runtimeConfig.wallet.eoaPrivateKey,
      approvalPolicy: {
        enabled: runtimeConfig.wallet.approvalPolicy.enabled,
        nativeThreshold: runtimeConfig.wallet.approvalPolicy.nativeThreshold,
        erc20Threshold: runtimeConfig.wallet.approvalPolicy.erc20Threshold,
      },
    },
    actor: {
      type: runtimeConfig.actor.type,
    },
    railgun: {
      networkLabel: runtimeConfig.railgun.networkLabel,
      chainId: String(runtimeConfig.railgun.chainId),
      rpcUrl: runtimeConfig.railgun.rpcUrl,
      explorerTxBaseUrl: runtimeConfig.railgun.explorerTxBaseUrl,
      privacyGuidanceText: runtimeConfig.railgun.privacyGuidanceText,
      poiNodeUrls: runtimeConfig.railgun.poiNodeUrls.join("\n"),
      mnemonic: runtimeConfig.railgun.mnemonic,
      walletCreationBlock: String(runtimeConfig.railgun.walletCreationBlock),
      scanTimeoutMs: String(runtimeConfig.railgun.scanTimeoutMs),
      pollingIntervalMs: String(runtimeConfig.railgun.pollingIntervalMs),
      shieldApprovalThreshold: runtimeConfig.railgun.shieldApprovalThreshold,
      transferApprovalThreshold: runtimeConfig.railgun.transferApprovalThreshold,
      unshieldApprovalThreshold: runtimeConfig.railgun.unshieldApprovalThreshold,
    },
  };
}

export function parseRuntimeConfigDraft(draft: RuntimeConfigDraft): RuntimeConfig {
  return runtimeConfigSchema.parse({
    version: 1,
    llm: {
      provider: draft.llm.provider,
      localBaseUrl: draft.llm.localBaseUrl,
      localModel: draft.llm.localModel,
      openRouterModel: draft.llm.openRouterModel,
      timeoutMs: draft.llm.timeoutMs,
    },
    network: {
      chainId: draft.network.chainId,
      rpcUrl: draft.network.rpcUrl,
    },
    safe: {
      address: draft.safe.address,
      chainId: draft.safe.chainId,
      rpcUrl: draft.safe.rpcUrl,
      signerPrivateKey: draft.safe.signerPrivateKey,
    },
    wallet: {
      eoaPrivateKey: draft.wallet.eoaPrivateKey,
      approvalPolicy: {
        enabled: draft.wallet.approvalPolicy.enabled,
        nativeThreshold: draft.wallet.approvalPolicy.nativeThreshold,
        erc20Threshold: draft.wallet.approvalPolicy.erc20Threshold,
      },
    },
    actor: {
      type: draft.actor.type,
    },
    railgun: {
      networkLabel: draft.railgun.networkLabel,
      chainId: draft.railgun.chainId,
      rpcUrl: draft.railgun.rpcUrl,
      explorerTxBaseUrl: draft.railgun.explorerTxBaseUrl,
      privacyGuidanceText: draft.railgun.privacyGuidanceText,
      poiNodeUrls: draft.railgun.poiNodeUrls
        .split(/\n|,/)
        .map((value) => value.trim())
        .filter(Boolean),
      mnemonic: draft.railgun.mnemonic,
      walletCreationBlock: draft.railgun.walletCreationBlock,
      scanTimeoutMs: draft.railgun.scanTimeoutMs,
      pollingIntervalMs: draft.railgun.pollingIntervalMs,
      shieldApprovalThreshold: draft.railgun.shieldApprovalThreshold,
      transferApprovalThreshold: draft.railgun.transferApprovalThreshold,
      unshieldApprovalThreshold: draft.railgun.unshieldApprovalThreshold,
    },
  });
}

export function getActiveModel(runtimeConfig: RuntimeConfig) {
  return runtimeConfig.llm.provider === "local"
    ? runtimeConfig.llm.localModel
    : runtimeConfig.llm.openRouterModel;
}

export function getProviderLabel(provider: LlmProvider) {
  return provider === "local" ? "Local" : "OpenRouter";
}

export function getActiveModelDraftValue(draft: RuntimeConfigDraft) {
  return draft.llm.provider === "local"
    ? draft.llm.localModel
    : draft.llm.openRouterModel;
}

export function setActiveModelDraftValue(
  draft: RuntimeConfigDraft,
  value: string,
): RuntimeConfigDraft {
  return draft.llm.provider === "local"
    ? {
        ...draft,
        llm: {
          ...draft.llm,
          localModel: value,
        },
      }
    : {
        ...draft,
        llm: {
          ...draft.llm,
          openRouterModel: value,
        },
      };
}

export function getSuggestedModels(provider: LlmProvider) {
  return provider === "local"
    ? ["qwen3:8b", "qwen2.5:14b-instruct", "llama3.1:latest"]
    : [
        "qwen/qwen3.5-27b",
        "openai/gpt-4o-mini",
        "anthropic/claude-3.7-sonnet",
      ];
}

export function getNetworkPresetId(networkConfig: NetworkConfig) {
  return (
    NETWORK_PRESETS.find(
      (preset) =>
        preset.chainId === networkConfig.chainId &&
        preset.rpcUrl === networkConfig.rpcUrl,
    )?.id || "custom"
  );
}

export function applyNetworkPreset(
  draft: RuntimeConfigDraft,
  presetId: string,
): RuntimeConfigDraft {
  const preset = NETWORK_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    return draft;
  }

  return {
    ...draft,
    network: {
      chainId: String(preset.chainId),
      rpcUrl: preset.rpcUrl,
    },
  };
}

export function applyLegacyRuntimeConfigDefaults(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const actor =
    typeof record.actor === "object" && record.actor !== null
      ? (record.actor as Record<string, unknown>)
      : null;
  const railgun =
    typeof record.railgun === "object" && record.railgun !== null
      ? (record.railgun as Record<string, unknown>)
      : null;

  const hasRailgunDefaults = !railgun || typeof railgun.privacyGuidanceText === "string";
  const hasActorDefaults = actor && typeof actor.type === "string";

  if (hasRailgunDefaults && hasActorDefaults) {
    return value;
  }

  return {
    ...record,
    actor:
      actor && typeof actor.type === "string"
        ? actor
        : {
            type: "eoa",
          },
    railgun: {
      ...railgun,
      privacyGuidanceText: config.railgun.privacyGuidanceText,
    },
  };
}

export function loadStoredRuntimeConfig() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY);
  if (!rawValue) {
    cachedRuntimeConfigRaw = null;
    cachedRuntimeConfigValue = null;
    return null;
  }

  if (rawValue === cachedRuntimeConfigRaw) {
    return cachedRuntimeConfigValue;
  }

  try {
    const parsed = runtimeConfigSchema.parse(
      applyLegacyRuntimeConfigDefaults(JSON.parse(rawValue)),
    );
    if (getAppMode() !== "developer" && parsed.llm.provider === "openrouter") {
      window.localStorage.removeItem(RUNTIME_CONFIG_STORAGE_KEY);
      cachedRuntimeConfigRaw = null;
      cachedRuntimeConfigValue = null;
      return null;
    }
    cachedRuntimeConfigRaw = rawValue;
    cachedRuntimeConfigValue = parsed;
    return parsed;
  } catch {
    window.localStorage.removeItem(RUNTIME_CONFIG_STORAGE_KEY);
    cachedRuntimeConfigRaw = null;
    cachedRuntimeConfigValue = null;
    return null;
  }
}

export function subscribeToStoredRuntimeConfig(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RUNTIME_CONFIG_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(RUNTIME_CONFIG_STORAGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(RUNTIME_CONFIG_STORAGE_EVENT, onStoreChange);
  };
}

export function saveStoredRuntimeConfig(runtimeConfig: RuntimeConfig) {
  if (typeof window === "undefined") {
    return;
  }

  const serialized = JSON.stringify(runtimeConfig);
  cachedRuntimeConfigRaw = serialized;
  cachedRuntimeConfigValue = runtimeConfig;
  window.localStorage.setItem(RUNTIME_CONFIG_STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(RUNTIME_CONFIG_STORAGE_EVENT));
}

export function clearStoredRuntimeConfig() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(RUNTIME_CONFIG_STORAGE_KEY);
  cachedRuntimeConfigRaw = null;
  cachedRuntimeConfigValue = null;
  window.dispatchEvent(new Event(RUNTIME_CONFIG_STORAGE_EVENT));
}
