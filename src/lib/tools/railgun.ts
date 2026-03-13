import { tool } from "ai";
import { z } from "zod";
import {
  railgunBalance,
  railgunShield,
  railgunTransfer,
  railgunUnshield,
  type RailgunToolRuntimeConfig,
} from "@/lib/railgun";

export function createRailgunTools(runtimeConfig: RailgunToolRuntimeConfig) {
  const getRailgunBalance = tool({
    description:
      "Check shielded Railgun balances on the configured Railgun network. If a token is provided, use ETH, USDC, or an explicit token contract address.",
    inputSchema: z.object({
      token: z
        .string()
        .optional()
        .describe(
          "Optional token selector. Supported shortcuts: ETH, USDC, or a 0x token address.",
        ),
    }),
    execute: async ({ token }) => railgunBalance(token, runtimeConfig),
  });

  const railgunShieldTokens = tool({
    description:
      "Shield tokens into Railgun on the configured Railgun network. Use ETH, USDC, or an explicit token contract address. Explain the privacy tradeoff before calling this tool. Higher-value actions may return a local approval requirement before anything is signed.",
    inputSchema: z.object({
      token: z
        .string()
        .describe("ETH, USDC, or a token contract address on the configured network."),
      amount: z.string().describe("Human-readable token amount, like '0.1' or '25'."),
    }),
    execute: async ({ token, amount }) =>
      railgunShield(token, amount, runtimeConfig),
  });

  const railgunPrivateTransfer = tool({
    description:
      "Send a private Railgun transfer on the configured Railgun network to a Railgun address that starts with 0zk. Higher-value actions may return a local approval requirement before anything is signed.",
    inputSchema: z.object({
      recipient: z
        .string()
        .describe("Recipient Railgun address. It must start with 0zk."),
      token: z
        .string()
        .describe("ETH, USDC, or a token contract address on the configured network."),
      amount: z.string().describe("Human-readable token amount, like '0.1' or '25'."),
    }),
    execute: async ({ recipient, token, amount }) =>
      railgunTransfer(recipient, token, amount, runtimeConfig),
  });

  const railgunWithdraw = tool({
    description:
      "Unshield tokens from Railgun to a public 0x address on the configured Railgun network. Higher-value actions may return a local approval requirement before anything is signed.",
    inputSchema: z.object({
      recipient: z
        .string()
        .describe("Recipient public wallet address on the configured network (0x...)."),
      token: z
        .string()
        .describe("ETH, USDC, or a token contract address on the configured network."),
      amount: z.string().describe("Human-readable token amount, like '0.1' or '25'."),
    }),
    execute: async ({ recipient, token, amount }) =>
      railgunUnshield(recipient, token, amount, runtimeConfig),
  });

  return {
    getRailgunBalance,
    railgunShieldTokens,
    railgunPrivateTransfer,
    railgunWithdraw,
  };
}
