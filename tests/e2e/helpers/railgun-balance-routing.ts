import type { NetworkConfig } from "@/lib/ethereum"
import { ARBITRUM_CONFIG, createE2ERuntimeConfig } from "./config"

export const BALANCE_ROUTING_PRIVACY_GUIDANCE =
  "Shielding is public on Arbitrum, but once confirmed the refreshed private balance can fund the retried Railgun action."

export const BALANCE_ROUTING_ETH_AMOUNT = "0.0003"

export function createBalanceRoutingRuntimeConfig(
  networkConfig: NetworkConfig = ARBITRUM_CONFIG,
) {
  const runtimeConfig = createE2ERuntimeConfig(networkConfig)

  return {
    ...runtimeConfig,
    railgun: {
      ...runtimeConfig.railgun,
      privacyGuidanceText: BALANCE_ROUTING_PRIVACY_GUIDANCE,
    },
  }
}
