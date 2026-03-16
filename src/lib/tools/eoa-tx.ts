import { tool } from "ai";
import { z } from "zod";
import {
  type Address,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  parseEther,
  parseUnits,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalize } from "viem/ens";
import {
  createEthereumContext,
  DEFAULT_NETWORK_CONFIG,
  getExplorerTxUrl,
  type ChainMetadata,
  type NetworkConfig,
} from "../ethereum";

const transferInputSchema = z.object({
  to: z
    .string()
    .describe("Recipient address or ENS name such as vitalik.eth."),
  amount: z
    .string()
    .describe("Amount to send as a decimal string, e.g. '0.01'."),
  tokenAddress: z
    .string()
    .optional()
    .describe(
      "Optional ERC-20 token contract address. Omit it for native ETH transfers."
    ),
  gasLimit: z
    .string()
    .optional()
    .describe("Optional manual gas limit as an integer string."),
});

type TransferInput = z.infer<typeof transferInputSchema>;

type TokenInfo = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type EoaApprovalPolicy = {
  enabled: boolean;
  nativeThreshold: string;
  erc20Threshold: string;
};

export type EoaWalletConfig = {
  eoaPrivateKey?: string;
  approvalPolicy: EoaApprovalPolicy;
};

type PreviewGasEstimate = NonNullable<PreviewResult["gasEstimate"]>;
type PreviewBalance = NonNullable<PreviewResult["balance"]>;
type ApprovalState = "not_required" | "pending" | "approved" | "rejected";

type ApprovalSummary = {
  recipient: string;
  asset: string;
  amount: string;
  network: string;
  estimatedGas: string;
};

type PreparedTransferApproval = {
  required: boolean;
  state: ApprovalState;
  thresholdAmount?: string;
  thresholdAssetSymbol?: string;
  summary: ApprovalSummary;
};

type PreparedTransfer = {
  confirmationId: string;
  expiresAt: number;
  network: NetworkConfig;
  chain: ChainMetadata;
  sender: Address;
  recipient: Address;
  recipientInput: string;
  resolvedEnsName?: string;
  amount: string;
  amountBaseUnits: bigint;
  token?: TokenInfo;
  value: bigint;
  data: Hex;
  gasLimitOverride?: bigint;
  balance: PreviewBalance;
  gasEstimate: PreviewGasEstimate;
  approval: PreparedTransferApproval;
};

type StepState = "pending" | "in_progress" | "complete" | "error";

type ProgressStep = {
  key: "estimate" | "build" | "sign" | "broadcast" | "confirm";
  label: string;
  status: StepState;
  detail?: string;
};

type PreviewResult = {
  kind: "transaction_preview" | "transaction_error";
  status:
    | "awaiting_confirmation"
    | "awaiting_local_approval"
    | "aborted"
    | "error";
  summary: string;
  message: string;
  confirmationId?: string;
  chain: ChainMetadata;
  sender?: string;
  recipient?: string;
  recipientInput?: string;
  resolvedEnsName?: string;
  asset?: {
    type: "ETH" | "ERC20";
    symbol: string;
    tokenAddress?: string;
  };
  amount?: string;
  balance?: {
    asset: string;
    amount: string;
  };
  gasEstimate?: {
    gasLimit: string;
    maxFeePerGasGwei: string;
    maxPriorityFeePerGasGwei?: string;
    gasCostNative: string;
  };
  approval?: {
    required: boolean;
    state: ApprovalState;
    thresholdAmount?: string;
    thresholdAssetSymbol?: string;
    summary: ApprovalSummary;
  };
  error?: string;
};

type ProgressResult = {
  kind: "transaction_progress";
  status:
    | "estimating_gas"
    | "building"
    | "signing"
    | "broadcasting"
    | "waiting_for_confirmation"
    | "confirmed"
    | "reverted"
    | "error";
  summary: string;
  message: string;
  chain: ChainMetadata;
  sender: string;
  recipient: string;
  recipientInput: string;
  resolvedEnsName?: string;
  asset: {
    type: "ETH" | "ERC20";
    symbol: string;
    tokenAddress?: string;
  };
  amount: string;
  steps: ProgressStep[];
  txHash?: string;
  explorerUrl?: string;
  receipt?: {
    status: "success" | "reverted";
    blockNumber: number;
    gasUsed: string;
    effectiveGasPriceGwei?: string;
    gasCostNative?: string;
  };
  revertReason?: string;
  error?: string;
};

