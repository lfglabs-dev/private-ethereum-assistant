import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test"
import type { AssistantUIMessage } from "@/lib/chat-stream"
import {
  ARBITRUM_CONFIG,
  ARBITRUM_USDC_ADDRESS,
  E2E_TEST_TIMEOUT_MS,
  getWalletAddress,
} from "../helpers/config"
import { findRecentTransactionHash } from "../helpers/verification-client"
import {
  cleanupChatServer,
  createOpenRouterRuntimeConfig,
  ensureChatServer,
  sendChatPrompt,
} from "../helpers/chat-client"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS * 2)

const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const walletAddress = getWalletAddress()
const runtimeConfig = createOpenRouterRuntimeConfig(ARBITRUM_CONFIG)

type ToolCallSnapshot = {
  toolName: string
  state: string
  input: unknown
  output?: unknown
  errorText?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function findToolCall(
  toolCalls: ToolCallSnapshot[],
  toolName: string,
): ToolCallSnapshot {
  const toolCall = toolCalls.find((entry) => entry.toolName === toolName)
  if (!toolCall) {
    throw new Error(
      `Expected ${toolName} to be called. Saw: ${toolCalls.map((entry) => entry.toolName).join(", ")}`,
    )
  }

  return toolCall
}

function expectTextToContain(text: string, expected: string[]) {
  for (const fragment of expected) {
    expect(text).toContain(fragment)
  }
}

describe("LLM tool routing E2E", () => {
  beforeAll(async () => {
    await ensureChatServer()
  })

  afterAll(async () => {
    await cleanupChatServer()
  })

  test("LLM resolves an ENS name", async () => {
    const result = await sendChatPrompt({
      prompt: "What is the address of vitalik.eth?",
      runtimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "resolve_ens")
    expect(isRecord(toolCall.input) ? toolCall.input.name : undefined).toBe("vitalik.eth")
    expectTextToContain(result.text, ["vitalik.eth", VITALIK_ADDRESS])
  })

  test("LLM reverse-resolves an address", async () => {
    const result = await sendChatPrompt({
      prompt: `What ENS name is associated with ${VITALIK_ADDRESS}?`,
      runtimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "reverse_resolve_ens")
    expect(isRecord(toolCall.input) ? toolCall.input.address : undefined).toBe(
      VITALIK_ADDRESS,
    )
    expect(result.text.toLowerCase()).toContain("vitalik.eth")
  })

  test("LLM resolves ENS and then checks ETH balance", async () => {
    const result = await sendChatPrompt({
      prompt: "What is the ETH balance of vitalik.eth on Arbitrum?",
      runtimeConfig,
    })

    findToolCall(result.toolCalls, "resolve_ens")
    const balanceCall = findToolCall(result.toolCalls, "get_balance")
    expect(isRecord(balanceCall.input) ? balanceCall.input.address : undefined).toBe(
      VITALIK_ADDRESS,
    )
    expect(result.text).toContain("ETH")
    expect(result.text).toContain("vitalik.eth")
  })

  test("LLM checks a specific token balance with the provided token address", async () => {
    const result = await sendChatPrompt({
      prompt: `Check the USDC balance for wallet ${walletAddress} using token contract ${ARBITRUM_USDC_ADDRESS}.`,
      runtimeConfig,
    })

    const balanceCall = findToolCall(result.toolCalls, "get_balance")
    expect(isRecord(balanceCall.input) ? balanceCall.input.address : undefined).toBe(
      walletAddress,
    )
    expect(isRecord(balanceCall.input) ? balanceCall.input.tokenAddress : undefined).toBe(
      ARBITRUM_USDC_ADDRESS,
    )
    expect(result.text).toContain("USDC")
  })

  test("LLM looks up a transaction", async () => {
    const hash = await findRecentTransactionHash()
    const result = await sendChatPrompt({
      prompt: `Look up transaction ${hash} on Arbitrum.`,
      runtimeConfig,
    })

    const txCall = findToolCall(result.toolCalls, "get_transaction")
    expect(isRecord(txCall.input) ? txCall.input.hash : undefined).toBe(hash)
    expect(result.text).toMatch(/block|status|from|to/i)
  })

  test("LLM prepares an ETH transfer preview without sending it", async () => {
    const result = await sendChatPrompt({
      prompt: `Send 0.000001 ETH to my own address ${walletAddress}.`,
      runtimeConfig,
    })

    const previewCall = findToolCall(result.toolCalls, "prepare_eoa_transfer")
    expect(isRecord(previewCall.input) ? previewCall.input.to : undefined).toBe(walletAddress)
    expect(isRecord(previewCall.input) ? previewCall.input.amount : undefined).toBe("0.000001")

    if (!isRecord(previewCall.output)) {
      throw new Error("Expected prepare_eoa_transfer to return a preview payload.")
    }

    expect(previewCall.output.kind).toBe("transaction_preview")
    expect(result.text.toLowerCase()).toMatch(/confirm|prepared|gas/)
  })

  test("LLM requires local approval for a high-value ETH transfer", async () => {
    const result = await sendChatPrompt({
      prompt: "Send 0.00002 ETH to vitalik.eth.",
      runtimeConfig,
    })

    const previewCall = findToolCall(result.toolCalls, "prepare_eoa_transfer")
    expect(isRecord(previewCall.input) ? previewCall.input.to : undefined).toBe("vitalik.eth")
    expect(isRecord(previewCall.input) ? previewCall.input.amount : undefined).toBe("0.00002")
    expect(result.toolCalls.some((entry) => entry.toolName === "send_eoa_transfer")).toBe(false)

    if (!isRecord(previewCall.output)) {
      throw new Error("Expected prepare_eoa_transfer to return a preview payload.")
    }

    expect(previewCall.output.kind).toBe("transaction_preview")
    expect(previewCall.output.status).toBe("awaiting_local_approval")
    expectTextToContain(result.text, ["0.00002 ETH", "Arbitrum", "gas"])
    expect(result.text.toLowerCase()).toMatch(/approval|approve/)
  })

  test("LLM queries Safe info", async () => {
    const result = await sendChatPrompt({
      prompt: "Show me info about our Safe wallet.",
      runtimeConfig,
    })

    findToolCall(result.toolCalls, "get_safe_info")
    expect(result.text).toMatch(/owner|threshold|balance/i)
  })

  test("LLM lists pending Safe transactions", async () => {
    const result = await sendChatPrompt({
      prompt: "Are there any pending Safe transactions?",
      runtimeConfig,
    })

    findToolCall(result.toolCalls, "get_pending_transactions")
    expect(result.text.toLowerCase()).toMatch(/pending|no pending|safe/i)
  })

  test("LLM checks the Railgun balance", async () => {
    const result = await sendChatPrompt({
      prompt: "What is my shielded Railgun balance?",
      runtimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "railgun_balance")
    expect(toolCall.state).toMatch(/input|output|error/)
    if (isRecord(toolCall.output)) {
      expect(toolCall.output.railgun).toBe(true)
    }
  })

  test("LLM routes confirmed Railgun shielding prompts to railgun_shield", async () => {
    const result = await sendChatPrompt({
      prompt:
        "I understand the Railgun deposit is public. Shield 0.0001 ETH into Railgun now.",
      runtimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "railgun_shield")
    expect(isRecord(toolCall.input) ? toolCall.input.token : undefined).toBe("ETH")
    expect(isRecord(toolCall.input) ? toolCall.input.amount : undefined).toBe("0.0001")

    if (!isRecord(toolCall.output)) {
      return
    }

    expect(toolCall.output.railgun).toBe(true)

    if (toolCall.output.status === "success") {
      expect(toolCall.output.operation).toBe("shield")
      expect(typeof toolCall.output.txHash).toBe("string")
      expect(typeof toolCall.output.privacyNote).toBe("string")
      return
    }

    expect(toolCall.output.status).toBe("error")
    expect(typeof toolCall.output.message).toBe("string")
  })

  test("LLM keeps routing context across turns for ENS then balance", async () => {
    const firstTurn = await sendChatPrompt({
      prompt: "Resolve vitalik.eth.",
      runtimeConfig,
    })

    const secondTurn = await sendChatPrompt({
      prompt: "What is their ETH balance?",
      messages: firstTurn.messages as AssistantUIMessage[],
      runtimeConfig,
    })

    findToolCall(secondTurn.toolCalls, "get_balance")
    expect(secondTurn.text).toContain("ETH")
  })
})
