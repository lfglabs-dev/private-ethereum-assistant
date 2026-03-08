"use client"

import { useRef, useEffect } from "react"
import { ArrowUp, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
}

export function ChatInput({ value, onChange, onSubmit, onStop, isLoading }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !isLoading) {
        onSubmit()
      }
    }
  }

  return (
    <div className="border-t bg-background px-4 py-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end gap-2 rounded-2xl border bg-secondary/30 p-2 transition-colors focus-within:border-ring">
          <Textarea
            ref={textareaRef}
            data-testid="chat-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about Ethereum..."
            className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none outline-none focus-visible:ring-0 focus-visible:border-transparent"
            rows={1}
          />
          {isLoading ? (
            <Button
              data-testid="stop-button"
              type="button"
              size="icon"
              variant="destructive"
              className="size-8 shrink-0 rounded-xl"
              onClick={onStop}
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              data-testid="send-button"
              type="button"
              size="icon"
              className="size-8 shrink-0 rounded-xl"
              disabled={!value.trim()}
              onClick={onSubmit}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Local LLM &middot; Base Network &middot; Your data never leaves this machine
        </p>
      </div>
    </div>
  )
}
