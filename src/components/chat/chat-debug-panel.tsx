"use client"

import { ScrollText } from "lucide-react"
import type { DebugLogEntry } from "@/lib/chat-stream"

interface ChatDebugPanelProps {
  entries: DebugLogEntry[]
  isStreaming: boolean
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)
}

function getLevelClass(level: DebugLogEntry["level"]) {
  switch (level) {
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive"
    case "warn":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700"
    default:
      return "border-primary/20 bg-primary/10 text-primary"
  }
}

export function ChatDebugPanel({ entries, isStreaming }: ChatDebugPanelProps) {
  return (
    <div
      data-testid="chat-debug-panel"
      className="rounded-2xl border border-border/60 bg-card/70 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <ScrollText className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Model Trace</p>
            <p className="text-xs text-muted-foreground">
              Live backend events from the current request
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {isStreaming ? "Streaming" : "Idle"}
        </span>
      </div>

      <div className="max-h-40 space-y-2 overflow-y-auto px-4 py-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No live model events yet.
          </p>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className="rounded-xl border border-border/50 bg-background/70 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatTime(entry.timestamp)}</span>
                <span
                  className={`rounded-full border px-1.5 py-0.5 font-medium ${getLevelClass(entry.level)}`}
                >
                  {entry.stage}
                </span>
              </div>
              <p className="mt-1 text-sm">{entry.message}</p>
              {entry.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.detail}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
