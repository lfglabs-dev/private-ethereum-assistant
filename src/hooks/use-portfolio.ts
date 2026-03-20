"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type { RuntimeConfig } from "@/lib/runtime-config";
import type { PortfolioData } from "@/lib/portfolio/portfolio-service";

const POLL_INTERVAL_MS = 60_000;

/** Derive a stable key that changes when the wallet address or chain would change. */
function getConfigKey(rc: RuntimeConfig | null): string {
  if (!rc) return "";
  const mode = rc.actor.type;
  const chain = rc.network.chainId;
  const safeAddr = rc.safe?.address ?? "";
  const hasEoaKey = rc.wallet?.eoaPrivateKey?.trim() ? "1" : "0";
  return `${mode}:${chain}:${safeAddr}:${hasEoaKey}`;
}

export function usePortfolio(runtimeConfig: RuntimeConfig | null) {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const configRef = useRef(runtimeConfig);
  const prevConfigKeyRef = useRef<string>("");

  // Always keep the ref up to date
  configRef.current = runtimeConfig;

  const configKey = getConfigKey(runtimeConfig);

  // When the config key changes (mode switch, network change), clear stale data
  // so the skeleton shows immediately.
  if (configKey !== prevConfigKeyRef.current) {
    prevConfigKeyRef.current = configKey;
    setPortfolio(null);
    setIsLoading(true);
    setError(null);
  }

  const fetchPortfolio = useCallback(async () => {
    const currentConfig = configRef.current;
    if (!currentConfig) {
      setPortfolio(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtimeConfig: currentConfig }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.error === "no_wallet") {
        setPortfolio(null);
        setError(null);
        return;
      }

      setPortfolio(data as PortfolioData);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to fetch portfolio");
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [configKey]);

  useEffect(() => {
    void fetchPortfolio();
    const intervalId = window.setInterval(() => {
      void fetchPortfolio();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      abortRef.current?.abort();
    };
  }, [fetchPortfolio]);

  return {
    portfolio,
    isLoading,
    error,
    refresh: fetchPortfolio,
  };
}
