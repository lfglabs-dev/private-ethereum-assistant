"use client";

import type { PortfolioToken } from "@/lib/portfolio/portfolio-service";
import { TokenRow } from "./token-row";

export function TokenList({ tokens }: { tokens: PortfolioToken[] }) {
  if (tokens.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-xs text-muted-foreground">No tokens found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {tokens.map((token) => (
        <TokenRow key={`${token.address}-${token.symbol}`} token={token} />
      ))}
    </div>
  );
}
