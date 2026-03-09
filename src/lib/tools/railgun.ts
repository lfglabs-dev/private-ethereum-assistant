import { tool } from "ai";
import { z } from "zod";
import {
  railgunBalance,
  railgunShield,
  railgunTransfer,
  railgunUnshield,
} from "@/lib/railgun";

export const getRailgunBalance = tool({
  description:
    "Check shielded Railgun balances on Arbitrum. If a token is provided, use ETH, USDC, or an explicit Arbitrum token contract address.",
  inputSchema: z.object({
    token: z
      .string()
      .optional()
      .describe(
        "Optional token selector. Supported shortcuts: ETH, USDC, or a 0x Arbitrum token address.",
      ),
  }),
  execute: async ({ token }) => railgunBalance(token),
});

export const railgunShieldTokens = tool({
  description:
    "Shield tokens into Railgun on Arbitrum. Use ETH, USDC, or an explicit Arbitrum token contract address. Explain the privacy tradeoff before calling this tool.",
  inputSchema: z.object({
    token: z
      .string()
      .describe("ETH, USDC, or an Arbitrum token contract address."),
    amount: z.string().describe("Human-readable token amount, like '0.1' or '25'."),
  }),
  execute: async ({ token, amount }) => railgunShield(token, amount),
});

export const railgunPrivateTransfer = tool({
  description:
    "Send a private Railgun transfer on Arbitrum to a Railgun address that starts with 0zk.",
  inputSchema: z.object({
    recipient: z
      .string()
      .describe("Recipient Railgun address. It must start with 0zk."),
    token: z
      .string()
      .describe("ETH, USDC, or an Arbitrum token contract address."),
    amount: z.string().describe("Human-readable token amount, like '0.1' or '25'."),
  }),
  execute: async ({ recipient, token, amount }) =>
    railgunTransfer(recipient, token, amount),
});

export const railgunWithdraw = tool({
  description:
    "Unshield tokens from Railgun to a public 0x address on Arbitrum.",
  inputSchema: z.object({
    recipient: z
      .string()
      .describe("Recipient public wallet address on Arbitrum (0x...)."),
    token: z
      .string()
      .describe("ETH, USDC, or an Arbitrum token contract address."),
    amount: z.string().describe("Human-readable token amount, like '0.1' or '25'."),
  }),
  execute: async ({ recipient, token, amount }) =>
    railgunUnshield(recipient, token, amount),
});
