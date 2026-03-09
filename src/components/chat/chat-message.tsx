"use client"

import type { UIMessage } from "ai"
import { motion } from "framer-motion"
import { Loader2, User } from "lucide-react"
import { EthereumIcon } from "@/components/icons/ethereum-icon"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ToolResultCard } from "@/components/chat/tool-result-card"
import { MessageActions } from "@/components/chat/message-actions"

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

function getToolLabel(toolName: string): string {
  switch (toolName) {
    case "railgun_balance":
      return "Scanning Railgun balances on Arbitrum"
    case "railgun_shield":
      return "Preparing Railgun shield on Arbitrum"
    case "railgun_transfer":
      return "Generating Railgun transfer proof"
    case "railgun_unshield":
      return "Generating Railgun unshield proof"
    default:
      return `Running ${toolName}`
  }
}

interface ChatMessageProps {
  message: UIMessage
  isStreaming?: boolean
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user"
  const parts = message.parts as Part[] | undefined

  const hasContent = parts?.some(
    (p) => (p.type === "text" && String(p.text || "").trim()) || getToolOutput(p),
  )

  return (
    <motion.div
      data-testid={`message-${message.role}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`group flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
          {isUser ? <User className="size-3.5" /> : <EthereumIcon className="size-3.5" />}
        </AvatarFallback>
      </Avatar>

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
                      />
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
                        <span>{getToolLabel(toolInfo.toolName)}</span>
                      </div>
                    )}
                  </motion.div>
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
