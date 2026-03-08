"use client"

import type { UIMessage } from "ai"
import { Bot, Loader2, User } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ToolResultCard } from "@/components/chat/tool-result-card"

type Part = { type: string; [key: string]: unknown }

function getToolOutput(part: Part): { state: string; output?: unknown; toolName: string } | null {
  if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return null
  const toolName =
    part.type === "dynamic-tool"
      ? String(part.toolName || "unknown")
      : part.type.replace("tool-", "")
  return {
    state: String(part.state || ""),
    output: part.output,
    toolName,
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
    <div
      data-testid={`message-${message.role}`}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
          {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
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
                  <div key={i}>
                    {toolInfo.state === "output" ? (
                      <ToolResultCard result={toolInfo.output} />
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>
                          Using <span className="font-mono text-xs">{toolInfo.toolName}</span>
                        </span>
                      </div>
                    )}
                  </div>
                )
              }

              return null
            })}

            {isStreaming && !hasContent && <ThinkingIndicator />}
          </>
        )}
      </div>
    </div>
  )
}