type FeeInfo = {
  type: "eip1559" | "legacy";
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

type ToolError = {
  error: string;
};

const PREPARED_TRANSFER_TTL_MS = 10 * 60 * 1000;
const preparedTransfers = new Map<string, PreparedTransfer>();
const fallbackChainMetadata = createEthereumContext(
  DEFAULT_NETWORK_CONFIG
).chainMetadata;

function hasToolError(value: unknown): value is ToolError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

function cleanupPreparedTransfers() {
  const now = Date.now();
  for (const [id, transfer] of preparedTransfers.entries()) {
    if (transfer.expiresAt <= now) {
      preparedTransfers.delete(id);
    }
  }
}

function getSignerPrivateKey(
  configuredPrivateKey?: string
): { privateKey: Hex } | ToolError {
  const value = configuredPrivateKey?.trim();
  if (!value) {
    return {
      error: "No EOA signer is configured. Add an EOA private key in Settings first.",
    };
  }

  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized)) {
    return {
      error:
        "The configured EOA private key is invalid. Expected a 32-byte hex string.",
    };
  }

  return { privateKey: normalized as Hex };
}

async function resolveRecipient(
  input: string,
  ensClient: ReturnType<typeof createEthereumContext>["ensClient"]
): Promise<{ address: Address; resolvedEnsName?: string } | ToolError> {
  const trimmed = input.trim();

  if (trimmed.endsWith(".eth")) {
    const address = await ensClient.getEnsAddress({
      name: normalize(trimmed),
    });

    if (!address) {
      return { error: `ENS name not found: ${trimmed}` };
    }

    return {
      address,
      resolvedEnsName: trimmed,
    };
  }

  if (!isAddress(trimmed)) {
    return { error: `Invalid recipient address: ${trimmed}` };
  }

  return { address: getAddress(trimmed) };
}

async function getTokenInfo(
  tokenAddress: string,
  publicClient: ReturnType<typeof createEthereumContext>["publicClient"]
): Promise<TokenInfo | ToolError> {
  if (!isAddress(tokenAddress)) {
    return { error: `Invalid ERC-20 token address: ${tokenAddress}` };
  }

  const address = getAddress(tokenAddress);
  const bytecode = await publicClient.getBytecode({ address });
  if (!bytecode || bytecode === "0x") {
    return {
      error: `No ERC-20 contract was found at ${address}.`,
    };
  }

  let decimals: number;
  let symbol: string;
  try {
    [decimals, symbol] = await Promise.all([
      publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "symbol",
      }),
    ]);
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : `Could not read ERC-20 metadata from ${address}.`,
    };
  }

  return {
    address,
    decimals,
    symbol,
  };
}

function parseOptionalGasLimit(
  gasLimit: string | undefined
): { gasLimit: bigint } | ToolError | undefined {
  if (!gasLimit) return undefined;
  if (!/^\d+$/.test(gasLimit)) {
    return { error: "gasLimit must be a positive integer string." };
  }

  const parsed = BigInt(gasLimit);
  if (parsed <= BigInt(0)) {
    return { error: "gasLimit must be greater than zero." };
  }

  return { gasLimit: parsed };
}

function formatGwei(value: bigint | undefined) {
  return value ? formatUnits(value, 9) : undefined;
}

function getFeePerGas(fees: FeeInfo) {
  return fees.maxFeePerGas ?? fees.gasPrice ?? BigInt(0);
}

async function estimateFees(
  publicClient: ReturnType<typeof createEthereumContext>["publicClient"]
) {
  const fees = await publicClient.estimateFeesPerGas();

  if (fees.maxFeePerGas != null) {
    return {
      type: "eip1559",
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? undefined,
    } as const satisfies FeeInfo;
  }

  return {
    type: "legacy",
    gasPrice: fees.gasPrice ?? (await publicClient.getGasPrice()),
  } as const satisfies FeeInfo;
}

function buildSummary(prepared: PreparedTransfer) {
  const assetLabel = getAssetLabel(prepared);
  const recipientLabel = getRecipientLabel(prepared);
  return `Sending ${prepared.amount} ${assetLabel} to ${recipientLabel}`;
}

function buildPreviewError(message: string, chain: ChainMetadata): PreviewResult {
  return {
    kind: "transaction_error",
    status: "error",
    summary: "Transaction preparation failed",
    message,
    chain,
    error: message,
  };
}

