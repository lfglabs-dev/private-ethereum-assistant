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
import { ensureRailgunShieldedEthBalance } from "../helpers/railgun"
import {
  cleanupChatServer,
  createOpenRouterRuntimeConfig,
  ensureChatServer,
  sendChatPrompt,
} from "../helpers/chat-client"
import {
  BALANCE_ROUTING_ETH_AMOUNT,
  BALANCE_ROUTING_PRIVACY_GUIDANCE,
  createBalanceRoutingRuntimeConfig,
} from "../helpers/railgun-balance-routing"

setDefaultTimeout(E2E_TEST_TIMEOUT_MS * 6)

const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
const walletAddress = await getWalletAddress()
const runtimeConfig = await createOpenRouterRuntimeConfig(ARBITRUM_CONFIG)
const safeModeRuntimeConfig = {
  ...runtimeConfig,
  actor: {
    type: "safe" as const,
  },
}
const privateModeRuntimeConfig = {
  ...runtimeConfig,
  actor: {
    type: "railgun" as const,
  },
}
const safeSwapRuntimeConfig = {
  ...runtimeConfig,
  actor: {
    type: "safe" as const,
  },
}
const balanceRoutingRuntimeConfig = await createBalanceRoutingRuntimeConfig(ARBITRUM_CONFIG)
const longRunningRuntimeConfig = {
  ...runtimeConfig,
  llm: {
    ...runtimeConfig.llm,
    timeoutMs: Math.max(runtimeConfig.llm.timeoutMs, 420_000),
  },
  actor: {
    type: "railgun" as const,
  },
}

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

