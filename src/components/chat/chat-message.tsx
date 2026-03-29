"use client"

import type { UIMessage } from "ai"
import { motion } from "framer-motion"
import Image from "next/image"
import { Loader2, User } from "lucide-react"
import { EthereumIcon } from "@/components/icons/ethereum-icon"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ToolResultCard } from "@/components/chat/tool-result-card"
import { MessageActions } from "@/components/chat/message-actions"
import { ModeSwitchCard } from "@/components/chat/mode-switch-card"
import type { AssistantUIMessage } from "@/lib/chat-stream"
import type { ModeSwitchRequiredResult } from "@/lib/mode"

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

type ToolLabelInfo = {
  label: string
  icon?: string
}

function getToolLabel(toolName: string): ToolLabelInfo {
  switch (toolName) {
    case "railgun_balance":
      return { label: "Scanning Railgun balances with Kohaku", icon: "/kohaku-fish.webp" }
    case "railgun_shield":
      return { label: "Shielding with Kohaku", icon: "/kohaku-fish.webp" }
    case "railgun_transfer":
      return { label: "Transferring with Kohaku", icon: "/kohaku-fish.webp" }
    case "railgun_unshield":
      return { label: "Unshielding with Kohaku", icon: "/kohaku-fish.webp" }
    case "swap_tokens":
      return { label: "Planning mode-aware CoW swap", icon: "/cowswap-logo.webp" }
    case "prepare_swap":
      return { label: "Preparing EOA CoW swap", icon: "/cowswap-logo.webp" }
    case "execute_swap":
      return { label: "Executing prepared EOA swap", icon: "/cowswap-logo.webp" }
    case "get_safe_info":
      return { label: "Fetching Safe info", icon: "/safe-logo.webp" }
    case "get_pending_transactions":
      return { label: "Loading pending Safe transactions", icon: "/safe-logo.webp" }
    case "propose_transaction":
      return { label: "Proposing Safe transaction", icon: "/safe-logo.webp" }
    default:
      return { label: `Running ${toolName}` }
  }
}

interface ChatMessageProps {
  message: UIMessage | AssistantUIMessage
  isStreaming?: boolean
  onConfirmModeSwitch?: (request: ModeSwitchRequiredResult) => void | Promise<void>
  pendingModeSwitchKey?: string | null
  onSendMessage?: (text: string) => void
}

export function ChatMessage({
  message,
  isStreaming,
  onConfirmModeSwitch,
  pendingModeSwitchKey = null,
  onSendMessage,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const parts = message.parts as Part[] | undefined

  const hasContent = parts?.some(
    (p) =>
      (p.type === "text" && String(p.text || "").trim()) ||
      getToolOutput(p) ||
      getModeSwitchData(p),
  )
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
                      <ToolResultCard result={toolInfo.output} preliminary={toolInfo.preliminary} onSendMessage={onSendMessage} isStreaming={isStreaming} />
                    ) : toolInfo.state === "output-error" ? (
                      <ToolResultCard
                        result={{
                          kind: "tool_error",
                          summary: `Tool failed: ${toolInfo.toolName}`,
                          error: toolInfo.errorText || "Tool execution failed.",
                          toolName: toolInfo.toolName,
                        }}
                      />
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        {(() => {
                          const toolLabel = getToolLabel(toolInfo.toolName)
                          return (
                            <>
                              {toolLabel.icon && (
                                <Image
                                  src={toolLabel.icon}
                                  alt=""
                                  width={20}
                                  height={20}
                                  className="rounded-full"
                                />
                              )}
                              <span>{toolLabel.label}</span>
                            </>
                          )
                        })()}
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
          </>
        )}
      </div>
    </motion.div>
  )
}
