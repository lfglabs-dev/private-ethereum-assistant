import { beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createTools } from "@/lib/tools"
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  collectAsyncIterable,
  executeTool,
  executeToolStream,
  getWalletAddress,
} from "../helpers/config"
import { verificationClient } from "../helpers/verification-client"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS)

const tools = createTools(ARBITRUM_CONFIG)
const walletAddress = getWalletAddress()
const TEST_AMOUNT = "0.000001"

describe("EOA transfer E2E", () => {
  let preview: any
  let updates: Array<any> = []
  let balanceBefore = BigInt(0)
  let balanceAfter = BigInt(0)

  beforeAll(async () => {
    preview = await executeTool(tools.prepare_eoa_transfer, {
      to: walletAddress,
      amount: TEST_AMOUNT,
    })

    expect(preview.kind).toBe("transaction_preview")
    if (!preview.confirmationId) {
      throw new Error("prepare_eoa_transfer did not return a confirmationId.")
    }

    balanceBefore = await verificationClient.getBalance({ address: walletAddress })
    updates = await collectAsyncIterable(
      executeToolStream(tools.send_eoa_transfer, {
        confirmationId: preview.confirmationId,
      })
    )
    balanceAfter = await verificationClient.getBalance({ address: walletAddress })
  })

  test("prepare_eoa_transfer builds an ETH transfer preview to self", () => {
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

  test("prepare_eoa_transfer and send_eoa_transfer complete a self-transfer on Arbitrum", async () => {
    const finalUpdate = updates.at(-1)

    expect(finalUpdate?.status).toBe("confirmed")
    expect(finalUpdate?.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(finalUpdate?.receipt?.status).toBe("success")
    expect(finalUpdate?.receipt?.blockNumber).toBeGreaterThan(0)
    expect(finalUpdate?.explorerUrl).toContain("arbiscan.io")

    const receipt = await verificationClient.getTransactionReceipt({
      hash: finalUpdate.txHash,
    })
    expect(receipt.status).toBe("success")
    expect(balanceBefore - balanceAfter).toBe(
      receipt.gasUsed * receipt.effectiveGasPrice
    )
  })

  test("send_eoa_transfer yields the full transaction lifecycle", () => {
    expect(updates.map((update) => update.status)).toEqual([
      "estimating_gas",
      "building",
      "signing",
      "broadcasting",
      "waiting_for_confirmation",
      "confirmed",
    ])
  })

  test("prepare_eoa_transfer resolves ENS recipients", async () => {
    const result = await executeTool(tools.prepare_eoa_transfer, {
      to: "vitalik.eth",
      amount: TEST_AMOUNT,
    })

    expect(result.kind).toBe("transaction_preview")
    expect(result.resolvedEnsName).toBe("vitalik.eth")
    expect(result.recipient).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
  })

  test("prepare_eoa_transfer returns an insufficient balance error", async () => {
    const result = await executeTool(tools.prepare_eoa_transfer, {
      to: walletAddress,
      amount: "999999",
    })

    expect(result.kind).toBe("transaction_error")
    if (!("error" in result) || typeof result.error !== "string") {
      throw new Error("Expected a transaction error payload.")
    }
    expect(result.error.toLowerCase()).toMatch(/insufficient|exceeds the balance/)
  })

  test("send_eoa_transfer returns a clear error for unknown confirmation IDs", async () => {
    const updates = await collectAsyncIterable(
      executeToolStream(tools.send_eoa_transfer, {
        confirmationId: "nonexistent-uuid",
      })
    )

    expect(updates).toHaveLength(1)
    expect(updates[0]?.kind).toBe("transaction_error")
    expect(updates[0]?.message).toContain("expired or was not found")
  })
})
