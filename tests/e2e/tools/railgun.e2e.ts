import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { formatEther, parseEther } from "viem"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  createE2ERuntimeConfig,
  executeTool,
  getWalletAddress,
} from "../helpers/config"
import { verificationClient } from "../helpers/verification-client"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS * 3)

const tools = createTools(ARBITRUM_CONFIG, createE2ERuntimeConfig(ARBITRUM_CONFIG))
const walletAddress = getWalletAddress()
const MAX_SHIELD_AMOUNT_RAW = parseEther("0.000001")

type RailgunBalanceResult = {
  railgun: true
  status: "success"
  operation: "balance"
  railgunAddress: string
  balances: Array<Record<string, unknown>>
}

type RailgunOperationResult = {
  railgun: true
  status: "success"
  operation: "shield" | "transfer" | "unshield"
  txHash: string
  explorerUrl: string
  shieldedBalanceAfter?: string
  publicBalanceAfter?: string
}

type RailgunErrorResult = {
  railgun: true
  status: "error"
  operation: "balance" | "shield" | "transfer" | "unshield"
  message: string
  setup?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function expectRailgunBalanceResult(
  result: unknown
): asserts result is RailgunBalanceResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "success" ||
    result.operation !== "balance" ||
    !Array.isArray(result.balances) ||
    typeof result.railgunAddress !== "string"
  ) {
    throw new Error("Expected a successful Railgun balance result.")
  }
}

function expectRailgunOperationResult(
  result: unknown,
  operation: RailgunOperationResult["operation"]
): asserts result is RailgunOperationResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "success" ||
    result.operation !== operation ||
    typeof result.txHash !== "string" ||
    typeof result.explorerUrl !== "string"
  ) {
    throw new Error(`Expected a successful Railgun ${operation} result.`)
  }
}

function expectRailgunErrorResult(
  result: unknown,
  operation: RailgunErrorResult["operation"]
): asserts result is RailgunErrorResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "error" ||
    result.operation !== operation ||
    typeof result.message !== "string"
  ) {
    throw new Error(`Expected a Railgun ${operation} error result.`)
  }
}

function getAffordableRailgunAmounts(publicBalanceRaw: bigint) {
  if (publicBalanceRaw <= 0n) {
    throw new Error("The public EOA wallet needs ETH to exercise Railgun E2E flows.")
  }

  const shieldAmountRaw =
    publicBalanceRaw / 50n > 0n
      ? publicBalanceRaw / 50n < MAX_SHIELD_AMOUNT_RAW
        ? publicBalanceRaw / 50n
        : MAX_SHIELD_AMOUNT_RAW
      : 1n
  const unshieldAmountRaw = shieldAmountRaw > 1n ? shieldAmountRaw / 2n : 1n

  return {
    shieldAmount: formatEther(shieldAmountRaw),
    unshieldAmount: formatEther(unshieldAmountRaw),
  }
}

function expectFundingConstraint(result: unknown, operation: "shield" | "unshield") {
  expectRailgunErrorResult(result, operation)
  expect(result.message.toLowerCase()).toMatch(/insufficient|fund|balance too low/)
}

