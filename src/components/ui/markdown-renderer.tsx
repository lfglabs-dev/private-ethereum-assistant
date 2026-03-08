"use client"

import ReactMarkdown from "react-markdown"
import { cn } from "@/lib/utils"

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div
      className={cn(
        "prose prose-sm prose-invert max-w-none break-words",
        "prose-p:leading-relaxed prose-p:my-1",
        "prose-pre:bg-secondary prose-pre:rounded-lg prose-pre:p-3",
        "prose-code:bg-secondary prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none",
        "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
        "prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
        "prose-headings:mb-2 prose-headings:mt-3",
        className,
      )}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
