"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { shortenAddress } from "@/lib/format";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function PortfolioHeader({
  totalUsdValue,
  walletAddress,
  ensName,
}: {
  totalUsdValue: number;
  walletAddress: string;
  ensName: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="flex flex-col items-center gap-3 border-b px-4 pb-4 pt-5">
      <span className="text-2xl font-bold text-foreground">
        {usdFormatter.format(totalUsdValue)}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/80"
        title={walletAddress}
      >
        <span>{ensName || shortenAddress(walletAddress)}</span>
        {copied ? (
          <Check className="size-3 text-green-500" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    </div>
  );
}
