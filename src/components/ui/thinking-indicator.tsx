import { cn } from "@/lib/utils"

interface ThinkingIndicatorProps {
  label?: string
  className?: string
}

export function ThinkingIndicator({
  label = "Thinking",
  className,
}: ThinkingIndicatorProps) {
  return (
    <div
      data-testid="thinking-indicator"
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
    >
      <div className="flex items-center gap-1" aria-label={label}>
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
      </div>
      <span>{label}</span>
    </div>
  )
}
