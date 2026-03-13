import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  createE2ERuntimeConfig,
  executeTool,
} from "./config"

const tools = createTools(ARBITRUM_CONFIG, createE2ERuntimeConfig(ARBITRUM_CONFIG))
const DEFAULT_TOP_UP_AMOUNT = 0.0001

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseRequiredAmount(amount: string) {
  const parsed = Number.parseFloat(amount)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid required Railgun balance amount: ${amount}`)
  }

  return parsed
}

function getEthShieldedBalance(result: unknown) {
  if (!isRecord(result) || result.status !== "success" || result.operation !== "balance") {
    const message =
      isRecord(result) && typeof result.message === "string"
        ? result.message
        : "Could not load Railgun balance."
    throw new Error(message)
  }

  const balances = Array.isArray(result.balances) ? result.balances : []
  const ethBalance = balances.find((balance) => {
    return isRecord(balance) && balance.symbol === "ETH"
  })

  if (!ethBalance || !isRecord(ethBalance)) {
    return 0
  }

  const amount = Number.parseFloat(String(ethBalance.amount ?? "0"))
  return Number.isFinite(amount) ? amount : 0
}

function getTopUpAmount(requiredAmount: number, topUpAmount?: string) {
  const requestedTopUp = topUpAmount ? Number.parseFloat(topUpAmount) : DEFAULT_TOP_UP_AMOUNT
  const normalizedTopUp =
    Number.isFinite(requestedTopUp) && requestedTopUp > 0
      ? requestedTopUp
      : DEFAULT_TOP_UP_AMOUNT

  return Math.max(requiredAmount * 2, normalizedTopUp).toString()
}

export async function ensureRailgunShieldedEthBalance(
  requiredAmount: string,
  topUpAmount?: string,
) {
  const minimumRequired = parseRequiredAmount(requiredAmount)
  const initialBalance = await executeTool(tools.railgun_balance, { token: "ETH" })

  if (getEthShieldedBalance(initialBalance) >= minimumRequired) {
    return
  }

  const shieldResult = await executeTool(tools.railgun_shield, {
    token: "ETH",
    amount: getTopUpAmount(minimumRequired, topUpAmount),
  })

  if (
    !isRecord(shieldResult) ||
    shieldResult.status !== "success" ||
    shieldResult.operation !== "shield"
  ) {
    const errorPayload: unknown = shieldResult
    const message =
      isRecord(errorPayload) && typeof errorPayload.message === "string"
        ? errorPayload.message
        : "Could not top up Railgun shielded ETH."
    throw new Error(message)
  }

  const shieldedBalanceAfter = Number.parseFloat(
    String(shieldResult.shieldedBalanceAfter ?? "0"),
  )
  if (Number.isFinite(shieldedBalanceAfter) && shieldedBalanceAfter < minimumRequired) {
    throw new Error(
      `Railgun ETH balance is still below ${requiredAmount} after shielding.`,
    )
  }
}