function findModeSwitch(
  modeSwitches: Array<{
    requestedMode: string
    originalRequest: string
  }>,
  requestedMode: string,
) {
  const modeSwitch = modeSwitches.find((entry) => entry.requestedMode === requestedMode)
  if (!modeSwitch) {
    throw new Error(
      `Expected a ${requestedMode} mode switch. Saw: ${modeSwitches.map((entry) => entry.requestedMode).join(", ")}`,
    )
  }

  return modeSwitch
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

    const previewCall = findToolCall(result.toolCalls, "send_token")
    expect(isRecord(previewCall.input) ? previewCall.input.to : undefined).toBe(walletAddress)
    expect(isRecord(previewCall.input) ? previewCall.input.amount : undefined).toBe("0.000001")

    if (!isRecord(previewCall.output)) {
      throw new Error("Expected send_token to return a preview payload.")
    }

    expect(previewCall.output.kind).toBe("transaction_preview")
    expect(result.text.toLowerCase()).toMatch(/confirm|prepared|gas/)
  })

  test("LLM requires local approval for a high-value ETH transfer", async () => {
    const result = await sendChatPrompt({
      prompt: "Send 0.00002 ETH to vitalik.eth.",
      runtimeConfig,
    })

    const previewCall = findToolCall(result.toolCalls, "send_token")
    expect(isRecord(previewCall.input) ? previewCall.input.to : undefined).toBe("vitalik.eth")
    expect(isRecord(previewCall.input) ? previewCall.input.amount : undefined).toBe("0.00002")
    expect(result.toolCalls.some((entry) => entry.toolName === "send_eoa_transfer")).toBe(false)

    if (!isRecord(previewCall.output)) {
      throw new Error("Expected send_token to return a preview payload.")
    }

    expect(previewCall.output.kind).toBe("transaction_preview")
    expect(previewCall.output.status).toBe("awaiting_local_approval")
    expectTextToContain(result.text, ["0.00002 ETH", "Arbitrum", "gas"])
    expect(result.text.toLowerCase()).toMatch(/approval|approve/)
  })

  test("LLM requests a Safe mode switch instead of taking the EOA path", async () => {
    const result = await sendChatPrompt({
      prompt: "Send 0.001 ETH from my Safe to vitalik.eth.",
      runtimeConfig,
    })

    expect(result.toolCalls).toHaveLength(0)
    const modeSwitch = findModeSwitch(result.modeSwitches, "safe")
    expect(modeSwitch.originalRequest).toBe("Send 0.001 ETH from my Safe to vitalik.eth.")
  })

  test("LLM routes Safe-mode sends through ENS resolution and Safe proposal", async () => {
    const result = await sendChatPrompt({
      prompt: "Send 0.001 ETH from my Safe to vitalik.eth.",
      runtimeConfig: safeModeRuntimeConfig,
    })

    findToolCall(result.toolCalls, "resolve_ens")
    findToolCall(result.toolCalls, "propose_transaction")
    expect(result.text.toLowerCase()).toMatch(/safe|sign|proposal/)
  })

  test("LLM requests an EOA mode switch from Safe mode when the user asks for the EOA path", async () => {
    const result = await sendChatPrompt({
      prompt: "Send 0.001 ETH from my EOA to vitalik.eth.",
      runtimeConfig: safeModeRuntimeConfig,
    })

    expect(result.toolCalls).toHaveLength(0)
    const modeSwitch = findModeSwitch(result.modeSwitches, "eoa")
    expect(modeSwitch.originalRequest).toBe("Send 0.001 ETH from my EOA to vitalik.eth.")
  })

  test("LLM queries Safe info in Safe mode", async () => {
    const result = await sendChatPrompt({
      prompt: "Show me info about our Safe wallet.",
      runtimeConfig: safeModeRuntimeConfig,
    })

    findToolCall(result.toolCalls, "get_safe_info")
    expect(result.text).toMatch(/owner|threshold|balance/i)
  })

  test("LLM lists pending Safe transactions in Safe mode", async () => {
    const result = await sendChatPrompt({
      prompt: "Are there any pending Safe transactions?",
      runtimeConfig: safeModeRuntimeConfig,
    })

    findToolCall(result.toolCalls, "get_pending_transactions")
    expect(result.text.toLowerCase()).toMatch(/pending|no pending|safe/i)
  })

  test("LLM routes Safe swap prompts through swap_tokens", async () => {
    const result = await sendChatPrompt({
      prompt: "Swap 0.001 ETH for USDC.",
      runtimeConfig: safeSwapRuntimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "swap_tokens")
    expect(isRecord(toolCall.input) ? toolCall.input.sellToken : undefined).toBe("ETH")
    expect(isRecord(toolCall.input) ? toolCall.input.buyToken : undefined).toBe("USDC")
    expect(isRecord(toolCall.input) ? toolCall.input.amount : undefined).toBe("0.001")

    if (!isRecord(toolCall.output)) {
      throw new Error("Expected swap_tokens to return a swap result.")
    }

    expect(toolCall.output.kind).toBe("swap_result")
    expect(toolCall.output.actor).toBe("safe")
    expect(toolCall.output.status).toBe("manual_action_required")
    expect(result.text.toLowerCase()).toMatch(/safe|swap|usdc/)
  })

  test("LLM requests an EOA mode switch for swaps from Private mode", async () => {
    const result = await sendChatPrompt({
      prompt: "Swap 0.001 ETH for USDC.",
      runtimeConfig: privateModeRuntimeConfig,
    })

    expect(result.toolCalls).toHaveLength(0)
    findModeSwitch(result.modeSwitches, "eoa")
  })

  test("LLM checks the Railgun balance", async () => {
    const result = await sendChatPrompt({
      prompt: "What is my shielded Railgun balance?",
      runtimeConfig: privateModeRuntimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "railgun_balance")
    expect(toolCall.state).toMatch(/input|output|error/)
    if (isRecord(toolCall.output)) {
      expect(toolCall.output.railgun).toBe(true)
    }
  })

  test("LLM returns local approval-required Railgun shielding responses before signing", async () => {
    const result = await sendChatPrompt({
      prompt:
        "I understand the Railgun deposit is public. Shield 0.000001 ETH into Railgun now.",
      runtimeConfig: privateModeRuntimeConfig,
    })

    const toolCall = findToolCall(result.toolCalls, "railgun_shield")
    expect(isRecord(toolCall.input) ? toolCall.input.token : undefined).toBe("ETH")
    expect(isRecord(toolCall.input) ? toolCall.input.amount : undefined).toBe("0.000001")

    if (!isRecord(toolCall.output)) {
      return
    }

    expect(toolCall.output.railgun).toBe(true)
    expect(toolCall.output.status).toBe("awaiting_local_approval")
    expect(toolCall.output.operation).toBe("shield")
    expect(typeof toolCall.output.summary).toBe("string")
    expect(typeof toolCall.output.privacyImpact).toBe("string")
    expect(result.text.toLowerCase()).toMatch(/approve|local approval/)
    expect(result.text.toLowerCase()).toMatch(/privacy|public/)
  })

  test("LLM recommends shielding instead of attempting a private spend with insufficient private balance", async () => {
    const result = await sendChatPrompt({
      prompt: `Send ${BALANCE_ROUTING_ETH_AMOUNT} ETH to vitalik.eth from my private balance.`,
      runtimeConfig: balanceRoutingRuntimeConfig,
    })

    findToolCall(result.toolCalls, "resolve_ens")
    // The model should attempt railgun_unshield (which internally checks balance
    // and returns an insufficient-balance result with shielding guidance).
    const unshieldCall = findToolCall(result.toolCalls, "railgun_unshield")
    expect(isRecord(unshieldCall.input) ? unshieldCall.input.token : undefined).toBe("ETH")

    expect(result.text.toLowerCase()).toContain("private")
    expect(result.text.toLowerCase()).toContain("shield")
  })

  test("LLM routes private-balance ENS sends through railgun_unshield", async () => {
    await ensureRailgunShieldedEthBalance("0.00001")

    const result = await sendChatPrompt({
      prompt: "Send 0.00001 ETH to vitalik.eth from my private balance.",
      runtimeConfig: longRunningRuntimeConfig,
    })

    const ensCall = findToolCall(result.toolCalls, "resolve_ens")
    expect(isRecord(ensCall.input) ? ensCall.input.name : undefined).toBe("vitalik.eth")

    const unshieldCall = findToolCall(result.toolCalls, "railgun_unshield")
    expect(isRecord(unshieldCall.input) ? unshieldCall.input.recipient : undefined).toBe(
      VITALIK_ADDRESS,
    )
    expect(isRecord(unshieldCall.input) ? unshieldCall.input.token : undefined).toBe("ETH")
    expect(isRecord(unshieldCall.input) ? unshieldCall.input.amount : undefined).toBe("0.00001")
    expect(result.toolCalls.some((entry) => entry.toolName === "railgun_transfer")).toBe(
      false,
    )

    if (!isRecord(unshieldCall.output)) {
      throw new Error("Expected railgun_unshield to return a structured result.")
    }

    expect(unshieldCall.output.status).toBe("success")
    expect(unshieldCall.output.operation).toBe("unshield")
    expect(unshieldCall.output.recipient).toBe(VITALIK_ADDRESS)
    expect(typeof unshieldCall.output.txHash).toBe("string")
    expect(typeof unshieldCall.output.privacyNote).toBe("string")
    expect(String(unshieldCall.output.privacyNote).toLowerCase()).toContain("privacy")
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
