import { tool } from "ai";
import { z } from "zod";
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { base } from "viem/chains";
import { config } from "../config";

const client = createPublicClient({
  chain: base,
  transport: http(config.ethereum.rpcUrl),
});

function getApiKit() {
  return new SafeApiKit({
    chainId: BigInt(config.ethereum.chainId),
    txServiceUrl: `https://safe-transaction-base.safe.global/api`,
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
    "Propose a new transaction on the Gnosis Safe. If a signer key is configured, the transaction is signed and submitted to the Safe Transaction Service. Otherwise, transaction details and a Safe App link are returned so the user can create and sign it manually in the Safe web UI.",
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
    const signerKey = process.env.SAFE_SIGNER_PRIVATE_KEY;
    const valueInWei = parseEther(value).toString();

    if (signerKey) {
      const protocolKit = await Safe.init({
        provider: config.ethereum.rpcUrl,
        signer: signerKey,
        safeAddress,
      });

      const safeTransaction = await protocolKit.createTransaction({
        transactions: [{ to, value: valueInWei, data: data || "0x" }],
      });

      const signedTx = await protocolKit.signTransaction(safeTransaction);
      const txHash = await protocolKit.getTransactionHash(signedTx);

      const apiKit = getApiKit();
      await apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: signedTx.data,
        safeTxHash: txHash,
        senderAddress:
          (await protocolKit.getSafeProvider().getSignerAddress()) ||
          (await protocolKit.getAddress()),
        senderSignature: signedTx.encodedSignatures(),
      });

      return {
        status: "proposed",
        message:
          "Transaction signed and submitted to the Safe Transaction Service. Owners can approve it in the Safe UI.",
        safeTxHash: txHash,
        transaction: { to, value: value + " ETH", data: data || "0x" },
        safeUrl: `https://app.safe.global/transactions/queue?safe=base:${safeAddress}`,
      };
    }

    // No signer key: generate a Safe App link for manual signing
    const apiKit = getApiKit();
    const nonce = await apiKit
      .getSafeInfo(safeAddress)
      .then((info) => info.nonce);

    const safeUrl = `https://app.safe.global/transactions/queue?safe=base:${safeAddress}`;

    return {
      status: "manual_creation_required",
      message:
        "Transaction details prepared. Open the Safe App link below, create the transaction in Safe, and sign it with your connected wallet.",
      transaction: {
        to,
        value: value + " ETH",
        valueWei: valueInWei,
        data: data || "0x",
        nonce,
      },
      safeUrl,
    };
  },
});
