import { beforeEach, describe, expect, test } from "bun:test";
import {
  consumeTransferRateLimitSlot,
  evaluateSessionTransferApproval,
  recordConfirmedSessionTransfer,
  resetEoaSessionGuardState,
} from "./eoa-session-guard";

describe("EOA session guard", () => {
  beforeEach(() => {
    resetEoaSessionGuardState();
  });

  test("requires approval when cumulative session spend crosses the threshold", () => {
    recordConfirmedSessionTransfer({
      sender: "0xabc",
      chainId: 42161,
      assetKey: "native",
      amountBaseUnits: 200n,
    });

    const decision = evaluateSessionTransferApproval({
      sender: "0xabc",
      chainId: 42161,
      assetKey: "native",
      amountBaseUnits: 150n,
      thresholdBaseUnits: 300n,
      thresholdAmount: "0.3",
      thresholdAssetSymbol: "ETH",
      formatAmount: (amountBaseUnits) => `${amountBaseUnits} ETH`,
    });

    expect(decision).toEqual({
      required: true,
      reason: "session_cumulative_threshold",
      cumulativeAmount: "350 ETH",
      thresholdAmount: "0.3",
      thresholdAssetSymbol: "ETH",
    });
  });

  test("rate-limits rapid consecutive sends", () => {
    const firstAttempt = consumeTransferRateLimitSlot({
      sender: "0xabc",
      chainId: 42161,
      now: 1_000,
      minimumIntervalMs: 30_000,
    });
    const secondAttempt = consumeTransferRateLimitSlot({
      sender: "0xabc",
      chainId: 42161,
      now: 10_000,
      minimumIntervalMs: 30_000,
    });

    expect(firstAttempt).toEqual({ allowed: true });
    expect(secondAttempt).toEqual({
      allowed: false,
      retryAfterMs: 21_000,
    });
  });
});
