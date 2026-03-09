import { tool } from "ai";
import { z } from "zod";
import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
  isAddress,
  parseEther,
  parseUnits,
} from "viem";
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
    apiKey: process.env.SAFE_API_KEY,
  });
}

const safeAddress = config.ethereum.safeAddress;
const safeAppChainPrefix =
  {
    1: "eth",
    8453: "base",
    84532: "basesep",
    11155111: "sep",
  }[config.ethereum.chainId] || "base";

function getSafeUiLink(address = safeAddress) {
  return `https://app.safe.global/transactions/queue?safe=${safeAppChainPrefix}:${address}`;
}

function getTransactionType(data?: string) {
  if (!data || data === "0x") return "ETH transfer";
  if (data.startsWith("0x095ea7b3")) return "ERC-20 approve";
  return "Contract call";
}

function getConfirmationStatus(current: number, required: number, isExecuted = false) {
  if (isExecuted) return "Executed";
  if (current >= required) return "Ready to execute";
  return "Awaiting signatures";
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
}

function getFriendlyErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Could not complete the Safe transaction request due to an unknown error.";
  }

  const message = error.message;
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("is not a signer of safe")) return message;
  if (lowerMessage.includes("resolved 0x address")) return message;
  if (lowerMessage.includes("spender must be")) return message;
  if (lowerMessage.includes("erc-20 approvals, provide both")) return message;
  if (lowerMessage.includes("provide either raw calldata")) return message;
  if (lowerMessage.includes("invalid address")) {
    return "One of the addresses is invalid. Resolve ENS first and retry with a valid 0x address.";
  }
  if (lowerMessage.includes("insufficient funds")) {
    return "The configured signer does not have enough funds to pay the proposal gas costs.";
  }
  if (lowerMessage.includes("reverted")) {
    return "The Safe transaction could not be prepared because the call would revert with the current parameters.";
  }
  if (isTimeoutError(error)) {
    return "The Base RPC request timed out while preparing the Safe transaction. Please try again.";
  }
  if (lowerMessage.includes("network") || lowerMessage.includes("fetch failed")) {
    return "Network error while talking to the Safe service or Base RPC. Please try again.";
  }

  return "Could not complete the Safe transaction request. Please try again.";
}

async function getProposalMetadata(
  apiKit: ReturnType<typeof getApiKit>,
  txHash: string,
  fallbackThreshold: number,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const tx = await apiKit.getTransaction(txHash);
      const currentConfirmations = tx.confirmations?.length ?? 1;
      const requiredConfirmations = tx.confirmationsRequired ?? fallbackThreshold;
      const isExecuted =
        ("isExecuted" in tx && Boolean(tx.isExecuted)) ||
        ("executedAt" in tx && Boolean(tx.executedAt));

      return {
        currentConfirmations,
        requiredConfirmations,
        statusLabel: getConfirmationStatus(
          currentConfirmations,
          requiredConfirmations,
          isExecuted,
        ),
      };
    } catch {
      if (attempt === 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return {
    currentConfirmations: 1,
    requiredConfirmations: fallbackThreshold,
    statusLabel: getConfirmationStatus(1, fallbackThreshold),
  };
}

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
    try {
      const apiKit = getApiKit();
      const response = await apiKit.getPendingTransactions(safeAddress);

      if (response.results.length === 0) {
        return {
          transactions: [],
          message: "No pending transactions.",
          safeAddress,
          safeUILink: getSafeUiLink(),
        };
      }

      const transactions = response.results.map((tx) => {
        const currentConfirmations = tx.confirmations?.length ?? 0;
        const requiredConfirmations = tx.confirmationsRequired;
        return {
          safeTxHash: tx.safeTxHash,
          safeAddress,
          safeUILink: getSafeUiLink(),
          to: tx.to,
          value: formatEther(BigInt(tx.value)) + " ETH",
          data: tx.data || "0x",
          transactionType: getTransactionType(tx.data || "0x"),
          currentConfirmations,
          requiredConfirmations,
          status: getConfirmationStatus(
            currentConfirmations,
            requiredConfirmations,
            Boolean("isExecuted" in tx && tx.isExecuted),
          ),
          submissionDate: tx.submissionDate,
        };
      });

      return { transactions, safeAddress, safeUILink: getSafeUiLink() };
    } catch (error) {
      return {
        status: "error",
        message: getFriendlyErrorMessage(error),
        statusLabel: "Needs attention",
        safeAddress,
        safeUILink: getSafeUiLink(),
      };
    }
  },
});

