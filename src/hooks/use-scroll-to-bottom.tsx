"use client"

import { useStickToBottom } from "use-stick-to-bottom"

export function useScrollToBottom() {
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom()

  return {
    containerRef: scrollRef,
    endRef: contentRef,
    isAtBottom,
    scrollToBottom,
  }
}
