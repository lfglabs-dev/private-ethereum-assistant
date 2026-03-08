"use client"

import { Shield } from "lucide-react"
import { Button } from "@/components/ui/button"

const SUGGESTIONS = [
  "What's the ETH balance of our Safe?",
  "Show pending transactions",
  "Resolve vitalik.eth",
  "Get Safe info",
]

interface ChatWelcomeProps {
  onSuggestionClick: (suggestion: string) => void
}

export function ChatWelcome({ onSuggestionClick }: ChatWelcomeProps) {
  return (
    <div
      data-testid="chat-welcome"
      className="flex flex-col items-center justify-center pt-24 text-center"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10">
        <Shield className="size-6 text-primary" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">Private Ethereum Assistant</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Ask about Ethereum balances, transactions, or propose Safe transactions. Everything runs
        locally.
      </p>
      <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            className="h-auto justify-start px-4 py-3 text-left text-sm font-normal text-muted-foreground whitespace-normal"
            onClick={() => onSuggestionClick(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  )
}
