"use client";

import { Settings2, ShieldCheck, Loader2 } from "lucide-react";
import { EthereumIcon } from "@/components/icons/ethereum-icon";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { RuntimeConfig } from "@/lib/runtime-config";
import type { ExecutionMode } from "@/lib/mode";
import { usePortfolio } from "@/hooks/use-portfolio";
import { PortfolioHeader } from "./portfolio-header";
import { TokenList } from "./token-list";

function SidebarSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 pt-5 animate-pulse">
      <div className="h-8 w-24 rounded bg-secondary" />
      <div className="h-7 w-32 rounded-full bg-secondary" />
      <div className="mt-4 w-full space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-0 py-1">
            <div className="size-8 rounded-full bg-secondary" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-20 rounded bg-secondary" />
              <div className="h-3 w-14 rounded bg-secondary" />
            </div>
            <div className="h-3.5 w-12 rounded bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RailgunScanningMessage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
        <ShieldCheck className="size-5 text-primary" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Scanning private balances</p>
        <p className="text-xs text-muted-foreground">
          Syncing Railgun wallet — this may take a minute on first load
        </p>
      </div>
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  );
}

function NoWalletMessage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-foreground">No wallet configured</p>
      <p className="text-xs text-muted-foreground">
        Open Settings to add your wallet key
      </p>
    </div>
  );
}

export function WalletSidebar({
  runtimeConfig,
  providerLabel,
  networkLabel,
  modeLabel,
  executionModeOptions,
  onModeChange,
  onOpenSettings,
}: {
  runtimeConfig: RuntimeConfig;
  providerLabel: string;
  networkLabel: string;
  modeLabel: string;
  executionModeOptions: ReadonlyArray<{ readonly value: ExecutionMode; readonly label: string; readonly description: string }>;
  onModeChange: (mode: ExecutionMode) => void;
  onOpenSettings?: () => void;
}) {
  const { portfolio, isLoading, error } = usePortfolio(runtimeConfig);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-card lg:flex">
      {/* Branding */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
          <EthereumIcon className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-sm font-semibold">
            Private Ethereum Assistant
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {providerLabel} · {networkLabel}
          </p>
        </div>
      </div>

      {/* Mode picker */}
      <div className="border-b px-4 py-3">
        <div
          data-testid="runtime-mode-picker"
          className="flex items-center gap-1 rounded-full border p-1 text-xs"
          aria-label="Execution mode"
        >
          {executionModeOptions.map((modeOption) => {
            const isActive = runtimeConfig.actor.type === modeOption.value;
            return (
              <button
                key={modeOption.value}
                type="button"
                data-testid={`runtime-mode-picker-${modeOption.value}`}
                className={`flex-1 rounded-full px-2 py-1 text-center transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
                onClick={() => onModeChange(modeOption.value)}
              >
                {modeOption.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Portfolio content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {isLoading && !portfolio && runtimeConfig.actor.type === "railgun" ? (
          <RailgunScanningMessage />
        ) : isLoading && !portfolio ? (
          <SidebarSkeleton />
        ) : error && !portfolio ? (
          <NoWalletMessage />
        ) : portfolio ? (
          <>
            <PortfolioHeader
              totalUsdValue={portfolio.totalUsdValue}
              walletAddress={portfolio.walletAddress}
              ensName={portfolio.ensName}
            />
            <TokenList tokens={portfolio.tokens} />
          </>
        ) : (
          <NoWalletMessage />
        )}
      </div>

      {/* Footer: Settings + Theme */}
      <div className="flex items-center justify-between border-t px-4 py-2.5">
        {onOpenSettings ? (
          <Button
            data-testid="runtime-settings-trigger"
            variant="ghost"
            size="sm"
            className="gap-2 text-xs"
            onClick={onOpenSettings}
          >
            <Settings2 className="size-3.5" />
            Settings
          </Button>
        ) : (
          <div />
        )}
        <ThemeToggle />
      </div>
    </aside>
  );
}
