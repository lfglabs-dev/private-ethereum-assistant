"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export type SelectOption = {
  value: string
  label: string
}

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  "data-testid"?: string
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className,
  "data-testid": dataTestId,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)
  const triggerId = useId()
  const listboxId = useId()

  const selectedOption = options.find((opt) => opt.value === value)
  const displayLabel = selectedOption?.label ?? placeholder

  // Close on click outside
  useEffect(() => {
    if (!open) return

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", handleEscape)
    return () => document.removeEventListener("keydown", handleEscape)
  }, [open])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightedIndex < 0) return
    const listbox = listboxRef.current
    if (!listbox) return
    const items = listbox.querySelectorAll("[role='option']")
    const item = items[highlightedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: "nearest" })
  }, [highlightedIndex, open])

  const selectValue = useCallback(
    (optionValue: string) => {
      onChange(optionValue)
      setOpen(false)
    },
    [onChange],
  )

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Enter":
      case " ": {
        event.preventDefault()
        if (!open) {
          setOpen(true)
          const currentIndex = options.findIndex((opt) => opt.value === value)
          setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0)
        }
        break
      }
    }
  }

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault()
        setHighlightedIndex((prev) =>
          prev < options.length - 1 ? prev + 1 : 0,
        )
        break
      }
      case "ArrowUp": {
        event.preventDefault()
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : options.length - 1,
        )
        break
      }
      case "Home": {
        event.preventDefault()
        setHighlightedIndex(0)
        break
      }
      case "End": {
        event.preventDefault()
        setHighlightedIndex(options.length - 1)
        break
      }
      case "Enter":
      case " ": {
        event.preventDefault()
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          selectValue(options[highlightedIndex].value)
        }
        break
      }
      case "Tab": {
        setOpen(false)
        break
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        data-testid={dataTestId}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors",
          "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
        onClick={() => {
          setOpen((prev) => !prev)
          if (!open) {
            const currentIndex = options.findIndex((opt) => opt.value === value)
            setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0)
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={cn(
            "ml-2 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          aria-labelledby={triggerId}
          tabIndex={-1}
          className={cn(
            "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-background p-1 shadow-lg",
            "animate-in fade-in-0 zoom-in-95 duration-100",
          )}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isHighlighted = index === highlightedIndex
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                data-highlighted={isHighlighted || undefined}
                className={cn(
                  "flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors",
                  isHighlighted && "bg-muted",
                  isSelected && "font-medium",
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  selectValue(option.value)
                }}
              >
                {option.label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
