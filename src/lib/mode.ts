import type { ActiveActor } from "./runtime-config";

export type ExecutionMode = ActiveActor;

export type ModeSwitchRequiredResult = {
  kind: "mode_switch_required";
  currentMode: ExecutionMode;
  requestedMode: ExecutionMode;
  summary: string;
  message: string;
  reason: string;
  originalRequest: string;
};

export const EXECUTION_MODE_OPTIONS = [
  {
    value: "eoa",
    label: "EOA",
    description: "Use the configured EOA for direct sends and public swaps.",
  },
  {
    value: "safe",
    label: "Safe",
    description: "Use the configured Safe for multisig proposals and Safe swaps.",
  },
  {
    value: "railgun",
    label: "Private",
    description: "Use Railgun for private balance, shield, transfer, and unshield flows.",
  },
] as const satisfies ReadonlyArray<{
  value: ExecutionMode;
  label: string;
  description: string;
}>;

const MODE_LABELS: Record<ExecutionMode, string> = {
  eoa: "EOA",
  safe: "Safe",
  railgun: "Private",
};

const MODE_REASON_LABELS: Record<ExecutionMode, string> = {
  eoa: "your configured EOA",
  safe: "your configured Safe",
  railgun: "your private Railgun wallet",
};

export function getModeLabel(mode: ExecutionMode) {
  return MODE_LABELS[mode];
}

function isExecutionRequest(messageText: string) {
  return /\b(send|transfer|swap|trade|shield|unshield|withdraw|propose|pending|balance|info)\b/i.test(
    messageText,
  );
}

function inferRequestedMode(
  messageText: string,
  currentMode: ExecutionMode,
): ExecutionMode | null {
  const normalized = messageText.trim().toLowerCase();
  if (!normalized || !isExecutionRequest(normalized)) {
    return null;
  }

  const isPrivateRequest =
    /\brailgun\b/.test(normalized) ||
    /\bprivate balance\b/.test(normalized) ||
    /\bfrom my private\b/.test(normalized) ||
    /\bshield\b/.test(normalized) ||
    /\bunshield\b/.test(normalized) ||
    /\b0zk[a-z0-9]+\b/.test(normalized);
  if (isPrivateRequest) {
    return "railgun";
  }

  const isSafeRequest =
    /\bfrom my safe\b/.test(normalized) ||
    /\busing my safe\b/.test(normalized) ||
    /\bshow safe\b/.test(normalized) ||
    /\bsafe wallet\b/.test(normalized) ||
    /\bsafe transaction\b/.test(normalized) ||
    /\bpending safe\b/.test(normalized) ||
    /\bmultisig\b/.test(normalized) ||
    /\bpropose\b/.test(normalized);
  if (isSafeRequest) {
    return "safe";
  }

  const isEoaRequest =
    /\bfrom my eoa\b/.test(normalized) ||
    /\busing my eoa\b/.test(normalized) ||
    /\bmy eoa\b/.test(normalized) ||
    /\beoa mode\b/.test(normalized);
  if (isEoaRequest) {
    return "eoa";
  }

  const isSwapRequest = /\b(swap|trade)\b/.test(normalized);
  if (isSwapRequest && currentMode === "railgun") {
    return "eoa";
  }

  return null;
}

export function detectModeSwitchRequired(
  messageText: string,
  currentMode: ExecutionMode,
): ModeSwitchRequiredResult | null {
  const requestedMode = inferRequestedMode(messageText, currentMode);
  if (!requestedMode || requestedMode === currentMode) {
    return null;
  }

  const requestedModeLabel = getModeLabel(requestedMode);
  const currentModeLabel = getModeLabel(currentMode);

  return {
    kind: "mode_switch_required",
    currentMode,
    requestedMode,
    originalRequest: messageText,
    reason: `This request targets ${MODE_REASON_LABELS[requestedMode]}.`,
    summary: `Switch to ${requestedModeLabel} mode to continue`,
    message:
      requestedMode === "railgun"
        ? "This request needs Private mode. Confirm the mode change and I'll replay it with the Railgun toolset."
        : `This request needs ${requestedModeLabel} mode. Confirm the mode change and I'll replay it with the ${requestedModeLabel} toolset.`,
  };
}

export function getExecutionModeOptions() {
  return EXECUTION_MODE_OPTIONS;
}
