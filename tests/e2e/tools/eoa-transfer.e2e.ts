import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  ARBITRUM_USDC_ADDRESS,
  E2E_TEST_TIMEOUT_MS,
  collectAsyncIterable,
  createE2ERuntimeConfig,
  executeTool,
  executeToolStream,
  getWalletAddress,
} from "../helpers/config"
import { verificationClient } from "../helpers/verification-client"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS)

const tools = createTools(ARBITRUM_CONFIG, await createE2ERuntimeConfig(ARBITRUM_CONFIG))
const walletAddress = await getWalletAddress()
const TEST_AMOUNT = "0.000001"

async function prepareSendToken(input: {
  to: string
  amount: string
  token?: string
  gasLimit?: string
}): Promise<unknown> {
  return executeTool(tools.send_token, input)
}

async function collectSendEoaTransferUpdates(
  confirmationId: string
): Promise<unknown[]> {
  return collectAsyncIterable(
    executeToolStream(tools.send_eoa_transfer, {
      confirmationId,
    })
  )
}

type TransactionPreviewResult = {
  kind: "transaction_preview"
  confirmationId?: string
  status: "awaiting_confirmation"
  asset?: { type?: string; symbol?: string }
  amount?: string
  sender?: string
  recipient?: string
  resolvedEnsName?: string
  chain: { id: number }
  gasEstimate?: {
    gasLimit?: string
    maxFeePerGasGwei?: string
    gasCostNative?: string
  }
}

type TransactionErrorResult = {
  kind: "transaction_error"
  error: string
  message?: string
}

type TransactionProgressUpdate = {
  kind: "transaction_progress"
  status: string
  txHash?: `0x${string}`
  receipt?: {
    status?: string
    blockNumber?: number
  }
  explorerUrl?: string
}

