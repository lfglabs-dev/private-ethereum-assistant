function getNumberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTokenAmountEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ? value : fallback;
}

export const config = {
  llm: {
    baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    model: process.env.LLM_MODEL || "llama3.2:3b",
    timeoutMs: getNumberEnv("LLM_TIMEOUT_MS", 180000),
  },
  ethereum: {
    safeAddress: process.env.SAFE_ADDRESS || "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
    rpcUrl: process.env.RPC_URL || "https://mainnet.base.org",
    chainId: Number(process.env.CHAIN_ID || "8453"),
    localApprovalNativeThreshold: getTokenAmountEnv(
      "EOA_LOCAL_APPROVAL_NATIVE_THRESHOLD",
      "0.5",
    ),
    localApprovalErc20Threshold: getTokenAmountEnv(
      "EOA_LOCAL_APPROVAL_ERC20_THRESHOLD",
      "1000",
    ),
  },
  railgun: {
    networkLabel: "Arbitrum",
    rpcUrl: process.env.RAILGUN_RPC_URL || "https://arb1.arbitrum.io/rpc",
    chainId: Number(process.env.RAILGUN_CHAIN_ID || "42161"),
    explorerTxBaseUrl: process.env.RAILGUN_EXPLORER_TX_URL || "https://arbiscan.io/tx/",
    privacyGuidanceText:
      process.env.RAILGUN_PRIVACY_GUIDANCE_TEXT ||
      "Shielding is a public deposit on Arbitrum, but once confirmed the resulting private balance can fund later Railgun actions without publicly linking future transfers to the deposit address.",
    mnemonic: "",
    shieldApprovalThreshold: getTokenAmountEnv(
      "RAILGUN_SHIELD_APPROVAL_THRESHOLD",
      "1",
    ),
    transferApprovalThreshold: getTokenAmountEnv(
      "RAILGUN_TRANSFER_APPROVAL_THRESHOLD",
      "1",
    ),
    unshieldApprovalThreshold: getTokenAmountEnv(
      "RAILGUN_UNSHIELD_APPROVAL_THRESHOLD",
      "1",
    ),
  },
} as const;
