"use client"

import { useChat } from "@ai-sdk/react"
import { useSyncExternalStore, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowDown } from "lucide-react"
import { DEFAULT_NETWORK_CONFIG, NETWORK_PRESETS } from "@/lib/ethereum"
import { EthereumIcon } from "@/components/icons/ethereum-icon"
import { NetworkSettings, type NetworkFormState } from "@/components/chat/network-settings"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ChatMessage } from "@/components/chat/chat-message"
import { ChatDebugPanel } from "@/components/chat/chat-debug-panel"
import { ChatWelcome } from "@/components/chat/chat-welcome"
import { ChatInput } from "@/components/chat/chat-input"
import { ChatError } from "@/components/chat/chat-error"
import { ThemeToggle } from "@/components/theme-toggle"
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom"
import {
  assistantDataPartSchemas,
  type AssistantUIMessage,
  type DebugLogEntry,
} from "@/lib/chat-stream"

const NETWORK_STORAGE_KEY = "private-ethereum-assistant.network.v1"
const NETWORK_STORAGE_EVENT = "private-ethereum-assistant.network.changed"
const E2E_CHAT_MOCK_STORAGE_KEY = "private-ethereum-assistant.e2e-chat-mock-scenario"

const DEFAULT_NETWORK_FORM_STATE: NetworkFormState = {
  chainId: String(DEFAULT_NETWORK_CONFIG.chainId),
  rpcUrl: DEFAULT_NETWORK_CONFIG.rpcUrl,
}

let cachedNetworkSettingsRaw: string | null = null
let cachedNetworkSettingsValue = DEFAULT_NETWORK_FORM_STATE

function loadInitialNetworkSettings(): NetworkFormState {
  if (typeof window === "undefined") {
    return DEFAULT_NETWORK_FORM_STATE
  }

  const raw = window.localStorage.getItem(NETWORK_STORAGE_KEY)
  if (!raw) {
    cachedNetworkSettingsRaw = null
    cachedNetworkSettingsValue = DEFAULT_NETWORK_FORM_STATE
    return DEFAULT_NETWORK_FORM_STATE
  }

  if (raw === cachedNetworkSettingsRaw) {
    return cachedNetworkSettingsValue
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NetworkFormState>
    if (typeof parsed.chainId === "string" && typeof parsed.rpcUrl === "string") {
      cachedNetworkSettingsRaw = raw
      cachedNetworkSettingsValue = {
        chainId: parsed.chainId,
        rpcUrl: parsed.rpcUrl,
      }
      return cachedNetworkSettingsValue
    }
  } catch {
    window.localStorage.removeItem(NETWORK_STORAGE_KEY)
  }

  cachedNetworkSettingsRaw = null
  cachedNetworkSettingsValue = DEFAULT_NETWORK_FORM_STATE
  return DEFAULT_NETWORK_FORM_STATE
}

function subscribeToNetworkSettings(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === NETWORK_STORAGE_KEY) {
      onStoreChange()
    }
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(NETWORK_STORAGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(NETWORK_STORAGE_EVENT, onStoreChange)
  }
}

function updateNetworkSettings(value: NetworkFormState) {
  if (typeof window === "undefined") {
    return
  }

  const serialized = JSON.stringify(value)
  cachedNetworkSettingsRaw = serialized
  cachedNetworkSettingsValue = value
  window.localStorage.setItem(NETWORK_STORAGE_KEY, serialized)
  window.dispatchEvent(new Event(NETWORK_STORAGE_EVENT))
}

function loadE2EChatMockScenario() {
  if (typeof window === "undefined") {
    return undefined
  }

  const value = window.localStorage.getItem(E2E_CHAT_MOCK_STORAGE_KEY)
  return value?.trim() || undefined
}

function getNetworkLabel(value: NetworkFormState) {
  return (
    NETWORK_PRESETS.find((preset) => String(preset.chainId) === value.chainId)?.name ??
    "Custom Network"
  )
}

