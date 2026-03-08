"use client"

import { useChat } from "@ai-sdk/react"
import { useEffect, useRef, useState } from "react"
import { Bot } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ChatMessage } from "@/components/chat/chat-message"
import { ChatWelcome } from "@/components/chat/chat-welcome"
import { ChatInput } from "@/components/chat/chat-input"
import { ChatError } from "@/components/chat/chat-error"

export default function Home() {
  const { messages, sendMessage, stop, status, error, clearError } = useChat()
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const isLoading = status === "submitted" || status === "streaming"
  const isSubmitted = status === "submitted"

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, error, status])

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return
    clearError()
    sendMessage({ text: input })
    setInput("")
  }

  const handleSuggestion = (suggestion: string) => {
    clearError()
    sendMessage({ text: suggestion })
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="size-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">Private Ethereum Assistant</h1>
            <p className="text-xs text-muted-foreground">
              Local LLM &middot; Base Network &middot; Safe
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-green-500" />
          <span className="text-xs text-muted-foreground">Local</span>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
          {messages.length === 0 && !error && (
            <ChatWelcome onSuggestionClick={handleSuggestion} />
          )}

          {messages.map((message, index) => (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isLoading && index === messages.length - 1 && message.role === "assistant"}
            />
          ))}

          {/* Thinking state - shows when submitted but no assistant message yet */}
          {isSubmitted && (messages.length === 0 || messages[messages.length - 1].role === "user") && (
            <div className="flex gap-3">
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarFallback className="bg-secondary">
                  <Bot className="size-3.5" />
                </AvatarFallback>
              </Avatar>
              <div className="rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3">
                <ThinkingIndicator />
              </div>
            </div>
          )}

          {error && <ChatError error={error} onDismiss={clearError} />}
        </div>
      </div>

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={stop}
        isLoading={isLoading}
      />
    </div>
  )
}
