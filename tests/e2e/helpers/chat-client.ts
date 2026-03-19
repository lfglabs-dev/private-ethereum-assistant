import { setTimeout as delay } from "node:timers/promises"
import {
  DefaultChatTransport,
  readUIMessageStream,
  type UIMessageChunk,
} from "ai"
import type { NetworkConfig } from "@/lib/ethereum"
import type { AssistantUIMessage } from "@/lib/chat-stream"
import {
  createDefaultRuntimeConfig,
  type RuntimeConfig,
} from "@/lib/runtime-config"
import type { ModeSwitchRequiredResult } from "@/lib/mode"
import { ARBITRUM_CONFIG, getWalletPrivateKey } from "./config"

const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3100"
const DEV_PORT = new URL(APP_URL).port || "3000"

let devServer: Bun.Subprocess | undefined
let startedDevServer = false
const RAILGUN_APPROVAL_TEST_THRESHOLD = "0.0000005"

type ToolCallSnapshot = {
  toolName: string
  state: string
  input: unknown
  output?: unknown
  errorText?: string
}

export type ChatExchange = {
  messages: AssistantUIMessage[]
  assistantMessage: AssistantUIMessage
  text: string
  toolCalls: ToolCallSnapshot[]
  modeSwitches: ModeSwitchRequiredResult[]
}

async function readProcessOutput(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | number | undefined,
) {
  return stream instanceof ReadableStream ? new Response(stream).text() : ""
}

async function isServerReady() {
  try {
    const response = await fetch(APP_URL)
    if (!response.ok) {
      return false
    }

    const html = await response.text()
    return html.includes("<title>Private Ethereum Assistant</title>")
  } catch {
    return false
  }
}

export async function ensureChatServer() {
  if (await isServerReady()) {
    return
  }

  devServer = Bun.spawn({
    cmd: ["bunx", "next", "dev", "--hostname", "127.0.0.1", "--port", DEV_PORT],
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_MODE: "developer",
      NEXT_PUBLIC_APP_MODE: "developer",
      EOA_LOCAL_APPROVAL_NATIVE_THRESHOLD:
        process.env.E2E_LOCAL_APPROVAL_NATIVE_THRESHOLD ?? "0.00001",
      RAILGUN_SHIELD_APPROVAL_THRESHOLD: RAILGUN_APPROVAL_TEST_THRESHOLD,
      RAILGUN_TRANSFER_APPROVAL_THRESHOLD: RAILGUN_APPROVAL_TEST_THRESHOLD,
      RAILGUN_UNSHIELD_APPROVAL_THRESHOLD: RAILGUN_APPROVAL_TEST_THRESHOLD,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  startedDevServer = true

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await isServerReady()) {
      return
    }

    if ((await Promise.race([devServer.exited, delay(100)])) !== undefined) {
      break
    }

    await delay(500)
  }

  const stdout = await readProcessOutput(devServer.stdout)
  const stderr = await readProcessOutput(devServer.stderr)
  throw new Error(
    `Next.js dev server did not become ready on ${APP_URL}.\n${stdout}\n${stderr}`.trim(),
  )
}

export async function cleanupChatServer() {
  if (startedDevServer && devServer) {
    devServer.kill()
    await devServer.exited
  }
}

export async function createOpenRouterRuntimeConfig(
  networkConfig: NetworkConfig = ARBITRUM_CONFIG,
): Promise<RuntimeConfig> {
  const runtimeConfig = createDefaultRuntimeConfig()

  return {
    ...runtimeConfig,
    llm: {
      ...runtimeConfig.llm,
      provider: "openrouter",
      openRouterModel:
        process.env.MODEL_NAME ??
        process.env.OPENROUTER_MODEL ??
        runtimeConfig.llm.openRouterModel,
    },
    network: networkConfig,
    wallet: {
      eoaPrivateKey: await getWalletPrivateKey(),
      approvalPolicy: runtimeConfig.wallet.approvalPolicy,
    },
  }
}

function createUserMessage(text: string): AssistantUIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  }
}

function getText(message: AssistantUIMessage) {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => {
      return part.type === "text"
    })
    .map((part) => part.text)
    .join("\n")
}

function getToolCalls(message: AssistantUIMessage): ToolCallSnapshot[] {
  return message.parts.flatMap((part) => {
    if (part.type === "dynamic-tool") {
      const toolPart = part as typeof part & {
        state: string
        input: unknown
        output?: unknown
        errorText?: string
      }

      return [
        {
          toolName: String(part.toolName),
          state: toolPart.state,
          input: toolPart.input,
          output: toolPart.output,
          errorText: toolPart.errorText,
        },
      ]
    }

    if (!part.type.startsWith("tool-")) {
      return []
    }

    const toolPart = part as typeof part & {
      state: string
      input: unknown
      output?: unknown
      errorText?: string
    }

    return [
      {
        toolName: part.type.slice("tool-".length),
        state: toolPart.state,
        input: toolPart.input,
        output: toolPart.output,
        errorText: toolPart.errorText,
      },
    ]
  })
}

function getModeSwitches(message: AssistantUIMessage): ModeSwitchRequiredResult[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "data-modeSwitchRequired") {
      return []
    }

    const data = "data" in part ? part.data : undefined
    if (typeof data !== "object" || data === null) {
      return []
    }

    return [data as ModeSwitchRequiredResult]
  })
}

async function readAssistantMessage(
  stream: ReadableStream,
): Promise<AssistantUIMessage> {
  let finalMessage: AssistantUIMessage | undefined

  for await (const message of readUIMessageStream<AssistantUIMessage>({
    stream: stream as ReadableStream<UIMessageChunk>,
    terminateOnError: true,
  })) {
    finalMessage = message
  }

  if (!finalMessage) {
    throw new Error("No assistant message was returned from /api/chat.")
  }

  return finalMessage
}

export async function sendChatPrompt({
  prompt,
  messages = [],
  runtimeConfig = createOpenRouterRuntimeConfig(),
  networkConfig = runtimeConfig.network,
}: {
  prompt: string
  messages?: AssistantUIMessage[]
  runtimeConfig?: RuntimeConfig
  networkConfig?: NetworkConfig
}): Promise<ChatExchange> {
  const transport = new DefaultChatTransport<AssistantUIMessage>({
    api: `${APP_URL}/api/chat`,
  })
  const nextMessages = [...messages, createUserMessage(prompt)]
  const stream = await transport.sendMessages({
    chatId: crypto.randomUUID(),
    messages: nextMessages,
    abortSignal: undefined,
    body: {
      networkConfig,
      runtimeConfig,
    },
    metadata: undefined,
    headers: undefined,
    trigger: "submit-message",
    messageId: nextMessages.at(-1)?.id,
  })

  const assistantMessage = await readAssistantMessage(stream)

  return {
    messages: [...nextMessages, assistantMessage] as AssistantUIMessage[],
    assistantMessage,
    text: getText(assistantMessage),
    toolCalls: getToolCalls(assistantMessage),
    modeSwitches: getModeSwitches(assistantMessage),
  }
}