export default function Home() {
  const [debugEntries, setDebugEntries] = useState<DebugLogEntry[]>([])
  const [showDebugTrace, setShowDebugTrace] = useState(false)
  const { messages, sendMessage, stop, status, error, clearError } = useChat<AssistantUIMessage>({
    dataPartSchemas: assistantDataPartSchemas,
    onData: (part) => {
      if (part.type !== "data-debug") return

      setDebugEntries((entries) => [...entries.slice(-23), part.data])
    },
  })
  const [input, setInput] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const networkSettings = useSyncExternalStore(
    subscribeToNetworkSettings,
    loadInitialNetworkSettings,
    () => DEFAULT_NETWORK_FORM_STATE,
  )
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useScrollToBottom()

  const isLoading = status === "submitted" || status === "streaming"
  const isSubmitted = status === "submitted"
  const activeNetworkLabel = getNetworkLabel(networkSettings)

  const sendChatMessage = (text: string) => {
    setDebugEntries([])
    setShowDebugTrace(false)
    sendMessage(
      { text },
      {
        body: {
          networkConfig: {
            chainId: networkSettings.chainId,
            rpcUrl: networkSettings.rpcUrl.trim(),
          },
          e2eMockScenario: loadE2EChatMockScenario(),
        },
      },
    )
  }

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return
    clearError()
    sendChatMessage(input)
    setInput("")
  }

  const handleSuggestion = (suggestion: string) => {
    clearError()
    sendChatMessage(suggestion)
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <EthereumIcon className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="font-serif text-sm font-semibold">Private Ethereum Assistant</h1>
            <p className="text-xs text-muted-foreground">
              Local LLM &middot; {activeNetworkLabel} &middot; Safe + Railgun + Local Signing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <NetworkSettings
            value={networkSettings}
            onChange={updateNetworkSettings}
            isOpen={settingsOpen}
            onToggle={() => setSettingsOpen((open) => !open)}
          />
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Local</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div ref={containerRef} className="relative flex-1 overflow-y-auto">
        <div ref={endRef} className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 && !error && (
            <ChatWelcome onSuggestionClick={handleSuggestion} />
          )}

          {messages.map((message, index) => (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isLoading && index === messages.length - 1 && message.role === "assistant"}
              traceEntries={debugEntries}
              showTrace={showDebugTrace && index === messages.length - 1 && message.role === "assistant"}
              canToggleTrace={index === messages.length - 1 && message.role === "assistant"}
              onToggleTrace={() => setShowDebugTrace((visible) => !visible)}
            />
          ))}

          {isSubmitted && (messages.length === 0 || messages[messages.length - 1].role === "user") && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <button
                type="button"
                onClick={() => setShowDebugTrace((visible) => !visible)}
                className="rounded-full transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label={showDebugTrace ? "Hide model trace" : "Show model trace"}
                title={showDebugTrace ? "Hide model trace" : "Show model trace"}
              >
                <Avatar size="sm" className="mt-0.5 shrink-0">
                  <AvatarFallback className="bg-secondary">
                    <EthereumIcon className="size-3.5" />
                  </AvatarFallback>
                </Avatar>
              </button>
              <div className="max-w-[80%] space-y-2">
                <div className="rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3">
                  <ThinkingIndicator />
                </div>
                {showDebugTrace && (
                  <ChatDebugPanel entries={debugEntries} isStreaming={isLoading} />
                )}
              </div>
            </motion.div>
          )}

          {error && <ChatError error={error} onDismiss={clearError} />}
        </div>

        <AnimatePresence>
          {!isAtBottom && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="sticky bottom-4 flex justify-center"
            >
              <Button
                variant="outline"
                size="icon"
                className="size-8 rounded-full bg-background/80 shadow-md backdrop-blur-sm"
                onClick={() => scrollToBottom()}
              >
                <ArrowDown className="size-4" />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        isLoading={isLoading}
        networkLabel={activeNetworkLabel}
      />
    </div>
  )
}
