"use client"

import { AlertCircle, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface ChatErrorProps {
  error: Error
  onDismiss: () => void
}

export function ChatError({ error, onDismiss }: ChatErrorProps) {
  const isFetchError = error.message.includes("fetch")
  const isTimeout = error.name === "TimeoutError" || error.message.includes("timed out") || error.message.includes("timeout")
  const timeoutDetail = error.message.trim()
  return (
    <div
      data-testid="chat-error"
      className="mx-auto max-w-3xl rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-destructive">{isTimeout ? "Request Timed Out" : "Connection Error"}</p>
          {isTimeout ? (
            <>
              <p className="mt-1 text-destructive/80">
                The LLM did not respond before the configured timeout. It may be overloaded or unresponsive.
              </p>
              {timeoutDetail ? (
                <p className="mt-2 font-mono text-xs text-destructive/70">
                  {timeoutDetail}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-destructive/80">
              {isFetchError
                ? "Could not connect to the LLM. Is Ollama running? Try: ollama serve"
                : error.message || "An unexpected error occurred."}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onDismiss}
          className="shrink-0 text-destructive/60 hover:text-destructive"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
