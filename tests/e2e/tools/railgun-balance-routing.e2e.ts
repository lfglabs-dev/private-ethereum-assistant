import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  executeTool,
} from "../helpers/config"
import {
  BALANCE_ROUTING_ETH_AMOUNT,
  BALANCE_ROUTING_PRIVACY_GUIDANCE,
  createBalanceRoutingRuntimeConfig,
} from "../helpers/railgun-balance-routing"

const tools = createTools(
  ARBITRUM_CONFIG,
  createBalanceRoutingRuntimeConfig(ARBITRUM_CONFIG),
)

setDefaultTimeout(E2E_TEST_TIMEOUT_MS * 2)

type RailgunBalanceRouteInput = {
  action: "transfer" | "unshield"
  token: string
  amount: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function expectBalanceRoutingResult(result: unknown) {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "success" ||
    result.operation !== "route" ||
    !isRecord(result.balanceRouting)
  ) {
    throw new Error("Expected a successful Railgun balance routing result.")
  }

  return result.balanceRouting
}

describe("Railgun balance routing E2E", () => {
  test("recommends shielding when the public ETH balance can cover the private shortfall", async () => {
    const result = await executeTool(tools.railgun_balance_route, {
      action: "unshield",
      token: "ETH",
      amount: BALANCE_ROUTING_ETH_AMOUNT,
    } satisfies RailgunBalanceRouteInput)

    const balanceRouting = expectBalanceRoutingResult(result)
    expect(balanceRouting.requestedOperation).toBe("unshield")
    expect(balanceRouting.token).toBe("ETH")
    expect(balanceRouting.route).toBe("shield_then_retry")
    expect(String(balanceRouting.recommendation)).toContain("Shield at least")
    expect(balanceRouting.privacyGuidance).toBe(BALANCE_ROUTING_PRIVACY_GUIDANCE)
  })

  test("returns asset-aware routing details for supported token shortcuts", async () => {
    const result = await executeTool(tools.railgun_balance_route, {
      action: "transfer",
      token: "USDC",
      amount: "1",
    } satisfies RailgunBalanceRouteInput)

    const balanceRouting = expectBalanceRoutingResult(result)
    expect(balanceRouting.requestedOperation).toBe("transfer")
    expect(balanceRouting.token).toBe("USDC")
    expect(["proceed", "shield_then_retry", "fund_public_wallet"]).toContain(
      String(balanceRouting.route),
    )
    expect(String(balanceRouting.recommendation)).toContain("USDC")
    expect(balanceRouting.privacyGuidance).toBe(BALANCE_ROUTING_PRIVACY_GUIDANCE)
  })
})
