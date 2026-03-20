"use client";

import { TokenAvatar } from "@/components/ui/token-avatar";
import type { PortfolioToken } from "@/lib/portfolio/portfolio-service";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function TokenRow({ token }: { token: PortfolioToken }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="shrink-0 [&>div]:size-8">
        <TokenAvatar
          symbol={token.symbol}
          address={token.address}
          iconUrl={token.iconUrl}
          isNative={token.isNative}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {token.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {token.formattedBalance} {token.symbol}
        </span>
      </div>
      <div className="shrink-0 text-right">
        <span className="text-sm font-medium text-foreground">
          {token.usdValue !== null ? usdFormatter.format(token.usdValue) : "--"}
        </span>
      </div>
    </div>
  );
}