function getRecipientLabel(prepared: Pick<
  PreparedTransfer,
  "recipient" | "resolvedEnsName"
>) {
  return prepared.resolvedEnsName
    ? `${prepared.resolvedEnsName} (${prepared.recipient})`
    : prepared.recipient;
}

function getAssetLabel(prepared: Pick<PreparedTransfer, "token" | "chain">) {
  return prepared.token?.symbol ?? prepared.chain.nativeSymbol;
}

function formatApprovalEstimatedGas(gasEstimate: PreviewGasEstimate, chain: ChainMetadata) {
  return `${gasEstimate.gasLimit} gas @ max ${gasEstimate.maxFeePerGasGwei} gwei (~${gasEstimate.gasCostNative} ${chain.nativeSymbol})`;
}

function buildApprovalSummary(
  prepared: Pick<
    PreparedTransfer,
    "recipient" | "resolvedEnsName" | "token" | "chain" | "amount" | "gasEstimate"
  >
): ApprovalSummary {
  return {
    recipient: getRecipientLabel(prepared),
    asset: prepared.token
      ? `${prepared.token.symbol} (${prepared.token.address})`
      : prepared.chain.nativeSymbol,
    amount: `${prepared.amount} ${getAssetLabel(prepared)}`,
    network: prepared.chain.name,
    estimatedGas: formatApprovalEstimatedGas(prepared.gasEstimate, prepared.chain),
  };
}

function buildPreviewFromPrepared(
  prepared: PreparedTransfer,
  overrides?: Partial<Pick<PreviewResult, "status" | "message" | "summary" | "error">>
): PreviewResult {
  const status =
    overrides?.status ??
    (prepared.approval.required
      ? prepared.approval.state === "rejected"
        ? "aborted"
        : "awaiting_local_approval"
      : "awaiting_confirmation");
  const message =
    overrides?.message ??
    (status === "awaiting_local_approval"
      ? "Local approval is required on this device before signing. Use the approval card to approve or reject the transfer."
      : status === "aborted"
        ? "Local approval was rejected. The transaction was not signed or broadcast."
        : "Transaction prepared. Summarize it for the user, ask for explicit confirmation, and only call send_eoa_transfer after the user says yes.");

  return {
    kind: "transaction_preview",
    status,
    summary: overrides?.summary ?? buildSummary(prepared),
    message,
    confirmationId: prepared.confirmationId,
    chain: prepared.chain,
    sender: prepared.sender,
    recipient: prepared.recipient,
    recipientInput: prepared.recipientInput,
    resolvedEnsName: prepared.resolvedEnsName,
    asset: prepared.token
      ? {
          type: "ERC20",
          symbol: prepared.token.symbol,
          tokenAddress: prepared.token.address,
        }
      : {
          type: "ETH",
          symbol: prepared.chain.nativeSymbol,
        },
    amount: prepared.amount,
    balance: prepared.balance,
    gasEstimate: prepared.gasEstimate,
    approval: {
      required: prepared.approval.required,
      state: prepared.approval.state,
      thresholdAmount: prepared.approval.thresholdAmount,
      thresholdAssetSymbol: prepared.approval.thresholdAssetSymbol,
      summary: prepared.approval.summary,
    },
    ...(overrides?.error ? { error: overrides.error } : {}),
  };
}

function getApprovalThreshold(
  prepared: Pick<PreparedTransfer, "token" | "chain" | "amountBaseUnits">,
  approvalPolicy: EoaApprovalPolicy
): { thresholdAmount: string; thresholdBaseUnits: bigint; thresholdAssetSymbol: string } | ToolError {
  const thresholdAmount = prepared.token
    ? approvalPolicy.erc20Threshold
    : approvalPolicy.nativeThreshold;
  const thresholdAssetSymbol = getAssetLabel(prepared);

  try {
    return {
      thresholdAmount,
      thresholdBaseUnits: prepared.token
        ? parseUnits(thresholdAmount, prepared.token.decimals)
        : parseEther(thresholdAmount),
      thresholdAssetSymbol,
    };
  } catch {
    return {
      error: `Invalid local approval threshold for ${thresholdAssetSymbol}. Update the approval policy in settings.`,
    };
  }
}

