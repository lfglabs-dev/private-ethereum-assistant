"use client";

import { useChat } from "@ai-sdk/react";
import { ChatMessage } from "@/components/chat-message";
import { useEffect, useRef, useState } from "react";

export default function Home() {
  const { messages, sendMessage, stop, status, error, clearError } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, error]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    clearError();
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            Private Ethereum Assistant
          </h1>
          <p className="text-xs text-zinc-400">
            Local LLM · Base Network · Safe Transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-xs text-zinc-400">Local</span>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center pt-32 text-center">
              <div className="mb-4 text-4xl">🔒</div>
              <h2 className="text-xl font-semibold text-white">
                Private Ethereum Assistant
              </h2>
              <p className="mt-2 max-w-md text-sm text-zinc-400">
                Ask me about Ethereum balances, transactions, or propose Safe
                transactions. Everything runs locally — your data never leaves
                this machine.
              </p>
              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  "What's the ETH balance of our Safe?",
                  "Show pending transactions",
                  "Resolve vitalik.eth",
                  "Get Safe info",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="rounded-lg border border-zinc-800 px-4 py-2 text-left text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {error && (
            <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              <p className="font-medium">Connection Error</p>
              <p className="mt-1 text-red-500/80">
                {error.message.includes("fetch")
                  ? "Could not connect to the LLM. Is Ollama running? Try: ollama serve"
                  : error.message || "An unexpected error occurred."}
              </p>
              <button
                onClick={clearError}
                className="mt-2 text-xs text-red-400 underline hover:text-red-300"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-4 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-center gap-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Ethereum..."
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-zinc-500"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-xl bg-red-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
