export const config = {
  llm: {
    baseURL: process.env.LLM_BASE_URL || "http://localhost:11434/v1",
    model: process.env.LLM_MODEL || "qwen3:8b",
  },
  ethereum: {
    safeAddress: process.env.SAFE_ADDRESS || "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
    rpcUrl: process.env.RPC_URL || "https://mainnet.base.org",
    chainId: Number(process.env.CHAIN_ID || "8453"),
  },
} as const;
