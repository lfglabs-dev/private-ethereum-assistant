import type { Tool, ToolExecutionOptions } from "ai"
import type { NetworkConfig } from "@/lib/ethereum"
import { createDefaultRuntimeConfig } from "@/lib/runtime-config"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const ARBITRUM_CONFIG: NetworkConfig = {
  chainId: 42161,
  rpcUrl: "https://arb1.arbitrum.io/rpc",
}

export const ARBITRUM_USDC_ADDRESS =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address

export const E2E_TEST_TIMEOUT_MS = 120_000

export function getWalletPrivateKey(): Hex {
  const value = process.env.EOA_PRIVATE_KEY ?? process.env.WALLET_PRIVATE_KEY
  if (!value) {
    throw new Error(
      "Missing EOA_PRIVATE_KEY or WALLET_PRIVATE_KEY. Run the suite via dotenvx."
    )
  }

  const normalized = value.startsWith("0x") ? value : `0x${value}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Configured private key is not a valid 32-byte hex value.")
  }

  return normalized as Hex
}

export function getWalletAddress() {
  return privateKeyToAccount(getWalletPrivateKey()).address
}

export function createE2ERuntimeConfig(
  networkConfig: NetworkConfig = ARBITRUM_CONFIG
) {
  const runtimeConfig = createDefaultRuntimeConfig()
  const eoaPrivateKey = getWalletPrivateKey()

  return {
    ...runtimeConfig,
    network: networkConfig,
    wallet: {
      eoaPrivateKey,
      approvalPolicy: runtimeConfig.wallet.approvalPolicy,
    },
    railgun: {
      ...runtimeConfig.railgun,
      scanTimeoutMs: 30_000,
      pollingIntervalMs: 2_000,
      signerPrivateKey: eoaPrivateKey,
    },
  }
}

export function createToolExecutionOptions(): ToolExecutionOptions {
  return {
    toolCallId: crypto.randomUUID(),
    messages: [],
  }
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
  )
}

export async function executeTool<INPUT, OUTPUT>(
  tool: Tool<INPUT, OUTPUT>,
  input: INPUT
) {
  if (!tool.execute) {
    throw new Error("Tool does not have an execute function.")
  }

  const result = await tool.execute(input, createToolExecutionOptions())
  if (isAsyncIterable(result)) {
    throw new Error("Tool returned a stream. Use executeToolStream instead.")
  }

  return result
}

export function executeToolStream<INPUT, OUTPUT>(
  tool: Tool<INPUT, OUTPUT>,
  input: INPUT
) {
  if (!tool.execute) {
    throw new Error("Tool does not have an execute function.")
  }

  const result = tool.execute(input, createToolExecutionOptions())
  if (!isAsyncIterable(result)) {
    throw new Error("Tool did not return a stream.")
  }

  return result
}

export async function collectAsyncIterable<T>(iterable: AsyncIterable<T>) {
  const values: T[] = []

  for await (const value of iterable) {
    values.push(value)
  }

  return values
}

export async function retry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  delayMs = 750
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === attempts) {
        break
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Operation failed after retrying.")
}
