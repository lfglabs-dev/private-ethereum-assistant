import { z } from "zod";
import { mergeRuntimeConfigWithEnvSecrets } from "./env-secrets";
import {
  activeActorSchema,
  createDefaultRuntimeConfig,
  type RuntimeConfig,
} from "./runtime-config";
import {
  DEFAULT_NETWORK_CONFIG,
  NETWORK_PRESETS,
  networkConfigSchema,
  type NetworkConfig,
} from "./ethereum";

const standardModeActorSchema = z.object({
  actor: z.object({
    type: activeActorSchema,
  }),
});

const STANDARD_NETWORK_FINGERPRINTS = new Set(
  [
    ...NETWORK_PRESETS.map((preset) => `${preset.chainId}:${preset.rpcUrl}`),
    `${DEFAULT_NETWORK_CONFIG.chainId}:${DEFAULT_NETWORK_CONFIG.rpcUrl}`,
  ],
);

function resolveStandardNetworkConfig(requestedNetworkConfig: unknown): NetworkConfig {
  if (requestedNetworkConfig == null) {
    return DEFAULT_NETWORK_CONFIG;
  }

  const parsedNetworkConfig = networkConfigSchema.safeParse(requestedNetworkConfig);
  if (!parsedNetworkConfig.success) {
    throw new Error("Invalid network config. Choose one of the built-in network presets.");
  }

  const fingerprint =
    `${parsedNetworkConfig.data.chainId}:${parsedNetworkConfig.data.rpcUrl}`;

  if (!STANDARD_NETWORK_FINGERPRINTS.has(fingerprint)) {
    throw new Error("Custom RPC URLs are disabled in standard mode.");
  }

  return parsedNetworkConfig.data;
}

function resolveStandardActorType(requestedRuntimeConfig: unknown): RuntimeConfig["actor"]["type"] {
  const parsedRuntimeConfig = standardModeActorSchema.safeParse(requestedRuntimeConfig);
  return parsedRuntimeConfig.success
    ? parsedRuntimeConfig.data.actor.type
    : createDefaultRuntimeConfig().actor.type;
}

export async function createStandardRuntimeConfig(options: {
  requestedNetworkConfig?: unknown;
  requestedRuntimeConfig?: unknown;
}) {
  const selectedNetworkConfig = resolveStandardNetworkConfig(options.requestedNetworkConfig);
  const baseRuntimeConfig = createDefaultRuntimeConfig();

  const selectedRuntimeConfig = await mergeRuntimeConfigWithEnvSecrets({
    ...baseRuntimeConfig,
    network: selectedNetworkConfig,
    actor: {
      type: resolveStandardActorType(options.requestedRuntimeConfig),
    },
  });

  return {
    selectedNetworkConfig,
    selectedRuntimeConfig,
  };
}