function buildApprovalRequirement(
  prepared: Pick<
    PreparedTransfer,
    "token" | "chain" | "amountBaseUnits" | "recipient" | "resolvedEnsName" | "amount" | "gasEstimate"
  >,
  approvalPolicy: EoaApprovalPolicy
): PreparedTransferApproval | ToolError {
  const summary = buildApprovalSummary(prepared);
  if (!approvalPolicy.enabled) {
    return {
      required: false,
      state: "not_required",
      summary,
    };
  }

  const threshold = getApprovalThreshold(prepared, approvalPolicy);
  if (hasToolError(threshold)) {
    return threshold;
  }

  const required = prepared.amountBaseUnits > threshold.thresholdBaseUnits;
  return {
    required,
    state: required ? "pending" : "not_required",
    thresholdAmount: threshold.thresholdAmount,
    thresholdAssetSymbol: threshold.thresholdAssetSymbol,
    summary,
  };
}

function getPreparedTransferOrError(
  confirmationId: string
): { prepared: PreparedTransfer } | { error: PreviewResult } {
  cleanupPreparedTransfers();
  const prepared = preparedTransfers.get(confirmationId);
  if (!prepared || prepared.expiresAt <= Date.now()) {
    return {
      error: buildPreviewError(
        "The prepared transaction expired or was not found. Run prepare_eoa_transfer again.",
        fallbackChainMetadata
      ),
    } as const;
  }

  return { prepared } as const;
}

function markPreparedTransferApproved(
  confirmationId: string
): PreparedTransfer | PreviewResult {
  const lookup = getPreparedTransferOrError(confirmationId);
  if ("error" in lookup) {
    return lookup.error;
  }

  const { prepared } = lookup;
  if (!prepared.approval.required) {
    return prepared;
  }

  if (prepared.approval.state === "rejected") {
    return buildPreviewFromPrepared(prepared, {
      status: "aborted",
    });
  }

  prepared.approval.state = "approved";
  return prepared;
}

export function rejectPreparedEoaTransfer(confirmationId: string): PreviewResult {
  const lookup = getPreparedTransferOrError(confirmationId);
  if ("error" in lookup) {
    return lookup.error;
  }

  const { prepared } = lookup;
  prepared.approval.state = prepared.approval.required ? "rejected" : "not_required";
  return buildPreviewFromPrepared(prepared, {
    status: "aborted",
  });
}

