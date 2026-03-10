import type { UIMessageChunk } from "ai"

const SAMPLE_SENDER = "0x1111111111111111111111111111111111111111"
const SAMPLE_RECIPIENT = "0x2222222222222222222222222222222222222222"
const SAMPLE_SAFE = "0x4581812Df7500277e3fC72CF93f766DBBd32d371"
const SAMPLE_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

function toolResponse(toolName: string, input: unknown, output: unknown): UIMessageChunk[] {
  const toolCallId = `${toolName}-call`

  return [
    { type: "start", messageId: `${toolName}-message` },
    {
      type: "tool-input-available",
      toolCallId,
      toolName,
      input,
    },
    {
      type: "tool-output-available",
      toolCallId,
      output,
    },
    { type: "finish", finishReason: "stop" },
  ]
}

const E2E_CHAT_MOCK_SCENARIOS = {
  textReply: [
    { type: "start", messageId: "assistant-text" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: "Mock assistant reply." },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: "stop" },
  ],
  balanceWidget: toolResponse(
    "get_balance",
    { address: SAMPLE_SENDER },
    {
      address: SAMPLE_SENDER,
      blockNumber: 321123456,
      nativeBalance: {
        symbol: "ETH",
        decimals: 18,
        rawBalance: "1230000000000000000",
        formattedBalance: "1.23",
      },
      tokens: [
        {
          address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          symbol: "USDC",
          decimals: 6,
          rawBalance: "4200000",
          formattedBalance: "4.2",
        },
      ],
      errors: [],
    }
  ),
  transactionPreviewWidget: toolResponse(
    "prepare_eoa_transfer",
    { to: SAMPLE_RECIPIENT, amount: "0.000001" },
    {
      kind: "transaction_preview",
      status: "awaiting_confirmation",
      summary: "Sending 0.000001 ETH to 0x2222...2222",
      message: "Transaction prepared. Confirm before signing.",
      confirmationId: "preview-confirmation-id",
      chain: { id: 42161, name: "Arbitrum One", nativeSymbol: "ETH" },
      sender: SAMPLE_SENDER,
      recipient: SAMPLE_RECIPIENT,
      recipientInput: SAMPLE_RECIPIENT,
      asset: { type: "ETH", symbol: "ETH" },
      amount: "0.000001",
      balance: { asset: "ETH", amount: "1.23" },
      gasEstimate: {
        gasLimit: "21000",
        maxFeePerGasGwei: "0.1",
        maxPriorityFeePerGasGwei: "0.01",
        gasCostNative: "0.0000021",
      },
    }
  ),
  transactionConfirmedWidget: toolResponse(
    "send_eoa_transfer",
    { confirmationId: "preview-confirmation-id" },
    {
      kind: "transaction_progress",
      status: "confirmed",
      summary: "Sending 0.000001 ETH to 0x2222...2222",
      message: "Confirmed in block 321123456.",
      chain: { id: 42161, name: "Arbitrum One", nativeSymbol: "ETH" },
      sender: SAMPLE_SENDER,
      recipient: SAMPLE_RECIPIENT,
      recipientInput: SAMPLE_RECIPIENT,
      asset: { type: "ETH", symbol: "ETH" },
      amount: "0.000001",
      steps: [
        { key: "estimate", label: "Estimating gas", status: "complete" },
        { key: "build", label: "Building transaction", status: "complete" },
        { key: "sign", label: "Signing transaction", status: "complete" },
        { key: "broadcast", label: "Broadcasting transaction", status: "complete" },
        { key: "confirm", label: "Waiting for confirmation", status: "complete" },
      ],
      txHash: SAMPLE_TX_HASH,
      explorerUrl: `https://arbiscan.io/tx/${SAMPLE_TX_HASH}`,
      receipt: {
        status: "success",
        blockNumber: 321123456,
        gasUsed: "21000",
        effectiveGasPriceGwei: "0.1",
        gasCostNative: "0.0000021",
      },
    }
  ),
  ensWidget: toolResponse(
    "resolve_ens",
    { name: "vitalik.eth" },
    {
      name: "vitalik.eth",
      normalizedName: "vitalik.eth",
      address: VITALIK_ADDRESS,
      error: null,
      errorCode: null,
      resolutionChainId: 1,
    }
  ),
  safeInfoWidget: toolResponse(
    "get_safe_info",
    {},
    {
      address: SAMPLE_SAFE,
      owners: [
        "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
        "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      ],
      threshold: 2,
      nonce: 17,
      balance: "0.42 ETH",
    }
  ),
  errorWidget: toolResponse(
    "prepare_eoa_transfer",
    { to: SAMPLE_RECIPIENT, amount: "999999" },
    {
      kind: "transaction_error",
      status: "error",
      summary: "Transaction preparation failed",
      message: "Insufficient ETH. Need about 999999 ETH including gas.",
      error: "Insufficient ETH. Need about 999999 ETH including gas.",
      chain: { id: 42161, name: "Arbitrum One", nativeSymbol: "ETH" },
    }
  ),
} satisfies Record<string, UIMessageChunk[]>

export type E2EChatMockScenario = keyof typeof E2E_CHAT_MOCK_SCENARIOS

export function isE2EChatMockScenario(value: string): value is E2EChatMockScenario {
  return value in E2E_CHAT_MOCK_SCENARIOS
}

export function buildE2EChatMockSseBody(scenario: E2EChatMockScenario) {
  return `${E2E_CHAT_MOCK_SCENARIOS[scenario]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`
}
