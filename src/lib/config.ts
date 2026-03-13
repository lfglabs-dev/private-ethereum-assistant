function getNumberEnv(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  llm: {
    baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    model: process.env.LLM_MODEL || "qwen3:8b",
    timeoutMs: getNumberEnv("LLM_TIMEOUT_MS", 180000),
  },
  ethereum: {
    safeAddress: process.env.SAFE_ADDRESS || "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
    rpcUrl: process.env.RPC_URL || "https://mainnet.base.org",
    chainId: Number(process.env.CHAIN_ID || "8453"),
  },
  railgun: {
    networkLabel: "Arbitrum",
    rpcUrl: process.env.RAILGUN_RPC_URL || "https://arb1.arbitrum.io/rpc",
    chainId: Number(process.env.RAILGUN_CHAIN_ID || "42161"),
    explorerTxBaseUrl: process.env.RAILGUN_EXPLORER_TX_URL || "https://arbiscan.io/tx/",
    privacyGuidanceText:
      process.env.RAILGUN_PRIVACY_GUIDANCE_TEXT ||
      "Shielding is a public deposit on Arbitrum, but once confirmed the resulting private balance can fund later Railgun actions without publicly linking future transfers to the deposit address.",
    poiNodeUrls: (process.env.RAILGUN_POI_NODE_URLS || "https://ppoi-agg.horsewithsixlegs.xyz")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean),
    mnemonic: process.env.RAILGUN_MNEMONIC,
    signerPrivateKey: process.env.EOA_PRIVATE_KEY,
    walletCreationBlock: Number(process.env.RAILGUN_WALLET_CREATION_BLOCK || "56109834"),
    scanTimeoutMs: Number(process.env.RAILGUN_SCAN_TIMEOUT_MS || "180000"),
    pollingIntervalMs: Number(process.env.RAILGUN_POLLING_INTERVAL_MS || "15000"),
  },
} as const;
