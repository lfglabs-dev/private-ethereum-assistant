import { tool } from "ai";
import { z } from "zod";
import { createPublicClient, http, formatEther, formatUnits, erc20Abi } from "viem";
import { base, mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { config } from "../config";

const client = createPublicClient({
  chain: base,
  transport: http(config.ethereum.rpcUrl),
});

// Separate mainnet client for ENS resolution (ENS lives on mainnet)
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http("https://cloudflare-eth.com"),
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

    if (tokenAddress) {
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

export const resolveEns = tool({
  description:
    "Resolve an ENS name (like vitalik.eth) to an Ethereum address.",
  inputSchema: z.object({
    name: z.string().describe("The ENS name to resolve (e.g. vitalik.eth)"),
  }),
  execute: async ({ name }) => {
    const address = await mainnetClient.getEnsAddress({
      name: normalize(name),
    });
    if (!address) {
      return { name, address: null, error: "ENS name not found" };
    }
    return { name, address };
  },
});
