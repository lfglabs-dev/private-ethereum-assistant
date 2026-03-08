"use client"

import { useChat } from "@ai-sdk/react"
import { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowDown, Bot } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { ChatMessage } from "@/components/chat/chat-message"
import { ChatWelcome } from "@/components/chat/chat-welcome"
import { ChatInput } from "@/components/chat/chat-input"
import { ChatError } from "@/components/chat/chat-error"
import { ThemeToggle } from "@/components/theme-toggle"
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom"

export default function Home() {
  const { messages, sendMessage, stop, status, error, clearError } = useChat()
  const [input, setInput] = useState("")
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useScrollToBottom()

  const isLoading = status === "submitted" || status === "streaming"
  const isSubmitted = status === "submitted"

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
            <h1 className="font-serif text-sm font-semibold">Private Ethereum Assistant</h1>
            <p className="text-xs text-muted-foreground">
              Local LLM &middot; Base Network &middot; Safe
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Local</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Messages */}
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
            />
          ))}

          {/* Thinking state - shows when submitted but no assistant message yet */}
          {isSubmitted && (messages.length === 0 || messages[messages.length - 1].role === "user") && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarFallback className="bg-secondary">
                  <Bot className="size-3.5" />
                </AvatarFallback>
              </Avatar>
              <div className="rounded-2xl rounded-tl-sm bg-secondary/30 px-4 py-3">
                <ThinkingIndicator />
              </div>
            </motion.div>
          )}

          {error && <ChatError error={error} onDismiss={clearError} />}
        </div>

        {/* Scroll to bottom button */}
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
