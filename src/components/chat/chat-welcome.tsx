"use client"

import { motion } from "framer-motion"
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
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10"
      >
        <Shield className="size-7 text-primary" />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="font-serif text-2xl font-semibold tracking-tight"
      >
        Private Ethereum Assistant
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="mt-2 max-w-sm text-sm text-muted-foreground"
      >
        Ask about Ethereum balances, transactions, or propose Safe transactions.
        Everything runs locally.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="mt-8 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {SUGGESTIONS.map((suggestion, i) => (
          <motion.div
            key={suggestion}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.35 + i * 0.05 }}
          >
            <Button
              variant="outline"
              className="h-auto w-full justify-start px-4 py-3 text-left text-sm font-normal text-muted-foreground whitespace-normal hover:bg-accent/50 transition-colors"
              onClick={() => onSuggestionClick(suggestion)}
            >
              {suggestion}
            </Button>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