async function prepareTransfer(
  input: TransferInput,
  network: NetworkConfig,
  walletConfig: EoaWalletConfig
) {
  cleanupPreparedTransfers();
  const { publicClient, ensClient, chainMetadata } =
    createEthereumContext(network);

  const signer = getSignerPrivateKey(walletConfig.eoaPrivateKey);
  if (hasToolError(signer)) {
    return {
      ok: false,
      result: buildPreviewError(signer.error, chainMetadata),
    } as const;
  }

  const amountText = input.amount.trim();
  if (!amountText) {
    return {
      ok: false,
      result: buildPreviewError("Amount is required.", chainMetadata),
    } as const;
  }

  const gasLimitOverride = parseOptionalGasLimit(input.gasLimit);
  if (hasToolError(gasLimitOverride)) {
    return {
      ok: false,
      result: buildPreviewError(gasLimitOverride.error, chainMetadata),
    } as const;
  }

  const recipient = await resolveRecipient(input.to, ensClient);
  if (hasToolError(recipient)) {
    return {
      ok: false,
      result: buildPreviewError(recipient.error, chainMetadata),
    } as const;
  }

  const sender = privateKeyToAccount(signer.privateKey).address;
  let token: TokenInfo | undefined;
  let amountBaseUnits: bigint;
  let value = BigInt(0);
  let data = "0x" as Hex;

  if (input.tokenAddress) {
    const tokenInfo = await getTokenInfo(input.tokenAddress, publicClient);
    if (hasToolError(tokenInfo)) {
      return {
        ok: false,
        result: buildPreviewError(tokenInfo.error, chainMetadata),
      } as const;
    }

    token = tokenInfo;
    try {
      amountBaseUnits = parseUnits(amountText, token.decimals);
    } catch {
      return {
        ok: false,
        result: buildPreviewError(
          `Invalid amount for ${token.symbol}. Use a decimal string.`,
          chainMetadata
        ),
      } as const;
    }

    if (amountBaseUnits <= BigInt(0)) {
      return {
        ok: false,
        result: buildPreviewError(
          "ERC-20 transfer amount must be greater than zero.",
          chainMetadata
        ),
      } as const;
    }

    data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient.address, amountBaseUnits],
    });
  } else {
    try {
      amountBaseUnits = parseEther(amountText);
    } catch {
      return {
        ok: false,
        result: buildPreviewError(
          "Invalid ETH amount. Use a decimal string.",
          chainMetadata
        ),
      } as const;
    }

    if (amountBaseUnits <= BigInt(0)) {
      return {
        ok: false,
        result: buildPreviewError(
          "ETH transfer amount must be greater than zero.",
          chainMetadata
        ),
      } as const;
    }

    value = amountBaseUnits;
  }

  const nativeBalance = await publicClient.getBalance({ address: sender });

  if (token) {
    const tokenBalance = await publicClient.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [sender],
    });

    if (tokenBalance < amountBaseUnits) {
      return {
        ok: false,
        result: buildPreviewError(
          `Insufficient ${token.symbol} balance. Available: ${formatUnits(
            tokenBalance,
            token.decimals
          )} ${token.symbol}.`,
          chainMetadata
        ),
      } as const;
    }
  }

  const txTarget = token?.address ?? recipient.address;

  let fees: FeeInfo;
  let estimatedGas: bigint;
  try {
    fees = await estimateFees(publicClient);
    estimatedGas =
      gasLimitOverride?.gasLimit ??
      (await publicClient.estimateGas({
        account: sender,
        to: txTarget,
        value,
        data,
      }));
  } catch (error) {
    return {
      ok: false,
      result: buildPreviewError(extractErrorMessage(error), chainMetadata),
    } as const;
  }

  const maxGasCost = estimatedGas * getFeePerGas(fees);

  if (token) {
    if (nativeBalance < maxGasCost) {
      return {
        ok: false,
        result: buildPreviewError(
          `Insufficient ${chainMetadata.nativeSymbol} for gas. Need about ${formatEther(
            maxGasCost
          )} ${chainMetadata.nativeSymbol}.`,
          chainMetadata
        ),
      } as const;
    }
  } else if (nativeBalance < amountBaseUnits + maxGasCost) {
    return {
      ok: false,
      result: buildPreviewError(
        `Insufficient ${chainMetadata.nativeSymbol}. Need about ${formatEther(
          amountBaseUnits + maxGasCost
        )} ${chainMetadata.nativeSymbol} including gas.`,
        chainMetadata
      ),
    } as const;
  }

  const gasEstimate: PreviewGasEstimate = {
    gasLimit: estimatedGas.toString(),
    maxFeePerGasGwei: formatGwei(getFeePerGas(fees)) ?? "0",
    maxPriorityFeePerGasGwei: formatGwei(fees.maxPriorityFeePerGas),
    gasCostNative: formatEther(estimatedGas * getFeePerGas(fees)),
  };
  const balance: PreviewBalance = {
    asset: chainMetadata.nativeSymbol,
    amount: formatEther(nativeBalance),
  };
  const approval = buildApprovalRequirement(
    {
      token,
      chain: chainMetadata,
      amountBaseUnits,
      recipient: recipient.address,
      resolvedEnsName: recipient.resolvedEnsName,
      amount: amountText,
      gasEstimate,
    },
    walletConfig.approvalPolicy
  );
  if (hasToolError(approval)) {
    return {
      ok: false,
      result: buildPreviewError(approval.error, chainMetadata),
    } as const;
  }

  const prepared: PreparedTransfer = {
    confirmationId: crypto.randomUUID(),
    expiresAt: Date.now() + PREPARED_TRANSFER_TTL_MS,
    network,
    chain: chainMetadata,
    sender,
    recipient: recipient.address,
    recipientInput: input.to,
    resolvedEnsName: recipient.resolvedEnsName,
    amount: amountText,
    amountBaseUnits,
    token,
    value,
    data,
    gasLimitOverride: gasLimitOverride?.gasLimit,
    balance,
    gasEstimate,
    approval,
  };

  preparedTransfers.set(prepared.confirmationId, prepared);

  return {
    ok: true,
    preview: buildPreviewFromPrepared(prepared, {
      status: approval.required ? "awaiting_local_approval" : "awaiting_confirmation",
      message: approval.required
        ? "Local approval is required on this device before signing. Show the exact summary and direct the user to approve or reject it in the approval card."
        : undefined,
    }),
  } as const;
}

