"use client";

import { useState } from "react";
import { EthereumIcon } from "@/components/icons/ethereum-icon";

function getTokenAvatarStyles(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }

  return {
    backgroundColor: `hsl(${hash} 72% 92%)`,
    color: `hsl(${hash} 55% 28%)`,
  };
}

export function TokenAvatar({
  symbol,
  address,
  iconUrl,
  isNative = false,
}: {
  symbol: string;
  address: string;
  iconUrl?: string;
  isNative?: boolean;
}) {
  const [showFallback, setShowFallback] = useState(false);
  const initials = symbol.slice(0, 2).toUpperCase() || "??";

  if (isNative && symbol.toUpperCase() === "ETH") {
    return (
      <div className="flex size-10 items-center justify-center rounded-full border border-border/60 bg-background text-sky-500">
        <EthereumIcon aria-label={`${symbol} native token icon`} className="size-5" />
      </div>
    );
  }

  if (iconUrl && !showFallback) {
    return (
      <div className="size-10 overflow-hidden rounded-full border border-border/60 bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconUrl}
          alt={`${symbol} token icon`}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setShowFallback(true)}
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${symbol} fallback icon`}
      className="flex size-10 items-center justify-center rounded-full border border-border/60 text-[11px] font-semibold uppercase"
      style={getTokenAvatarStyles(address || symbol)}
    >
      {initials}
    </div>
  );
}
