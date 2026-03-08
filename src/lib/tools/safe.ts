import { tool } from "ai";
import { z } from "zod";
import SafeApiKit from "@safe-global/api-kit";
import { createPublicClient, http, formatEther } from "viem";
import { base } from "viem/chains";
import { config } from "../config";

const client = createPublicClient({
  chain: base,
  transport: http(config.ethereum.rpcUrl),
});

function getApiKit() {
  return new SafeApiKit({
    chainId: BigInt(config.ethereum.chainId),
  });
}

const safeAddress = config.ethereum.safeAddress;

export const getSafeInfo = tool({
  description:
    "Get information about the configured Gnosis Safe: owners, threshold, nonce, and ETH balance.",
  inputSchema: z.object({}),
  execute: async () => {
    const apiKit = getApiKit();
    const info = await apiKit.getSafeInfo(safeAddress);
    const balance = await client.getBalance({
      address: safeAddress as `0x${string}`,
    });

    return {
      address: safeAddress,
      owners: info.owners,
      threshold: info.threshold,
      nonce: info.nonce,
      balance: formatEther(balance) + " ETH",
    };
  },
});

export const getPendingTransactions = tool({
  description:
    "List pending transactions awaiting approval on the configured Gnosis Safe.",
  inputSchema: z.object({}),
  execute: async () => {
    const apiKit = getApiKit();
    const response = await apiKit.getPendingTransactions(safeAddress);

    if (response.results.length === 0) {
      return { transactions: [], message: "No pending transactions." };
    }

    const transactions = response.results.map((tx) => ({
      safeTxHash: tx.safeTxHash,
      to: tx.to,
      value: formatEther(BigInt(tx.value)) + " ETH",
      data: tx.data || "0x",
      confirmations: tx.confirmations?.length ?? 0,
      confirmationsRequired: tx.confirmationsRequired,
      submissionDate: tx.submissionDate,
    }));

    return { transactions };
  },
});

export const proposeTransaction = tool({
  description:
    "Propose a new transaction on the Gnosis Safe. The transaction will need to be approved by Safe owners in the Safe UI before it executes. This tool only creates the proposal — it does NOT execute anything.",
  inputSchema: z.object({
    to: z.string().describe("The destination address (0x...)"),
    value: z
      .string()
      .describe("The amount of ETH to send (e.g. '0.1' for 0.1 ETH)"),
    data: z
      .string()
      .optional()
      .describe(
        "Optional calldata for contract interactions. Defaults to '0x' (simple ETH transfer)."
      ),
  }),
  execute: async ({ to, value, data }) => {
    const apiKit = getApiKit();
    const nonce = await apiKit.getSafeInfo(safeAddress).then((info) => info.nonce);

    const safeUrl = `https://app.safe.global/transactions/queue?safe=base:${safeAddress}`;

    return {
      status: "prepared",
      message:
        "Transaction prepared. Please review the details and submit via the Safe UI.",
      transaction: {
        to,
        value: value + " ETH",
        data: data || "0x (simple transfer)",
        nonce,
      },
      safeUrl,
    };
  },
});