describe("Railgun E2E", () => {
  let railgunConfigured = false
  let allBalances: unknown
  let ethBalance: unknown
  let shieldResult: unknown
  let transferFailure: unknown
  let unshieldResult: unknown
  let shieldAmount = "0"
  let unshieldAmount = "0"

  beforeAll(async () => {
    const publicBalanceRaw = await verificationClient.getBalance({ address: walletAddress })
    ;({ shieldAmount, unshieldAmount } = getAffordableRailgunAmounts(publicBalanceRaw))

    allBalances = await executeTool(tools.railgun_balance, {})
    if (!isRecord(allBalances) || allBalances.status !== "success") {
      ethBalance = await executeTool(tools.railgun_balance, { token: "ETH" })
      shieldResult = await executeTool(tools.railgun_shield, {
        token: "ETH",
        amount: shieldAmount,
      })
      transferFailure = await executeTool(tools.railgun_transfer, {
        recipient: "0zk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
        token: "ETH",
        amount: "999999",
      })
      unshieldResult = await executeTool(tools.railgun_unshield, {
        recipient: walletAddress,
        token: "ETH",
        amount: unshieldAmount,
      })
      return
    }

    railgunConfigured = true
    expectRailgunBalanceResult(allBalances)

    ethBalance = await executeTool(tools.railgun_balance, { token: "ETH" })
    expectRailgunBalanceResult(ethBalance)

    shieldResult = await executeTool(tools.railgun_shield, {
      token: "ETH",
      amount: shieldAmount,
    })

    transferFailure = await executeTool(tools.railgun_transfer, {
      recipient: ethBalance.railgunAddress,
      token: "ETH",
      amount: "999999",
    })

    unshieldResult =
      isRecord(shieldResult) && shieldResult.status === "success"
        ? await executeTool(tools.railgun_unshield, {
            recipient: walletAddress,
            token: "ETH",
            amount: unshieldAmount,
          })
        : {
            railgun: true,
            status: "error",
            operation: "unshield",
            message:
              isRecord(shieldResult) && typeof shieldResult.message === "string"
                ? shieldResult.message
                : "Could not fund the Railgun unshield test.",
          }
  })

  test("railgun_balance returns the ETH balance row and Railgun address", () => {
    if (!railgunConfigured) {
      expectRailgunErrorResult(ethBalance, "balance")
      expect(ethBalance.setup?.length ?? 0).toBeGreaterThan(0)
      return
    }

    expectRailgunBalanceResult(ethBalance)
    expect(ethBalance.railgunAddress.startsWith("0zk")).toBe(true)
    expect(Array.isArray(ethBalance.balances)).toBe(true)
  })

  test("railgun_balance without a token returns all balances", () => {
    if (!railgunConfigured) {
      expectRailgunErrorResult(allBalances, "balance")
      expect(allBalances.message.length).toBeGreaterThan(0)
      return
    }

    expectRailgunBalanceResult(allBalances)
    expect(allBalances.railgunAddress.startsWith("0zk")).toBe(true)
    expect(Array.isArray(allBalances.balances)).toBe(true)
  })

  test("railgun_shield deposits ETH into Railgun", () => {
    if (!railgunConfigured) {
      expectRailgunErrorResult(shieldResult, "shield")
      expect(shieldResult.setup?.length ?? 0).toBeGreaterThan(0)
      return
    }

    if (isRecord(shieldResult) && shieldResult.status === "error") {
      expectFundingConstraint(shieldResult, "shield")
      return
    }

    expectRailgunOperationResult(shieldResult, "shield")
    expect(shieldResult.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(shieldResult.explorerUrl).toContain("arbiscan.io")
    expect(shieldResult.shieldedBalanceAfter).toBeTruthy()
  })

  test("railgun_transfer fails when the shielded balance is insufficient", () => {
    if (!railgunConfigured) {
      expectRailgunErrorResult(transferFailure, "transfer")
      expect(transferFailure.setup?.length ?? 0).toBeGreaterThan(0)
      return
    }

    expectRailgunErrorResult(transferFailure, "transfer")
    expect(transferFailure.message.toLowerCase()).toContain("insufficient")
  })

  test("railgun_unshield withdraws to the public wallet address", () => {
    if (!railgunConfigured) {
      expectRailgunErrorResult(unshieldResult, "unshield")
      expect(unshieldResult.setup?.length ?? 0).toBeGreaterThan(0)
      return
    }

    if (isRecord(unshieldResult) && unshieldResult.status === "error") {
      expectFundingConstraint(unshieldResult, "unshield")
      return
    }

    expectRailgunOperationResult(unshieldResult, "unshield")
    expect(unshieldResult.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(unshieldResult.explorerUrl).toContain("arbiscan.io")
    expect(unshieldResult.publicBalanceAfter).toBeTruthy()
  })
})
