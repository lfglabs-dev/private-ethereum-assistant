"use client";

import type { UIMessage } from "ai";

type Part = { type: string; [key: string]: unknown };

function ToolResult({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") return null;

  const data = result as Record<string, unknown>;

  // Balance result
  if ("balance" in data && "token" in data) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm">
        <div className="text-zinc-400">Balance</div>
        <div className="text-lg font-semibold text-white">
          {String(data.balance)} {String(data.token)}
        </div>
        {"address" in data && (
          <div className="mt-1 truncate text-xs text-zinc-500">
            {String(data.address)}
          </div>
        )}
      </div>
    );
  }

  // Transaction proposal
  if ("safeUrl" in data && "transaction" in data) {
    const tx = data.transaction as Record<string, string>;
    return (
      <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
        <div className="mb-2 font-semibold text-amber-400">
          Transaction Prepared
        </div>
        <div className="space-y-1 text-zinc-300">
          <div>
            <span className="text-zinc-500">To:</span>{" "}
            <span className="font-mono text-xs">{tx.to}</span>
          </div>
          <div>
            <span className="text-zinc-500">Value:</span> {tx.value}
          </div>
          {tx.data && tx.data !== "0x (simple transfer)" && (
            <div>
              <span className="text-zinc-500">Data:</span>{" "}
              <span className="font-mono text-xs">{tx.data}</span>
            </div>
          )}
        </div>
        <a
          href={String(data.safeUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500"
        >
          Open Safe to Approve
        </a>
      </div>
    );
  }

  // Safe info
  if ("owners" in data && "threshold" in data) {
    const owners = data.owners as string[];
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm">
        <div className="mb-2 font-semibold text-white">Safe Info</div>
        <div className="space-y-1 text-zinc-300">
          <div>
            <span className="text-zinc-500">Address:</span>{" "}
            <span className="font-mono text-xs">{String(data.address)}</span>
          </div>
          <div>
            <span className="text-zinc-500">Balance:</span>{" "}
            {String(data.balance)}
          </div>
          <div>
            <span className="text-zinc-500">Threshold:</span>{" "}
            {String(data.threshold)} of {owners.length}
          </div>
          <div>
            <span className="text-zinc-500">Owners:</span>
            <ul className="mt-1 space-y-0.5">
              {owners.map((owner) => (
                <li key={owner} className="font-mono text-xs text-zinc-400">
                  {owner}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Pending transactions
  if ("transactions" in data) {
    const txs = data.transactions as Array<Record<string, string | number>>;
    if (txs.length === 0) {
      return (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm text-zinc-400">
          No pending transactions.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {txs.map((tx) => (
          <div
            key={String(tx.safeTxHash)}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Pending Tx</span>
              <span className="text-xs text-zinc-500">
                {String(tx.confirmations)}/{String(tx.confirmationsRequired)}{" "}
                sigs
              </span>
            </div>
            <div className="mt-1 text-zinc-300">
              <span className="text-zinc-500">To:</span>{" "}
              <span className="font-mono text-xs">{String(tx.to)}</span>
            </div>
            <div className="text-zinc-300">
              <span className="text-zinc-500">Value:</span> {String(tx.value)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ENS resolution
  if ("name" in data && "address" in data) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm">
        <div className="text-zinc-400">{String(data.name)}</div>
        <div className="font-mono text-sm text-white">
          {data.address ? String(data.address) : "Not found"}
        </div>
      </div>
    );
  }

  // Transaction lookup
  if ("hash" in data && "from" in data && "status" in data) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold text-white">Transaction</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              data.status === "Success"
                ? "bg-green-900/50 text-green-400"
                : "bg-red-900/50 text-red-400"
            }`}
          >
            {String(data.status)}
          </span>
        </div>
        <div className="space-y-1 text-zinc-300">
          <div>
            <span className="text-zinc-500">From:</span>{" "}
            <span className="font-mono text-xs">{String(data.from)}</span>
          </div>
          <div>
            <span className="text-zinc-500">To:</span>{" "}
            <span className="font-mono text-xs">{String(data.to)}</span>
          </div>
          <div>
            <span className="text-zinc-500">Value:</span>{" "}
            {String(data.value)} ETH
          </div>
          <div>
            <span className="text-zinc-500">Block:</span>{" "}
            {String(data.blockNumber)}
          </div>
        </div>
      </div>
    );
  }

  // Fallback: show as JSON
  return (
    <pre className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-xs text-zinc-300 overflow-x-auto">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function getToolOutput(part: Part): { state: string; output?: unknown; toolName: string } | null {
  if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") return null;
  const toolName = part.type === "dynamic-tool"
    ? String(part.toolName || "unknown")
    : part.type.replace("tool-", "");
  return {
    state: String(part.state || ""),
    output: part.output,
    toolName,
  };
}

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-100"
        }`}
      >
        {(message.parts as Part[])?.map((part, i) => {
          if (part.type === "text") {
            const text = String(part.text || "");
            if (!text) return null;
            return (
              <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                {text}
              </p>
            );
          }

          const toolInfo = getToolOutput(part);
          if (toolInfo) {
            return (
              <div key={i} className="mt-2">
                {toolInfo.state === "output" ? (
                  <ToolResult result={toolInfo.output} />
                ) : toolInfo.state === "input-streaming" || toolInfo.state === "input-available" ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-300" />
                    Calling {toolInfo.toolName}...
                  </div>
                ) : null}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
