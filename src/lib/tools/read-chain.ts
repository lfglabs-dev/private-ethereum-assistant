import { tool } from "ai";
import { z } from "zod";
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { base, mainnet } from "viem/chains";
import { config } from "../config";
import { createEnsService } from "../ens";

const client = createPublicClient({
  chain: base,
  transport: http(config.ethereum.rpcUrl),
});

export const getBalance = tool({
  description:
    "Get the ETH balance or ERC-20 token balance for an Ethereum address on Base.",
  inputSchema: z.object({
    address: z.string().describe("The Ethereum address (0x...)"),
    tokenAddress: z
      .string()
      .optional()
      .describe(
        "Optional ERC-20 token contract address. If omitted, returns native ETH balance."
      ),
  }),
  execute: async ({ address, tokenAddress }) => {
    const addr = address as `0x${string}`;

    // Treat zero address or empty string as native ETH
    const isErc20 =
      tokenAddress &&
      tokenAddress !== "0x0000000000000000000000000000000000000000";

    if (isErc20) {
      const tokenAddr = tokenAddress as `0x${string}`;
      const [balance, decimals, symbol] = await Promise.all([
        client.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [addr],
        }),
        client.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        client.readContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "symbol",
        }),
      ]);
      return {
        address,
        token: symbol,
        balance: formatUnits(balance, decimals),
      };
    }

    const balance = await client.getBalance({ address: addr });
    return {
      address,
      token: "ETH",
      balance: formatEther(balance),
    };
  },
});

export const getTransaction = tool({
  description: "Look up a transaction by its hash on Base.",
  inputSchema: z.object({
    hash: z.string().describe("The transaction hash (0x...)"),
  }),
  execute: async ({ hash }) => {
    const tx = await client.getTransaction({
      hash: hash as `0x${string}`,
    });
    const receipt = await client.getTransactionReceipt({
      hash: hash as `0x${string}`,
    });
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: formatEther(tx.value),
      status: receipt.status === "success" ? "Success" : "Failed",
      blockNumber: Number(tx.blockNumber),
      gasUsed: Number(receipt.gasUsed),
    };
  },
});

const resolveEnsInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("A single ENS name to resolve (e.g. vitalik.eth)"),
    names: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Optional batch of ENS names to resolve in one call, preserving input order."
      ),
  })
  .refine(({ name, names }) => Boolean(name || names?.length), {
    message: "Provide either name or names.",
  })
  .refine(({ name, names }) => !(name && names?.length), {
    message: "Provide either name or names, not both.",
  });

export function createReadChainTools() {
  const ensService = createEnsService();

  const resolveEns = tool({
    description:
      "Resolve one or more ENS names on Ethereum mainnet to Ethereum addresses. Returns clear validation, not-found, no-address, or network errors without throwing.",
    inputSchema: resolveEnsInputSchema,
    execute: async ({ name, names }) => {
      const requestedNames = names ?? (name ? [name] : []);
      const results = await ensService.resolveNames(requestedNames);

      if (requestedNames.length === 1) {
        return results[0];
      }

      return {
        results,
        resolutionChainId: mainnet.id,
      };
    },
  });

  const reverseResolveEns = tool({
    description:
      "Reverse-resolve an Ethereum address on Ethereum mainnet to its primary ENS name, if one is configured and forward-confirmed.",
    inputSchema: z.object({
      address: z.string().describe("The Ethereum address (0x...)"),
    }),
    execute: async ({ address }) => ensService.reverseResolveAddress(address),
  });

  return {
    getBalance,
    getTransaction,
    resolveEns,
    reverseResolveEns,
  };
}