type ConfirmedTransactionProgressUpdate = TransactionProgressUpdate & {
  status: "confirmed"
  txHash: `0x${string}`
  receipt: {
    status?: string
    blockNumber: number
  }
  explorerUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function expectTransactionPreview(
  result: unknown
): asserts result is TransactionPreviewResult {
  if (!isRecord(result) || result.kind !== "transaction_preview" || !isRecord(result.chain)) {
    throw new Error("Expected a transaction preview result.")
  }
}

function expectTransactionError(
  result: unknown
): asserts result is TransactionErrorResult {
  if (
    !isRecord(result) ||
    result.kind !== "transaction_error" ||
    typeof result.error !== "string"
  ) {
    throw new Error("Expected a transaction error result.")
  }
}

function expectTransactionProgress(
  result: unknown
): asserts result is TransactionProgressUpdate {
  if (!isRecord(result) || result.kind !== "transaction_progress") {
    throw new Error("Expected a transaction progress update.")
  }
}

function expectConfirmedTransactionProgress(
  result: unknown
): asserts result is ConfirmedTransactionProgressUpdate {
  if (
    !isRecord(result) ||
    result.kind !== "transaction_progress" ||
    result.status !== "confirmed" ||
    typeof result.txHash !== "string" ||
    typeof result.explorerUrl !== "string" ||
    !isRecord(result.receipt) ||
    typeof result.receipt.blockNumber !== "number"
  ) {
    throw new Error("Expected a confirmed transaction progress update.")
  }
}

function getTransactionStatuses(results: unknown[]) {
  return results.map((result) => {
    expectTransactionProgress(result)
    return result.status
  })
}

describe("EOA transfer E2E", () => {
  let preview: unknown = null
  let updates: unknown[] = []
  let balanceBefore = BigInt(0)
  let balanceAfter = BigInt(0)

  beforeAll(async () => {
    preview = await prepareSendToken({
      to: walletAddress,
      amount: TEST_AMOUNT,
    })

    expectTransactionPreview(preview)
    if (!preview.confirmationId) {
      throw new Error("send_token did not return a confirmationId.")
    }

    balanceBefore = await verificationClient.getBalance({ address: walletAddress })
    updates = await collectSendEoaTransferUpdates(preview.confirmationId)
    balanceAfter = await verificationClient.getBalance({ address: walletAddress })
  })

  test("send_token builds an ETH transfer preview to self", () => {
    expectTransactionPreview(preview)
    expect(preview.kind).toBe("transaction_preview")
    expect(preview.status).toBe("awaiting_confirmation")
    expect(preview.confirmationId?.length).toBeGreaterThan(0)
    expect(preview.asset?.type).toBe("ETH")
    expect(preview.amount).toBe(TEST_AMOUNT)
    expect(preview.sender).toBe(walletAddress)
    expect(preview.recipient).toBe(walletAddress)
    expect(preview.chain.id).toBe(42161)
    expect(Number(preview.gasEstimate?.gasLimit ?? "0")).toBeGreaterThan(0)
    expect(Number(preview.gasEstimate?.maxFeePerGasGwei ?? "0")).toBeGreaterThan(0)
    expect(Number(preview.gasEstimate?.gasCostNative ?? "0")).toBeGreaterThan(0)
  })

  test("send_token and send_eoa_transfer complete a self-transfer on Arbitrum", async () => {
    const finalUpdate = updates.at(-1)
    expectConfirmedTransactionProgress(finalUpdate)

    expect(finalUpdate.status).toBe("confirmed")
    expect(finalUpdate.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(finalUpdate.receipt?.status).toBe("success")
    expect(finalUpdate.receipt?.blockNumber).toBeGreaterThan(0)
    expect(finalUpdate.explorerUrl).toContain("arbiscan.io")
    if (!finalUpdate.txHash) {
      throw new Error("Expected the confirmed update to include a txHash.")
    }

    const receipt = await verificationClient.getTransactionReceipt({
      hash: finalUpdate.txHash,
    })
    expect(receipt.status).toBe("success")
    expect(balanceBefore - balanceAfter).toBe(
      receipt.gasUsed * receipt.effectiveGasPrice
    )
  })

  test("send_eoa_transfer yields the full transaction lifecycle", () => {
    expect(getTransactionStatuses(updates)).toEqual([
      "estimating_gas",
      "building",
      "signing",
      "broadcasting",
      "waiting_for_confirmation",
      "confirmed",
    ])
  })

  test("send_token resolves ENS recipients", async () => {
    const result = await prepareSendToken({
      to: "vitalik.eth",
      amount: TEST_AMOUNT,
    })

    expectTransactionPreview(result)
    expect(result.resolvedEnsName).toBe("vitalik.eth")
    expect(result.recipient).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
  })

  test("send_token handles an ERC-20 transfer request", async () => {
    const result = await prepareSendToken({
      to: walletAddress,
      amount: "0.001",
      token: ARBITRUM_USDC_ADDRESS,
    })

    if (isRecord(result) && result.kind === "transaction_preview") {
      expectTransactionPreview(result)
      expect(result.asset?.type).toBe("ERC20")
      expect(result.asset?.symbol).toBe("USDC")
      expect(result.amount).toBe("0.001")
      expect(result.recipient).toBe(walletAddress)
      expect(Number(result.gasEstimate?.gasLimit ?? "0")).toBeGreaterThan(0)
      return
    }

    expectTransactionError(result)
    expect((result.error ?? result.message ?? "").toLowerCase()).toMatch(
      /insufficient usdc balance/
    )
  })

  test("send_token rejects a token address with no ERC-20 contract", async () => {
    const result = await prepareSendToken({
      to: walletAddress,
      amount: "1",
      token: "0x0000000000000000000000000000000000000001",
    })

    expectTransactionError(result)
    expect((result.error ?? result.message ?? "").toLowerCase()).toMatch(
      /invalid|contract|erc-20/
    )
  })

  test("send_token returns an insufficient balance error", async () => {
    const result = await prepareSendToken({
      to: walletAddress,
      amount: "999999",
    })

    expectTransactionError(result)
    expect((result.error ?? result.message ?? "").toLowerCase()).toMatch(
      /insufficient|exceeds the balance/
    )
  })

  test("send_eoa_transfer returns a clear error for unknown confirmation IDs", async () => {
    const updates = await collectSendEoaTransferUpdates("nonexistent-uuid")
    const firstUpdate = updates[0]

    expect(updates).toHaveLength(1)
    expectTransactionError(firstUpdate)
    expect(firstUpdate.message).toContain("expired or was not found")
  })
})