function makeProgressBase(prepared: PreparedTransfer): Omit<
  ProgressResult,
  "status" | "message" | "steps"
> {
  return {
    kind: "transaction_progress",
    summary: buildSummary(prepared),
    chain: prepared.chain,
    sender: prepared.sender,
    recipient: prepared.recipient,
    recipientInput: prepared.recipientInput,
    resolvedEnsName: prepared.resolvedEnsName,
    asset: prepared.token
      ? {
          type: "ERC20",
          symbol: prepared.token.symbol,
          tokenAddress: prepared.token.address,
        }
      : {
          type: "ETH",
          symbol: prepared.chain.nativeSymbol,
        },
    amount: prepared.amount,
  };
}

function buildSteps(
  values: Partial<
    Record<
      ProgressStep["key"],
      { label?: string; status?: StepState; detail?: string }
    >
  >
) {
  return (["estimate", "build", "sign", "broadcast", "confirm"] as const).map(
    (key) => ({
      key,
      label:
        values[key]?.label ??
        {
          estimate: "Estimating gas",
          build: "Building transaction",
          sign: "Signing transaction",
          broadcast: "Broadcasting transaction",
          confirm: "Waiting for confirmation",
        }[key],
      status: values[key]?.status ?? "pending",
      detail: values[key]?.detail,
    })
  );
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = [
      "shortMessage" in error ? String(error.shortMessage) : "",
      error.message,
      "details" in error ? String(error.details) : "",
    ]
      .map((value) => value.trim())
      .filter(Boolean);

    if (details.length > 0) {
      return details[0];
    }
  }

  return "Unknown transaction error.";
}

async function getRevertReason(
  prepared: PreparedTransfer,
  publicClient: ReturnType<typeof createEthereumContext>["publicClient"]
) {
  try {
    await publicClient.call({
      account: prepared.sender,
      to: prepared.token?.address ?? prepared.recipient,
      value: prepared.value,
      data: prepared.data,
    });
    return undefined;
  } catch (error) {
    const message = extractErrorMessage(error);
    return message === "Unknown transaction error." ? undefined : message;
  }
}

async function buildSendPlan(
  prepared: PreparedTransfer,
  publicClient: ReturnType<typeof createEthereumContext>["publicClient"]
) {
  const fees = await estimateFees(publicClient);
  const gasLimit =
    prepared.gasLimitOverride ??
    (await publicClient.estimateGas({
      account: prepared.sender,
      to: prepared.token?.address ?? prepared.recipient,
      value: prepared.value,
      data: prepared.data,
    }));
  const nonce = await publicClient.getTransactionCount({
    address: prepared.sender,
    blockTag: "pending",
  });
  const nativeBalance = await publicClient.getBalance({ address: prepared.sender });

  if (prepared.token) {
    const tokenBalance = await publicClient.readContract({
      address: prepared.token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [prepared.sender],
    });

    if (tokenBalance < prepared.amountBaseUnits) {
      throw new Error(
        `Insufficient ${prepared.token.symbol} balance before signing.`
      );
    }
  }

  const maxGasCost = gasLimit * getFeePerGas(fees);
  const requiredNative =
    prepared.token != null ? maxGasCost : prepared.value + maxGasCost;

  if (nativeBalance < requiredNative) {
    throw new Error(
      `Insufficient ${prepared.chain.nativeSymbol} before signing. Need about ${formatEther(
        requiredNative
      )} ${prepared.chain.nativeSymbol}.`
    );
  }

  return { fees, gasLimit, nonce };
}

function buildSignedTransactionRequest(
  prepared: PreparedTransfer,
  nonce: number,
  gasLimit: bigint,
  fees: FeeInfo,
  chain: ReturnType<typeof createEthereumContext>["chain"]
) {
  const baseRequest = {
    to: prepared.token?.address ?? prepared.recipient,
    value: prepared.value,
    data: prepared.data,
    nonce,
    gas: gasLimit,
    chain,
    chainId: prepared.network.chainId,
  };

  if (fees.type === "eip1559" && fees.maxFeePerGas != null) {
    return {
      ...baseRequest,
      type: "eip1559" as const,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? BigInt(0),
    };
  }

  return {
    ...baseRequest,
    type: "legacy" as const,
    gasPrice: fees.gasPrice ?? BigInt(0),
  };
}

