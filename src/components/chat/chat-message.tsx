"use client"

import type { UIMessage } from "ai"
import { motion } from "framer-motion"
import { Loader2, User } from "lucide-react"
import { ChatDebugPanel } from "@/components/chat/chat-debug-panel"
import { EthereumIcon } from "@/components/icons/ethereum-icon"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ToolResultCard } from "@/components/chat/tool-result-card"
import { MessageActions } from "@/components/chat/message-actions"
import { ModeSwitchCard } from "@/components/chat/mode-switch-card"
import type { DebugLogEntry, AssistantUIMessage } from "@/lib/chat-stream"
import type { ModeSwitchRequiredResult } from "@/lib/mode"
import type { RuntimeConfig } from "@/lib/runtime-config"

type Part = { type: string; [key: string]: unknown }

function getToolOutput(part: Part) {
  if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return null
  const toolName =
    part.type === "dynamic-tool"
      ? String(part.toolName || "unknown")
      : part.type.replace("tool-", "")
  return {
    state: String(part.state || ""),
    output: part.output,
    toolName,
    preliminary: Boolean(part.preliminary),
    errorText: typeof part.errorText === "string" ? part.errorText : undefined,
  }
}

function getTextContent(parts: Part[] | undefined): string {
  if (!parts) return ""
  return parts
    .filter((p) => p.type === "text")
    .map((p) => String(p.text || ""))
    .join("\n")
}

function getModeSwitchData(part: Part) {
  if (part.type !== "data-modeSwitchRequired") return null
  const data = part.data
  if (typeof data !== "object" || data === null) return null
  return data as ModeSwitchRequiredResult
}

function getToolLabel(toolName: string): string {
  switch (toolName) {
    case "railgun_balance":
      return "Scanning Railgun balances on Arbitrum"
    case "railgun_balance_route":
      return "Checking Railgun private/public balance routing"
    case "railgun_shield":
      return "Preparing Railgun shield on Arbitrum"
    case "railgun_transfer":
      return "Generating Railgun transfer proof"
    case "railgun_unshield":
      return "Generating Railgun unshield proof"
    case "swap_tokens":
      return "Planning mode-aware CoW swap"
    default:
      return `Running ${toolName}`
  }
}

interface ChatMessageProps {
  message: UIMessage | AssistantUIMessage
  isStreaming?: boolean
  traceEntries?: DebugLogEntry[]
  showTrace?: boolean
  canToggleTrace?: boolean
  onToggleTrace?: () => void
  runtimeConfig?: RuntimeConfig
  onConfirmModeSwitch?: (request: ModeSwitchRequiredResult) => void | Promise<void>
  pendingModeSwitchKey?: string | null
}

export function ChatMessage({
  message,
  isStreaming,
  traceEntries = [],
  showTrace = false,
  canToggleTrace = false,
  onToggleTrace,
  runtimeConfig,
  onConfirmModeSwitch,
  pendingModeSwitchKey = null,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const parts = message.parts as Part[] | undefined

  const hasContent = parts?.some(
    (p) =>
      (p.type === "text" && String(p.text || "").trim()) ||
      getToolOutput(p) ||
      getModeSwitchData(p),
  )
  const showTracePanel = !isUser && showTrace
  const assistantAvatar = (
    <Avatar size="sm" className="mt-0.5 shrink-0">
      <AvatarFallback className="bg-secondary">
        <EthereumIcon className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  )

  return (
    <motion.div
      data-testid={`message-${message.role}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`group flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      {isUser ? (
        <Avatar size="sm" className="mt-0.5 shrink-0">
          <AvatarFallback className="bg-primary text-primary-foreground">
            <User className="size-3.5" />
          </AvatarFallback>
        </Avatar>
      ) : canToggleTrace ? (
        <button
          type="button"
          onClick={onToggleTrace}
          className="rounded-full transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={showTracePanel ? "Hide model trace" : "Show model trace"}
          title={showTracePanel ? "Hide model trace" : "Show model trace"}
        >
          {assistantAvatar}
        </button>
      ) : (
        assistantAvatar
      )}

      <div className={`max-w-[80%] space-y-2 ${isUser ? "items-end" : ""}`}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
            {parts?.map((part, i) => {
              if (part.type === "text") {
                const text = String(part.text || "")
                if (!text) return null
                return (
                  <p key={i} className="whitespace-pre-wrap leading-relaxed">
                    {text}
                  </p>
                )
              }
              return null
            })}
          </div>
        ) : (
          <>
            {parts?.map((part, i) => {
              if (part.type === "text") {
                const text = String(part.text || "")
                if (!text) return null
                return (
                  <div key={i} className="rounded-2xl rounded-tl-sm bg-secondary/50 px-4 py-2.5">
                    <MarkdownRenderer content={text} />
                  </div>
                )
              }

              const toolInfo = getToolOutput(part)
              if (toolInfo) {
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {toolInfo.state === "output-available" ? (
                      <ToolResultCard
                        result={toolInfo.output}
                        preliminary={toolInfo.preliminary}
                        runtimeConfig={runtimeConfig}
                      />
                    ) : toolInfo.state === "output-error" ? (
                      <ToolResultCard
                        result={{
                          kind: "tool_error",
                          summary: `Tool failed: ${toolInfo.toolName}`,
                          error: toolInfo.errorText || "Tool execution failed.",
                          toolName: toolInfo.toolName,
                        }}
                        runtimeConfig={runtimeConfig}
                      />
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>{getToolLabel(toolInfo.toolName)}</span>
                      </div>
                    )}
                  </motion.div>
                )
              }

              const modeSwitchRequest = getModeSwitchData(part)
              if (modeSwitchRequest && onConfirmModeSwitch) {
                const requestKey =
                  `${modeSwitchRequest.requestedMode}:${modeSwitchRequest.originalRequest}`

                return (
                  <ModeSwitchCard
                    key={i}
                    request={modeSwitchRequest}
                    onConfirm={onConfirmModeSwitch}
                    isPending={pendingModeSwitchKey === requestKey}
                  />
                )
              }

              return null
            })}

            {isStreaming && !hasContent && <ThinkingIndicator />}

            {!isStreaming && hasContent && (
              <MessageActions content={getTextContent(parts)} />
            )}

            {showTracePanel && (
              <ChatDebugPanel entries={traceEntries} isStreaming={Boolean(isStreaming)} />
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}
