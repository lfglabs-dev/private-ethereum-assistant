import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  createE2ERuntimeConfig,
  executeTool,
} from "../helpers/config"
import { ensureRailgunShieldedEthBalance } from "../helpers/railgun"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS * 6)

const tools = createTools(ARBITRUM_CONFIG, createE2ERuntimeConfig(ARBITRUM_CONFIG, "railgun"))
const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const PUBLIC_SEND_AMOUNT = "0.000001"

type ResolveEnsResult = {
  address: string | null
  error: string | null
  errorCode: string | null
}

type RailgunSuccessResult = {
  railgun: true
  status: "success"
  operation: "shield" | "transfer" | "unshield"
  recipient?: string
  txHash: string
  privacyNote: string
}

type RailgunErrorResult = {
  railgun: true
  status: "error"
  operation: "shield" | "transfer" | "unshield"
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function expectResolveEnsResult(result: unknown): asserts result is ResolveEnsResult {
  if (!isRecord(result) || Array.isArray(result.results)) {
    throw new Error("Expected a single ENS resolution result.")
  }
}

function expectRailgunErrorResult(result: unknown): asserts result is RailgunErrorResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "error" ||
    typeof result.message !== "string"
  ) {
    throw new Error("Expected a Railgun error result.")
  }
}

function expectRailgunSuccessResult(result: unknown): asserts result is RailgunSuccessResult {
  if (
    !isRecord(result) ||
    result.railgun !== true ||
    result.status !== "success" ||
    typeof result.txHash !== "string" ||
    typeof result.privacyNote !== "string"
  ) {
    throw new Error("Expected a successful Railgun result.")
  }
}

describe("Railgun public-recipient send E2E", () => {
  let resolvedRecipient: string
  let privateTransferFailure: unknown
  let publicSendResult: unknown
  let publicSendSetupError: string | null = null

  beforeAll(async () => {
    const ensResult = await executeTool(tools.resolve_ens, {
      name: "vitalik.eth",
    })
    expectResolveEnsResult(ensResult)
    expect(ensResult.error).toBeNull()
    expect(ensResult.errorCode).toBeNull()
    expect(ensResult.address).toBe(VITALIK_ADDRESS)
    resolvedRecipient = ensResult.address as string

    try {
      await ensureRailgunShieldedEthBalance(PUBLIC_SEND_AMOUNT)
    } catch (error) {
      publicSendSetupError =
        error instanceof Error ? error.message : "Could not fund the Railgun public send test."
    }

    privateTransferFailure = await executeTool(tools.railgun_transfer, {
      recipient: resolvedRecipient,
      token: "ETH",
      amount: PUBLIC_SEND_AMOUNT,
    })

    publicSendResult =
      publicSendSetupError != null
        ? {
            railgun: true,
            status: "error",
            operation: "unshield",
            message: publicSendSetupError,
          }
        : await executeTool(tools.railgun_unshield, {
            recipient: resolvedRecipient,
            token: "ETH",
            amount: PUBLIC_SEND_AMOUNT,
          })
  })

  test("resolve_ens resolves the public recipient before execution", () => {
    expect(resolvedRecipient).toBe(VITALIK_ADDRESS)
  })

  test("railgun_transfer rejects public recipients and points callers to unshield", () => {
    expectRailgunErrorResult(privateTransferFailure)
    expect(privateTransferFailure.operation).toBe("transfer")
    expect(privateTransferFailure.message).toContain("0zk recipient")
    expect(privateTransferFailure.message).toContain("railgun_unshield")
  })

  test("railgun_unshield sends to the resolved public recipient", () => {
    if (isRecord(publicSendResult) && publicSendResult.status === "error") {
      expect(publicSendResult.operation).toBe("unshield")
      expect(String(publicSendResult.message).toLowerCase()).toMatch(/insufficient|fund/)
      return
    }

    expectRailgunSuccessResult(publicSendResult)
    expect(publicSendResult.operation).toBe("unshield")
    expect(publicSendResult.recipient).toBe(VITALIK_ADDRESS)
    expect(publicSendResult.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(publicSendResult.privacyNote.toLowerCase()).toContain("privacy")
  })
})