export async function* executePreparedEoaTransfer(
  confirmationId: string,
  eoaPrivateKey?: string
) {
  const lookup = getPreparedTransferOrError(confirmationId);
  if ("error" in lookup) {
    yield lookup.error;
    return;
  }

  const { prepared } = lookup;
  if (prepared.approval.required) {
    if (prepared.approval.state === "rejected") {
      yield buildPreviewFromPrepared(prepared, {
        status: "aborted",
      });
      return;
    }

    if (prepared.approval.state !== "approved") {
      yield buildPreviewFromPrepared(prepared, {
        status: "awaiting_local_approval",
      });
      return;
    }
  }

  const signer = getSignerPrivateKey(eoaPrivateKey);
  if (hasToolError(signer)) {
    yield buildPreviewError(signer.error, prepared.chain);
    return;
  }

  const account = privateKeyToAccount(signer.privateKey);
  if (getAddress(account.address) !== prepared.sender) {
    yield buildPreviewError(
      "The configured EOA signer changed after this transfer was prepared. Prepare the transfer again before sending.",
      prepared.chain
    );
    return;
  }

  preparedTransfers.delete(confirmationId);

  const { publicClient, chain } = createEthereumContext(prepared.network);
  const walletClient = createWalletClient({
    account,
    ...(chain ? { chain } : {}),
    transport: http(prepared.network.rpcUrl),
  });
  const base = makeProgressBase(prepared);

  yield {
    ...base,
    status: "estimating_gas",
    message: "Estimating gas.",
    steps: buildSteps({
      estimate: { status: "in_progress", detail: "Fetching gas estimate…" },
    }),
  } satisfies ProgressResult;

  try {
    const { fees, gasLimit, nonce } = await buildSendPlan(prepared, publicClient);

    yield {
      ...base,
      status: "building",
      message: "Gas estimated. Building the transaction request.",
      steps: buildSteps({
        estimate: {
          status: "complete",
          detail: `Gas: ${gasLimit.toString()} @ ~${formatGwei(
            getFeePerGas(fees)
          )} gwei`,
        },
        build: {
          status: "in_progress",
          detail: `Nonce ${nonce}, chain ID ${prepared.network.chainId}`,
        },
      }),
    } satisfies ProgressResult;

    const request = buildSignedTransactionRequest(
      prepared,
      nonce,
      gasLimit,
      fees,
      chain
    );

    yield {
      ...base,
      status: "signing",
      message: "Transaction built. Signing with the configured EOA.",
      steps: buildSteps({
        estimate: {
          status: "complete",
          detail: `Gas: ${gasLimit.toString()} @ ~${formatGwei(
            getFeePerGas(fees)
          )} gwei`,
        },
        build: {
          status: "complete",
          detail: `Nonce ${nonce}, chain ID ${prepared.network.chainId}`,
        },
        sign: { status: "in_progress", detail: "Signing locally…" },
      }),
    } satisfies ProgressResult;

    const serializedTransaction = await walletClient.signTransaction(request);

    yield {
      ...base,
      status: "broadcasting",
      message: "Signed. Broadcasting the raw transaction.",
      steps: buildSteps({
        estimate: {
          status: "complete",
          detail: `Gas: ${gasLimit.toString()} @ ~${formatGwei(
            getFeePerGas(fees)
          )} gwei`,
        },
        build: {
          status: "complete",
          detail: `Nonce ${nonce}, chain ID ${prepared.network.chainId}`,
        },
        sign: { status: "complete", detail: "Signed successfully." },
        broadcast: {
          status: "in_progress",
          detail: "Submitting to the RPC…",
        },
      }),
    } satisfies ProgressResult;

    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction,
    });
    const explorerUrl = getExplorerTxUrl(txHash, prepared.network);

    yield {
      ...base,
      status: "waiting_for_confirmation",
      message: "Broadcast complete. Waiting for the transaction receipt.",
      txHash,
      explorerUrl,
      steps: buildSteps({
        estimate: {
          status: "complete",
          detail: `Gas: ${gasLimit.toString()} @ ~${formatGwei(
            getFeePerGas(fees)
          )} gwei`,
        },
        build: {
          status: "complete",
          detail: `Nonce ${nonce}, chain ID ${prepared.network.chainId}`,
        },
        sign: { status: "complete", detail: "Signed successfully." },
        broadcast: { status: "complete", detail: txHash },
        confirm: {
          status: "in_progress",
          detail: "Waiting for 1 confirmation…",
        },
      }),
    } satisfies ProgressResult;

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    const receiptData = {
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceGwei: formatGwei(receipt.effectiveGasPrice),
      gasCostNative: formatEther(receipt.gasUsed * receipt.effectiveGasPrice),
    } as const;

    if (receipt.status === "success") {
      yield {
        ...base,
        status: "confirmed",
        message: `Confirmed in block ${receipt.blockNumber.toString()}.`,
        txHash,
        explorerUrl,
        receipt: receiptData,
        steps: buildSteps({
          estimate: {
            status: "complete",
            detail: `Gas: ${gasLimit.toString()} @ ~${formatGwei(
              getFeePerGas(fees)
            )} gwei`,
          },
          build: {
            status: "complete",
            detail: `Nonce ${nonce}, chain ID ${prepared.network.chainId}`,
          },
          sign: { status: "complete", detail: "Signed successfully." },
          broadcast: { status: "complete", detail: txHash },
          confirm: {
            status: "complete",
            detail: `Confirmed in block ${receipt.blockNumber.toString()}`,
          },
        }),
      } satisfies ProgressResult;
      return;
    }

    const revertReason = await getRevertReason(prepared, publicClient);
    yield {
      ...base,
      status: "reverted",
      message: revertReason
        ? `Transaction reverted: ${revertReason}`
        : "Transaction reverted on-chain.",
      txHash,
      explorerUrl,
      receipt: receiptData,
      revertReason,
      steps: buildSteps({
        estimate: {
          status: "complete",
          detail: `Gas: ${gasLimit.toString()} @ ~${formatGwei(
            getFeePerGas(fees)
          )} gwei`,
        },
        build: {
          status: "complete",
          detail: `Nonce ${nonce}, chain ID ${prepared.network.chainId}`,
        },
        sign: { status: "complete", detail: "Signed successfully." },
        broadcast: { status: "complete", detail: txHash },
        confirm: { status: "error", detail: revertReason ?? "Reverted" },
      }),
    } satisfies ProgressResult;
  } catch (error) {
    const message = extractErrorMessage(error);
    yield {
      ...base,
      status: "error",
      message,
      error: message,
      steps: buildSteps({
        estimate: { status: "error", detail: message },
      }),
    } satisfies ProgressResult;
  }
}