export const proposeTransaction = tool({
  description:
    "Propose a new transaction on the Gnosis Safe. Use a resolved 0x destination address. Supports ETH transfers, raw calldata contract calls, and ERC-20 approvals by passing `spender` and `tokenAmount`. If a signer key is configured, the transaction is signed and submitted to the Safe Transaction Service. Otherwise, transaction details and a Safe App link are returned so the user can create and sign it manually in the Safe web UI.",
  inputSchema: z.object({
    to: z
      .string()
      .describe(
        "The destination address (0x...). Resolve ENS before calling this tool. For ERC-20 approvals, this is the token contract address.",
      ),
    value: z
      .string()
      .optional()
      .describe("The amount of ETH to send (e.g. '0.1' for 0.1 ETH)"),
    data: z
      .string()
      .optional()
      .describe(
        "Optional calldata for contract interactions. Defaults to '0x' (simple ETH transfer)."
      ),
    spender: z
      .string()
      .optional()
      .describe(
        "Optional spender address for ERC-20 approvals. If provided with `tokenAmount`, the tool encodes approve(spender, amount) calldata automatically.",
      ),
    tokenAmount: z
      .string()
      .optional()
      .describe(
        "Optional human-readable token amount for ERC-20 approvals, such as '1000'. Used with `spender`.",
      ),
  }),
  execute: async ({ to, value, data, spender, tokenAmount }) => {
    const safeUILink = getSafeUiLink();

    try {
      if (!isAddress(to)) {
        throw new Error("Destination must be a resolved 0x address.");
      }

      if ((spender && !tokenAmount) || (!spender && tokenAmount)) {
        throw new Error(
          "For ERC-20 approvals, provide both `spender` and `tokenAmount`.",
        );
      }

      if (spender && !isAddress(spender)) {
        throw new Error("Spender must be a valid 0x address.");
      }

      if (data && spender) {
        throw new Error(
          "Provide either raw calldata in `data` or ERC-20 approval fields, not both.",
        );
      }

      const apiKit = getApiKit();
      const info = await apiKit.getSafeInfo(safeAddress);
      const resolvedValue = value ?? "0";
      const valueInWei = parseEther(resolvedValue).toString();

      let transactionData = data || "0x";
      let transactionType = getTransactionType(transactionData);
      let tokenSymbol: string | undefined;

      if (spender && tokenAmount) {
        const [decimals, symbol] = await Promise.all([
          client.readContract({
            address: to as `0x${string}`,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({
            address: to as `0x${string}`,
            abi: erc20Abi,
            functionName: "symbol",
          }),
        ]);

        transactionData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as `0x${string}`, parseUnits(tokenAmount, decimals)],
        });
        transactionType = "ERC-20 approve";
        tokenSymbol = symbol;
      }

      const transactionSummary =
        transactionType === "ETH transfer"
          ? `Proposing to send ${resolvedValue} ETH from Safe ${safeAddress} to ${to}.`
          : transactionType === "ERC-20 approve" && spender && tokenAmount
            ? `Proposing to approve ${tokenAmount} ${tokenSymbol || "tokens"} from Safe ${safeAddress} for spender ${spender}.`
            : `Proposing a contract call from Safe ${safeAddress} to ${to}.`;

      const signerKey = process.env.SAFE_SIGNER_PRIVATE_KEY;

      if (!signerKey) {
        return {
          status: "manual_creation_required",
          message:
            "SAFE_SIGNER_PRIVATE_KEY is not configured. Open the Safe UI below to create this transaction manually with a connected signer wallet.",
          summary: transactionSummary,
          safeAddress,
          safeUILink,
          threshold: info.threshold,
          signers: info.owners,
          currentConfirmations: 0,
          requiredConfirmations: info.threshold,
          statusLabel: "Manual creation required",
          pendingTransactionsHint:
            "After proposing it in Safe, ask me 'what are the pending Safe transactions?' to check status.",
          transaction: {
            to,
            value: `${resolvedValue} ETH`,
            valueWei: valueInWei,
            data: transactionData,
            type: transactionType,
            spender,
            tokenAmount: tokenAmount && tokenSymbol ? `${tokenAmount} ${tokenSymbol}` : tokenAmount,
            nonce: info.nonce,
          },
        };
      }

      const protocolKit = await Safe.init({
        provider: config.ethereum.rpcUrl,
        signer: signerKey,
        safeAddress,
      });
      const signerAddress = await protocolKit.getSafeProvider().getSignerAddress();

      if (!signerAddress) {
        throw new Error("Could not determine the configured signer address.");
      }

      const isOwner = info.owners.some(
        (owner) => owner.toLowerCase() === signerAddress.toLowerCase(),
      );

      if (!isOwner) {
        throw new Error(`Address ${signerAddress} is not a signer of Safe ${safeAddress}`);
      }

      const safeTransaction = await protocolKit.createTransaction({
        transactions: [{ to, value: valueInWei, data: transactionData }],
      });

      const signedTx = await protocolKit.signTransaction(safeTransaction);
      const txHash = await protocolKit.getTransactionHash(signedTx);

      await apiKit.proposeTransaction({
        safeAddress,
        safeTransactionData: signedTx.data,
        safeTxHash: txHash,
        senderAddress: signerAddress,
        senderSignature: signedTx.encodedSignatures(),
        origin: "Private Ethereum Assistant",
      });

      const metadata = await getProposalMetadata(apiKit, txHash, info.threshold);

      return {
        status: "proposed",
        message:
          "Transaction proposed in the Safe Transaction Service. Remaining owners can review and sign it in the Safe UI.",
        summary: transactionSummary,
        signerMessage: `Your EOA ${signerAddress} signed as ${metadata.currentConfirmations}/${metadata.requiredConfirmations} required signatures.`,
        safeTxHash: txHash,
        safeAddress,
        safeUILink,
        proposerAddress: signerAddress,
        threshold: info.threshold,
        currentConfirmations: metadata.currentConfirmations,
        requiredConfirmations: metadata.requiredConfirmations,
        statusLabel: metadata.statusLabel,
        signers: info.owners,
        pendingTransactionsHint:
          "Ask me 'what are the pending Safe transactions?' any time to check progress.",
        transaction: {
          to,
          value: `${resolvedValue} ETH`,
          data: transactionData,
          type: transactionType,
          spender,
          tokenAmount: tokenAmount && tokenSymbol ? `${tokenAmount} ${tokenSymbol}` : tokenAmount,
        },
      };
    } catch (error) {
      return {
        status: "error",
        message: getFriendlyErrorMessage(error),
        statusLabel: "Needs attention",
        safeAddress,
        safeUILink,
      };
    }
  },
});
