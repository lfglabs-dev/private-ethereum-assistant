export type SessionTransferApprovalReason =
  | "single_transfer_threshold"
  | "session_cumulative_threshold";

type SessionTransferApprovalInput = {
  sender: string;
  chainId: number;
  assetKey: string;
  amountBaseUnits: bigint;
  thresholdBaseUnits: bigint;
  thresholdAmount: string;
  thresholdAssetSymbol: string;
  formatAmount: (amountBaseUnits: bigint) => string;
};

type SessionTransferRecordInput = Pick<
  SessionTransferApprovalInput,
  "sender" | "chainId" | "assetKey" | "amountBaseUnits"
>;

type SessionTransferRateLimitInput = Pick<
  SessionTransferApprovalInput,
  "sender" | "chainId"
> & {
  now?: number;
  minimumIntervalMs?: number;
};

const cumulativeTransferTotals = new Map<string, bigint>();
const lastTransferAttemptAt = new Map<string, number>();

function getCumulativeTransferKey(input: {
  sender: string;
  chainId: number;
  assetKey: string;
}) {
  return `${input.chainId}:${input.sender.toLowerCase()}:${input.assetKey.toLowerCase()}`;
}

function getRateLimitKey(input: { sender: string; chainId: number }) {
  return `${input.chainId}:${input.sender.toLowerCase()}`;
}

export function resetEoaSessionGuardState() {
  cumulativeTransferTotals.clear();
  lastTransferAttemptAt.clear();
}

export function getCumulativeTransferredBaseUnits(input: {
  sender: string;
  chainId: number;
  assetKey: string;
}) {
  return cumulativeTransferTotals.get(getCumulativeTransferKey(input)) ?? 0n;
}

export function evaluateSessionTransferApproval(
  input: SessionTransferApprovalInput,
) {
  const transferredBaseUnits = getCumulativeTransferredBaseUnits(input);
  const projectedTotalBaseUnits = transferredBaseUnits + input.amountBaseUnits;

  if (input.amountBaseUnits > input.thresholdBaseUnits) {
    return {
      required: true as const,
      reason: "single_transfer_threshold" as const,
      cumulativeAmount: input.formatAmount(projectedTotalBaseUnits),
      thresholdAmount: input.thresholdAmount,
      thresholdAssetSymbol: input.thresholdAssetSymbol,
    };
  }

  if (projectedTotalBaseUnits > input.thresholdBaseUnits) {
    return {
      required: true as const,
      reason: "session_cumulative_threshold" as const,
      cumulativeAmount: input.formatAmount(projectedTotalBaseUnits),
      thresholdAmount: input.thresholdAmount,
      thresholdAssetSymbol: input.thresholdAssetSymbol,
    };
  }

  return {
    required: false as const,
    thresholdAmount: input.thresholdAmount,
    thresholdAssetSymbol: input.thresholdAssetSymbol,
  };
}

export function consumeTransferRateLimitSlot({
  sender,
  chainId,
  now = Date.now(),
  minimumIntervalMs = 30_000,
}: SessionTransferRateLimitInput) {
  const rateLimitKey = getRateLimitKey({ sender, chainId });
  const lastAttempt = lastTransferAttemptAt.get(rateLimitKey);

  if (typeof lastAttempt === "number") {
    const retryAfterMs = minimumIntervalMs - (now - lastAttempt);
    if (retryAfterMs > 0) {
      return {
        allowed: false as const,
        retryAfterMs,
      };
    }
  }

  lastTransferAttemptAt.set(rateLimitKey, now);
  return {
    allowed: true as const,
  };
}

export function recordConfirmedSessionTransfer(input: SessionTransferRecordInput) {
  const cumulativeTransferKey = getCumulativeTransferKey(input);
  const currentTotal = cumulativeTransferTotals.get(cumulativeTransferKey) ?? 0n;
  cumulativeTransferTotals.set(
    cumulativeTransferKey,
    currentTotal + input.amountBaseUnits,
  );
}