export async function* approveAndSendPreparedEoaTransfer(
  confirmationId: string,
  eoaPrivateKey?: string
) {
  const approved = markPreparedTransferApproved(confirmationId);
  if ("kind" in approved) {
    yield approved;
    return;
  }

  yield* executePreparedEoaTransfer(confirmationId, eoaPrivateKey);
}

export function createEoaTransferTools(
  networkConfig: NetworkConfig,
  walletConfig: EoaWalletConfig
) {
  const chainMetadata = createEthereumContext(networkConfig).chainMetadata;

  const prepareEoaTransfer = tool({
    description:
      "Prepare an ETH or ERC-20 transfer from the configured EOA. Always call this first for send requests so you can show gas estimates and ask the user to confirm before signing.",
    inputSchema: transferInputSchema,
    execute: async (input: TransferInput) => {
      const result = await prepareTransfer(input, networkConfig, walletConfig);
      return result.ok ? result.preview : result.result;
    },
  });

  const sendEoaTransfer = tool({
    description:
      "Send a previously prepared ETH or ERC-20 transfer from the configured EOA. Only use this after the user has explicitly confirmed the prepared transfer.",
    inputSchema: z.object({
      confirmationId: z
        .string()
        .describe(
          "The confirmationId returned by prepare_eoa_transfer for the exact transaction the user approved."
        ),
    }),
    execute: async function* ({
      confirmationId,
    }: {
      confirmationId: string;
    }) {
      for await (const update of executePreparedEoaTransfer(
        confirmationId,
        walletConfig.eoaPrivateKey
      )) {
        if (!update) {
          continue;
        }

        if (
          update.kind === "transaction_error" &&
          update.error ===
            "The prepared transaction expired or was not found. Run prepare_eoa_transfer again."
        ) {
          const missingPreparedError: PreviewResult = {
            ...update,
            chain: chainMetadata,
          };
          yield missingPreparedError;
          continue;
        }

        yield update;
      }
    },
  });

  return {
    prepareEoaTransfer,
    sendEoaTransfer,
  };
}
