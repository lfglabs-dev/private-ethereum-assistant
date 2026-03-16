import { tool } from "ai";
import {
  COW_PROTOCOL_VAULT_RELAYER_ADDRESS,
  ETH_FLOW_ADDRESSES,
  EVM_NATIVE_CURRENCY_ADDRESS,
  OrderKind,
  SigningScheme,
  TradingSdk,
  calculateUniqueOrderId,
  getOrderToSign,
  getTradeParametersAfterQuote,
  getEthFlowContract,
  isSupportedChain,
  swapParamsToLimitOrderParams,
  type QuoteResults,
  type QuoteResultsWithSigner,
  type SupportedChainId,
} from "@cowprotocol/cow-sdk";
import { ViemAdapter } from "@cowprotocol/sdk-viem-adapter";
import { z } from "zod";
import {
  erc20Abi,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  createPublicClient,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainMetadata, type NetworkConfig } from "../ethereum";
import { resolveTokenMetadata, resolveTokenQuery } from "../token-metadata";
import { type RuntimeConfig } from "../runtime-config";
import { buildTrustWalletTokenPaths } from "../trustwallet-assets";
import { getSafeUiLink, proposeSafeTransactions } from "./safe";

const SWAP_APP_CODE = "PrivateEthereumAssistant";
const KNOWN_TOKEN_ALIASES: Record<
  number,
  Record<string, Omit<ResolvedSwapToken, "kind" | "source"> & { kind?: "erc20" }>
> = {
  1: {
    USDC: {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      displayAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
  42161: {
    USDC: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      displayAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
  8453: {
    USDC: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      displayAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
};

const swapInputSchema = z.object({
  sellToken: z
    .string()
    .trim()
    .min(1)
    .describe("Token to sell, such as ETH, USDC, or an explicit token contract address."),
  buyToken: z
    .string()
    .trim()
    .min(1)
    .describe("Token to buy, such as USDC, ETH, or an explicit token contract address."),
  amount: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a non-negative token amount.")
    .describe("Exact sell amount as a decimal string, such as 1 or 0.5."),
});

type SwapActor = RuntimeConfig["actor"]["type"];

type SwapChainContext = {
  actor: SwapActor;
  networkConfig: NetworkConfig;
  chain: ReturnType<typeof getChainMetadata>;
};

type ResolvedSwapToken = {
  kind: "native" | "erc20";
  address: Address;
  symbol: string;
  name?: string;
  decimals: number;
  displayAddress?: Address;
  iconUrl?: string;
  source: "native" | "verified" | "onchain";
};

type SwapPlanStep = {
  key: string;
  label: string;
  status: "pending" | "in_progress" | "complete" | "error";
  detail?: string;
};

type SwapQuoteSummary = {
  sellAmount: string;
  buyAmount: string;
  feeAmount: string;
  validTo: string;
  verified: boolean;
  quoteId?: number;
  slippageBps: number;
};

type SwapPlan = {
  type: "swap";
  actor: SwapActor;
  adapter: "cow";
  executionPath:
    | "eoa_direct"
    | "safe_manual"
    | "safe_proposed"
    | "railgun_unsupported";
  chain: {
    id: number;
    name: string;
  };
  sell: {
    amount: string;
    symbol: string;
    name?: string;
    address: string;
    iconUrl?: string;
    kind: "native" | "erc20";
    source: "native" | "verified" | "onchain";
  };
  buy: {
    amount: string;
    symbol: string;
    name?: string;
    address: string;
    iconUrl?: string;
    kind: "native" | "erc20";
    source: "native" | "verified" | "onchain";
  };
  quote: SwapQuoteSummary;
  steps: SwapPlanStep[];
};

type SwapResult = {
  kind: "swap_result";
  status:
    | "executed"
    | "proposed"
    | "manual_action_required"
    | "unsupported"
    | "input_required"
    | "error";
  actor: SwapActor;
  adapter: "cow";
  summary: string;
  message: string;
  chain: {
    id: number;
    name: string;
  };
  plan?: SwapPlan;
  quote?: SwapQuoteSummary;
  execution?: {
    orderId?: string;
    txHash?: string;
    approvalTxHash?: string;
    owner?: string;
    safeAddress?: string;
    safeUILink?: string;
    safeTxHash?: string;
    actionCount?: number;
  };
  candidates?: Array<Record<string, unknown>>;
  error?: string;
};

type SwapToolDependencies = {
  resolveToken?: (options: {
    query: string;
    context: SwapChainContext;
    publicClient: ReturnType<typeof createActorPublicClient>;
  }) => Promise<
    | {
        status: "resolved";
        token: ResolvedSwapToken;
      }
    | {
        status: "input_required" | "error";
        message: string;
        candidates?: Array<Record<string, unknown>>;
      }
  >;
  getQuoteOnly?: (
    actor: SwapActor,
    trade: {
      networkConfig: NetworkConfig;
      chainId: SupportedChainId;
      owner: Address;
      sellToken: ResolvedSwapToken;
      buyToken: ResolvedSwapToken;
      amountAtoms: bigint;
    },
  ) => Promise<QuoteResults>;
  executeEoaSwap?: (options: {
    runtimeConfig: RuntimeConfig;
    context: SwapChainContext;
    owner: Address;
    sellToken: ResolvedSwapToken;
    buyToken: ResolvedSwapToken;
    amountAtoms: bigint;
    quote: QuoteResults;
  }) => Promise<{
    approvalTxHash?: string;
    orderId?: string;
    txHash?: string;
  }>;
  executeSafeSwap?: (options: {
    runtimeConfig: RuntimeConfig;
    context: SwapChainContext;
    owner: Address;
    sellToken: ResolvedSwapToken;
    buyToken: ResolvedSwapToken;
    amountAtoms: bigint;
    requestedSellAmount: string;
  }) => Promise<SwapResult>;
};

function getActorChainContext(runtimeConfig: RuntimeConfig): SwapChainContext {
  switch (runtimeConfig.actor.type) {
    case "safe": {
      const networkConfig = {
        chainId: runtimeConfig.safe.chainId,
        rpcUrl: runtimeConfig.safe.rpcUrl,
      };
      return {
        actor: "safe",
        networkConfig,
        chain: getChainMetadata(networkConfig),
      };
    }
    case "railgun": {
      const networkConfig = {
        chainId: runtimeConfig.railgun.chainId,
        rpcUrl: runtimeConfig.railgun.rpcUrl,
      };
      return {
        actor: "railgun",
        networkConfig,
        chain: getChainMetadata(networkConfig),
      };
    }
    default:
      return {
        actor: "eoa",
        networkConfig: runtimeConfig.network,
        chain: getChainMetadata(runtimeConfig.network),
      };
  }
}

function createActorPublicClient(networkConfig: NetworkConfig) {
  return createPublicClient({
    transport: http(networkConfig.rpcUrl),
  });
}

function isNativeTokenQuery(query: string, chainSymbol: string) {
  const normalized = query.trim().toUpperCase();
  return normalized === "ETH" || normalized === chainSymbol.toUpperCase() || normalized === "NATIVE";
}

async function readOnchainTokenMetadata(
  publicClient: ReturnType<typeof createActorPublicClient>,
  address: Address,
) {
  const [symbol, name, decimals] = await Promise.all([
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: "name",
    }),
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  return {
    symbol,
    name,
    decimals,
  };
}

async function resolveSwapToken(options: {
  query: string;
  context: SwapChainContext;
  publicClient: ReturnType<typeof createActorPublicClient>;
}): Promise<
  | {
      status: "resolved";
      token: ResolvedSwapToken;
    }
  | {
      status: "input_required" | "error";
      message: string;
      candidates?: Array<Record<string, unknown>>;
    }
> {
  const { query, context, publicClient } = options;

  if (isNativeTokenQuery(query, context.chain.nativeSymbol)) {
    return {
      status: "resolved",
      token: {
        kind: "native",
        address: getAddress(EVM_NATIVE_CURRENCY_ADDRESS),
        symbol: context.chain.nativeSymbol,
        name: context.chain.nativeName,
        decimals: 18,
        source: "native",
      },
    };
  }

  const alias =
    KNOWN_TOKEN_ALIASES[context.networkConfig.chainId]?.[query.trim().toUpperCase()];
  if (alias) {
    return {
      status: "resolved",
      token: {
        kind: "erc20",
        address: getAddress(alias.address),
        displayAddress: getAddress(alias.displayAddress ?? alias.address),
        symbol: alias.symbol,
        name: alias.name,
        decimals: alias.decimals,
        iconUrl: buildTrustWalletTokenPaths(
          context.networkConfig.chainId,
          alias.address,
        )?.logoUrl,
        source: "verified",
      },
    };
  }

  if (isAddress(query)) {
    const address = getAddress(query);
    const token = await resolveTokenMetadata({
      chainId: context.networkConfig.chainId,
      address,
      readOnchainMetadata: (tokenAddress) => readOnchainTokenMetadata(publicClient, tokenAddress),
    });

    return {
      status: "resolved",
      token: {
        kind: "erc20",
        address,
        displayAddress: address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals ?? 18,
        iconUrl: token.iconUrl,
        source: token.source === "trustwallet" ? "verified" : "onchain",
      },
    };
  }

  const resolution = await resolveTokenQuery({
    query,
    chainId: context.networkConfig.chainId,
  });

  if (resolution.status === "not_found") {
    return {
      status: "error",
      message: resolution.message,
    };
  }

  if (resolution.status === "ambiguous") {
    return {
      status: "input_required",
      message: resolution.message,
      candidates: resolution.candidates as Array<Record<string, unknown>>,
    };
  }

  return {
    status: "resolved",
    token: {
      kind: "erc20",
      address: resolution.token.address,
      displayAddress: resolution.token.address,
      symbol: resolution.token.symbol,
      name: resolution.token.name,
      decimals: resolution.token.decimals ?? 18,
      iconUrl: resolution.token.iconUrl,
      source: "verified",
    },
  };
}

function getOwnerAddress(runtimeConfig: RuntimeConfig, actor: SwapActor): Address | null {
  if (actor === "safe") {
    return getAddress(runtimeConfig.safe.address);
  }

  const privateKey = runtimeConfig.wallet.eoaPrivateKey.trim();
  if (privateKey) {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  }

  return actor === "railgun" ? getAddress(runtimeConfig.safe.address) : null;
}

function buildQuoteSummary(
  quote: QuoteResults,
  sellToken: ResolvedSwapToken,
  buyToken: ResolvedSwapToken,
): SwapQuoteSummary {
  const quotedOrder = quote.quoteResponse.quote;

  return {
    sellAmount: formatUnits(BigInt(quotedOrder.sellAmount), sellToken.decimals),
    buyAmount: formatUnits(BigInt(quotedOrder.buyAmount), buyToken.decimals),
    feeAmount: formatUnits(BigInt(quotedOrder.feeAmount), sellToken.decimals),
    validTo: quote.quoteResponse.expiration,
    verified: quote.quoteResponse.verified,
    quoteId: quote.quoteResponse.id,
    slippageBps: quote.suggestedSlippageBps,
  };
}

function buildPlan(args: {
  actor: SwapActor;
  context: SwapChainContext;
  sellToken: ResolvedSwapToken;
  buyToken: ResolvedSwapToken;
  requestedSellAmount: string;
  quote: SwapQuoteSummary;
  steps: SwapPlanStep[];
  executionPath?: SwapPlan["executionPath"];
}): SwapPlan {
  const executionPath =
    args.executionPath ??
    (args.actor === "eoa"
      ? "eoa_direct"
      : args.actor === "safe"
        ? "safe_manual"
        : "railgun_unsupported");

  return {
    type: "swap",
    actor: args.actor,
    adapter: "cow",
    executionPath,
    chain: {
      id: args.context.chain.id,
      name: args.context.chain.name,
    },
    sell: {
      amount: args.requestedSellAmount,
      symbol: args.sellToken.symbol,
      name: args.sellToken.name,
      address: args.sellToken.address,
      iconUrl: args.sellToken.iconUrl,
      kind: args.sellToken.kind,
      source: args.sellToken.source,
    },
    buy: {
      amount: args.quote.buyAmount,
      symbol: args.buyToken.symbol,
      name: args.buyToken.name,
      address: args.buyToken.address,
      iconUrl: args.buyToken.iconUrl,
      kind: args.buyToken.kind,
      source: args.buyToken.source,
    },
    quote: args.quote,
    steps: args.steps,
  };
}

async function getCowQuoteOnly(
  actor: SwapActor,
  trade: {
    networkConfig: NetworkConfig;
    chainId: SupportedChainId;
    owner: Address;
    sellToken: ResolvedSwapToken;
    buyToken: ResolvedSwapToken;
    amountAtoms: bigint;
  },
) {
  const adapter = new ViemAdapter({
    provider: createPublicClient({
      transport: http(trade.networkConfig.rpcUrl),
    }),
  });
  const sdk = new TradingSdk(
    {
      chainId: trade.chainId,
      appCode: SWAP_APP_CODE,
    },
    {},
    adapter as never,
  );

  return sdk.getQuoteOnly({
    chainId: trade.chainId,
    kind: OrderKind.SELL,
    owner: trade.owner as `0x${string}`,
    amount: trade.amountAtoms.toString(),
    sellToken: trade.sellToken.address as `0x${string}`,
    sellTokenDecimals: trade.sellToken.decimals,
    buyToken: trade.buyToken.address as `0x${string}`,
    buyTokenDecimals: trade.buyToken.decimals,
    ...(actor === "safe" ? { receiver: trade.owner as `0x${string}` } : {}),
  });
}

function createSafeTradingSdk(options: {
  runtimeConfig: RuntimeConfig;
  context: SwapChainContext;
}) {
  const signerKey = options.runtimeConfig.safe.signerPrivateKey.trim();
  if (!signerKey) {
    return null;
  }

  const signer = privateKeyToAccount(signerKey as `0x${string}`);
  const publicClient = createPublicClient({
    transport: http(options.context.networkConfig.rpcUrl),
  });
  const adapter = new ViemAdapter({
    provider: publicClient,
    signer,
  });
  const sdk = new TradingSdk(
    {
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      appCode: SWAP_APP_CODE,
      signer,
    },
    {},
    adapter as never,
  );

  return {
    signer,
    publicClient,
    adapter,
    sdk,
  };
}

async function getSafeQuoteResults(options: {
  runtimeConfig: RuntimeConfig;
  context: SwapChainContext;
  owner: Address;
  sellToken: ResolvedSwapToken;
  buyToken: ResolvedSwapToken;
  amountAtoms: bigint;
}) {
  const safeSdk = createSafeTradingSdk(options);
  if (!safeSdk) {
    return null;
  }

  const quoteRequest = buildSafeQuoteRequest(options.owner, options.sellToken);

  return safeSdk.sdk.getQuoteResults(
    {
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      kind: OrderKind.SELL,
      owner: options.owner as `0x${string}`,
      amount: options.amountAtoms.toString(),
      sellToken: options.sellToken.address as `0x${string}`,
      sellTokenDecimals: options.sellToken.decimals,
      buyToken: options.buyToken.address as `0x${string}`,
      buyTokenDecimals: options.buyToken.decimals,
      receiver: options.owner as `0x${string}`,
    },
    {
      quoteRequest,
    },
  );
}

export function buildSafeQuoteRequest(
  owner: Address,
  sellToken: ResolvedSwapToken,
): {
  receiver: `0x${string}`;
  signingScheme?: SigningScheme.PRESIGN;
} {
  if (sellToken.kind === "native") {
    return {
      receiver: owner as `0x${string}`,
    };
  }

  return {
    receiver: owner as `0x${string}`,
    signingScheme: SigningScheme.PRESIGN,
  };
}

async function buildSafeEthFlowTransaction(options: {
  quoteResults: QuoteResultsWithSigner;
  chainId: SupportedChainId;
  owner: Address;
  sellTokenAddress: `0x${string}`;
  signer: ReturnType<typeof privateKeyToAccount>;
  adapter: ViemAdapter;
}) {
  const {
    appDataInfo,
    quoteResponse,
    tradeParameters,
  } = options.quoteResults.result;
  const limitTradeParameters = swapParamsToLimitOrderParams(
    getTradeParametersAfterQuote({
      quoteParameters: tradeParameters,
      sellToken: options.sellTokenAddress,
    }),
    quoteResponse,
  );
  const slippageBps =
    limitTradeParameters.slippageBps ??
    options.quoteResults.result.suggestedSlippageBps;
  const adjustedLimitTradeParameters = {
    ...limitTradeParameters,
    slippageBps,
  };
  const orderToSign = getOrderToSign(
    {
      chainId: options.chainId,
      isEthFlow: true,
      from: options.owner,
      networkCostsAmount: quoteResponse.quote.feeAmount,
    },
    adjustedLimitTradeParameters,
    appDataInfo.appDataKeccak256,
  );
  const orderId = await calculateUniqueOrderId(
    options.chainId,
    orderToSign,
    undefined,
    adjustedLimitTradeParameters.env,
  );
  const contract = getEthFlowContract(
    options.adapter.createSigner(options.signer),
    options.chainId,
    adjustedLimitTradeParameters.env,
  );
  const quoteId = adjustedLimitTradeParameters.quoteId;
  if (typeof quoteId !== "number") {
    throw new Error("quoteId is required to build the Safe native-token swap.");
  }

  const ethOrderParams = {
    buyToken: orderToSign.buyToken,
    receiver: orderToSign.receiver,
    sellAmount: orderToSign.sellAmount,
    buyAmount: orderToSign.buyAmount,
    feeAmount: orderToSign.feeAmount,
    partiallyFillable: orderToSign.partiallyFillable,
    quoteId,
    appData: appDataInfo.appDataKeccak256,
    validTo: orderToSign.validTo.toString(),
  };

  await options.quoteResults.orderBookApi.uploadAppData(
    appDataInfo.appDataKeccak256,
    appDataInfo.fullAppData,
  );

  return {
    orderId,
    transaction: {
      to:
        ETH_FLOW_ADDRESSES[options.chainId] ??
        contract.address,
      valueWei: BigInt(orderToSign.sellAmount).toString(),
      data: contract.interface.encodeFunctionData("createOrder", [ethOrderParams]),
    },
  };
}

async function executeCowSafeSwap(options: {
  runtimeConfig: RuntimeConfig;
  context: SwapChainContext;
  owner: Address;
  sellToken: ResolvedSwapToken;
  buyToken: ResolvedSwapToken;
  amountAtoms: bigint;
  requestedSellAmount: string;
}): Promise<SwapResult> {
  const safeSdk = createSafeTradingSdk(options);
  const summary = buildExecutionSummary(
    "safe",
    options.requestedSellAmount,
    options.sellToken,
    options.buyToken,
    options.context.chain.name,
  );

  if (!safeSdk) {
    const fallbackQuote = await getCowQuoteOnly("safe", {
      networkConfig: options.context.networkConfig,
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      owner: options.owner,
      sellToken: options.sellToken,
      buyToken: options.buyToken,
      amountAtoms: options.amountAtoms,
    });
    const quote = buildQuoteSummary(fallbackQuote, options.sellToken, options.buyToken);
    const plan = buildPlan({
      actor: "safe",
      context: options.context,
      sellToken: options.sellToken,
      buyToken: options.buyToken,
      requestedSellAmount: options.requestedSellAmount,
      quote,
      executionPath: "safe_manual",
      steps: [
        {
          key: "quote",
          label: "Fetch CoW quote",
          status: "complete",
          detail: `${quote.buyAmount} ${options.buyToken.symbol} estimated output.`,
        },
        {
          key: "proposal",
          label: "Configure Safe signer",
          status: "pending",
          detail: "Add a Safe signer key to construct and propose the swap transaction automatically.",
        },
      ],
    });

    return {
      kind: "swap_result",
      status: "manual_action_required",
      actor: "safe",
      adapter: "cow",
      summary,
      message:
        "The CoW quote is ready, but this app needs a Safe signer key to create the swap transaction automatically.",
      chain: {
        id: options.context.chain.id,
        name: options.context.chain.name,
      },
      plan,
      quote,
      execution: {
        safeAddress: options.runtimeConfig.safe.address,
        safeUILink: getSafeUiLink(options.runtimeConfig.safe),
      },
    };
  }

  const quoteResults = await getSafeQuoteResults(options);
  if (!quoteResults) {
    throw new Error("Could not prepare the Safe swap signer.");
  }

  if (!process.env.SAFE_API_KEY) {
    const fallbackQuote = buildQuoteSummary(
      quoteResults.result,
      options.sellToken,
      options.buyToken,
    );
    const plan = buildPlan({
      actor: "safe",
      context: options.context,
      sellToken: options.sellToken,
      buyToken: options.buyToken,
      requestedSellAmount: options.requestedSellAmount,
      quote: fallbackQuote,
      executionPath: "safe_manual",
      steps: [
        {
          key: "quote",
          label: "Fetch CoW quote",
          status: "complete",
          detail: `${fallbackQuote.buyAmount} ${options.buyToken.symbol} estimated output.`,
        },
        {
          key: "proposal",
          label: "Configure Safe API key",
          status: "pending",
          detail: "Add a Safe API key so this app can submit the Safe swap proposal automatically.",
        },
      ],
    });

    return {
      kind: "swap_result",
      status: "manual_action_required",
      actor: "safe",
      adapter: "cow",
      summary,
      message:
        "The CoW quote is ready, but this app needs a Safe API key to create the swap transaction automatically.",
      chain: {
        id: options.context.chain.id,
        name: options.context.chain.name,
      },
      plan,
      quote: fallbackQuote,
      execution: {
        safeAddress: options.runtimeConfig.safe.address,
        safeUILink: getSafeUiLink(options.runtimeConfig.safe),
      },
    };
  }

  const quote = buildQuoteSummary(
    quoteResults.result,
    options.sellToken,
    options.buyToken,
  );
  const transactions: Array<{
    to: string;
    valueWei: string;
    valueLabel: string;
    data: string;
    type: string;
    spender?: string;
    tokenAmount?: string;
  }> = [];
  let orderId: string | undefined;

  if (options.sellToken.kind === "erc20") {
    const requiredAllowance =
      BigInt(quoteResults.result.quoteResponse.quote.sellAmount) +
      BigInt(quoteResults.result.quoteResponse.quote.feeAmount);
    const allowance = await safeSdk.sdk.getCowProtocolAllowance({
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      tokenAddress: options.sellToken.address as `0x${string}`,
      owner: options.owner as `0x${string}`,
    });

    if (allowance < requiredAllowance) {
      const vaultRelayer = COW_PROTOCOL_VAULT_RELAYER_ADDRESS[
        options.context.networkConfig.chainId as SupportedChainId
      ];
      transactions.push({
        to: options.sellToken.address,
        valueWei: "0",
        valueLabel: "0 ETH",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vaultRelayer as `0x${string}`, requiredAllowance],
        }),
        type: "ERC-20 approve",
        spender: vaultRelayer,
        tokenAmount: `${formatUnits(requiredAllowance, options.sellToken.decimals)} ${options.sellToken.symbol}`,
      });
    }

    const postResult = await safeSdk.sdk.postSwapOrder(
      {
        chainId: options.context.networkConfig.chainId as SupportedChainId,
        kind: OrderKind.SELL,
        owner: options.owner as `0x${string}`,
        amount: options.amountAtoms.toString(),
        sellToken: options.sellToken.address as `0x${string}`,
        sellTokenDecimals: options.sellToken.decimals,
        buyToken: options.buyToken.address as `0x${string}`,
        buyTokenDecimals: options.buyToken.decimals,
        receiver: options.owner as `0x${string}`,
      },
      {
        quoteRequest: {
          receiver: options.owner as `0x${string}`,
          signingScheme: SigningScheme.PRESIGN,
        },
      },
    );

    orderId = postResult.orderId;

    const preSignTransaction = await safeSdk.sdk.getPreSignTransaction({
      orderUid: postResult.orderId,
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      signer: safeSdk.signer,
    });

    transactions.push({
      to: preSignTransaction.to,
      valueWei: preSignTransaction.value,
      valueLabel: "0 ETH",
      data: preSignTransaction.data,
      type: "CoW pre-sign",
    });
  } else {
    const ethFlowTransaction = await buildSafeEthFlowTransaction({
      quoteResults,
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      owner: options.owner,
      sellTokenAddress: options.sellToken.address as `0x${string}`,
      signer: safeSdk.signer,
      adapter: safeSdk.adapter,
    });

    orderId = ethFlowTransaction.orderId;
    transactions.push({
      to: ethFlowTransaction.transaction.to,
      valueWei: ethFlowTransaction.transaction.valueWei,
      valueLabel: `${quote.sellAmount} ${options.sellToken.symbol}`,
      data: ethFlowTransaction.transaction.data,
      type: "CoW native swap",
    });
  }

  const safeProposal = await proposeSafeTransactions(options.runtimeConfig.safe, {
    transactions,
    summary,
    proposedMessage:
      transactions.length > 1
        ? "Safe swap transaction bundle proposed. Remaining owners can review and sign it in the Safe UI."
        : "Safe swap transaction proposed. Remaining owners can review and sign it in the Safe UI.",
    manualNoSignerMessage:
      "The CoW quote is ready, but this app needs a Safe signer key to create the Safe swap proposal automatically.",
    manualNoApiKeyMessage:
      "The CoW quote is ready, but this app needs a Safe API key to propose the Safe swap transaction automatically.",
    origin: "Private Ethereum Assistant · Safe swap",
  });

  const safeProposalRecord = safeProposal as Record<string, unknown>;
  const status = String(safeProposalRecord.status ?? "");
  const actionCount =
    typeof safeProposalRecord.actionCount === "number"
      ? safeProposalRecord.actionCount
      : transactions.length;
  const safeTxHash =
    typeof safeProposalRecord.safeTxHash === "string"
      ? safeProposalRecord.safeTxHash
      : undefined;
  const safeUILink =
    typeof safeProposalRecord.safeUILink === "string"
      ? safeProposalRecord.safeUILink
      : undefined;
  const safeAddress =
    typeof safeProposalRecord.safeAddress === "string"
      ? safeProposalRecord.safeAddress
      : options.runtimeConfig.safe.address;

  const plan = buildPlan({
    actor: "safe",
    context: options.context,
    sellToken: options.sellToken,
    buyToken: options.buyToken,
    requestedSellAmount: options.requestedSellAmount,
    quote,
    executionPath: status === "proposed" ? "safe_proposed" : "safe_manual",
    steps: [
      {
        key: "quote",
        label: "Fetch CoW quote",
        status: "complete",
        detail: `${quote.buyAmount} ${options.buyToken.symbol} estimated output.`,
      },
      ...(transactions.length > 1
        ? [
            {
              key: "approval",
              label: "Batch Safe approval",
              status: "complete" as const,
              detail: "The Safe transaction bundle includes the ERC-20 approval required for CoW settlement.",
            },
          ]
        : []),
      {
        key: "proposal",
        label: status === "proposed" ? "Safe transaction proposed" : "Continue in Safe",
        status: status === "proposed" ? "complete" : "pending",
        detail:
          status === "proposed"
            ? `Safe bundle ready with ${actionCount} action${actionCount === 1 ? "" : "s"}.`
            : "Open the Safe UI to create or review the swap transaction manually.",
      },
    ],
  });

  return {
    kind: "swap_result",
    status: status === "proposed" ? "proposed" : "manual_action_required",
    actor: "safe",
    adapter: "cow",
    summary,
    message:
      typeof safeProposalRecord.message === "string"
        ? safeProposalRecord.message
        : "Safe swap action prepared.",
    chain: {
      id: options.context.chain.id,
      name: options.context.chain.name,
    },
    plan,
    quote,
    execution: {
      orderId,
      safeAddress,
      safeUILink,
      safeTxHash,
      actionCount,
    },
  };
}

async function executeCowEoaSwap(options: {
  runtimeConfig: RuntimeConfig;
  context: SwapChainContext;
  owner: Address;
  sellToken: ResolvedSwapToken;
  buyToken: ResolvedSwapToken;
  amountAtoms: bigint;
  quote: QuoteResults;
}) {
  const signer = privateKeyToAccount(options.runtimeConfig.wallet.eoaPrivateKey as `0x${string}`);
  const publicClient = createPublicClient({
    transport: http(options.context.networkConfig.rpcUrl),
  });
  const adapter = new ViemAdapter({
    provider: publicClient,
    signer,
  });
  const sdk = new TradingSdk(
    {
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      appCode: SWAP_APP_CODE,
      signer,
    },
    {},
    adapter as never,
  );

  let approvalTxHash: string | undefined;

  if (options.sellToken.kind === "erc20") {
    const requiredAllowance =
      BigInt(options.quote.quoteResponse.quote.sellAmount) +
      BigInt(options.quote.quoteResponse.quote.feeAmount);
    const allowance = await sdk.getCowProtocolAllowance({
      chainId: options.context.networkConfig.chainId as SupportedChainId,
      tokenAddress: options.sellToken.address as `0x${string}`,
      owner: options.owner as `0x${string}`,
    });

    if (allowance < requiredAllowance) {
      approvalTxHash = await sdk.approveCowProtocol({
        chainId: options.context.networkConfig.chainId as SupportedChainId,
        tokenAddress: options.sellToken.address as `0x${string}`,
        amount: requiredAllowance,
      });
    }
  }

  const tradeParameters = {
    chainId: options.context.networkConfig.chainId as SupportedChainId,
    kind: OrderKind.SELL,
    owner: options.owner as `0x${string}`,
    amount: options.amountAtoms.toString(),
    sellToken: options.sellToken.address as `0x${string}`,
    sellTokenDecimals: options.sellToken.decimals,
    buyToken: options.buyToken.address as `0x${string}`,
    buyTokenDecimals: options.buyToken.decimals,
  };

  const postResult =
    options.sellToken.kind === "native"
      ? await sdk.postSellNativeCurrencyOrder(tradeParameters)
      : await sdk.postSwapOrder(tradeParameters);

  return {
    approvalTxHash,
    orderId: postResult.orderId,
    txHash: postResult.txHash,
  };
}

function buildExecutionSummary(
  actor: SwapActor,
  amount: string,
  sellToken: ResolvedSwapToken,
  buyToken: ResolvedSwapToken,
  chainName: string,
) {
  const baseSummary = `Swap ${amount} ${sellToken.symbol} for ${buyToken.symbol} on ${chainName}`;

  if (actor === "safe") {
    return `${baseSummary} in Safe mode`;
  }

  if (actor === "railgun") {
    return `${baseSummary} in Private mode`;
  }

  return baseSummary;
}
export function createSwapTools(
  runtimeConfig: RuntimeConfig,
  dependencies: SwapToolDependencies = {},
) {
  const resolveToken = dependencies.resolveToken ?? resolveSwapToken;
  const getQuoteOnly = dependencies.getQuoteOnly ?? getCowQuoteOnly;
  const executeEoaSwap = dependencies.executeEoaSwap ?? executeCowEoaSwap;
  const executeSafeSwap = dependencies.executeSafeSwap ?? executeCowSafeSwap;

  const swapTokens = tool({
    description:
      "Plan and execute a CoW-backed swap behind one mode-aware abstraction. Use this for prompts like 'Swap 1 ETH for USDC'. The tool resolves tokens, fetches a CoW quote, then executes differently for EOA, Safe, and Private mode.",
    inputSchema: swapInputSchema,
    execute: async ({ sellToken, buyToken, amount }): Promise<SwapResult> => {
      const context = getActorChainContext(runtimeConfig);

      if (!isSupportedChain(context.networkConfig.chainId)) {
        return {
          kind: "swap_result",
          status: "error",
          actor: context.actor,
          adapter: "cow",
          summary: "Swap routing unavailable",
          message: `CoW swap support is not available on chain ID ${context.networkConfig.chainId}.`,
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          error: `Unsupported CoW chain ${context.networkConfig.chainId}.`,
        };
      }

      const publicClient = createActorPublicClient(context.networkConfig);
      const [resolvedSellToken, resolvedBuyToken] = await Promise.all([
        resolveToken({
          query: sellToken,
          context,
          publicClient,
        }),
        resolveToken({
          query: buyToken,
          context,
          publicClient,
        }),
      ]);

      if (resolvedSellToken.status !== "resolved") {
        return {
          kind: "swap_result",
          status: resolvedSellToken.status,
          actor: context.actor,
          adapter: "cow",
          summary: "Need a clearer sell token",
          message: resolvedSellToken.message,
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          candidates: resolvedSellToken.candidates,
          error: resolvedSellToken.status === "error" ? resolvedSellToken.message : undefined,
        };
      }

      if (resolvedBuyToken.status !== "resolved") {
        return {
          kind: "swap_result",
          status: resolvedBuyToken.status,
          actor: context.actor,
          adapter: "cow",
          summary: "Need a clearer buy token",
          message: resolvedBuyToken.message,
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          candidates: resolvedBuyToken.candidates,
          error: resolvedBuyToken.status === "error" ? resolvedBuyToken.message : undefined,
        };
      }

      if (resolvedSellToken.token.address === resolvedBuyToken.token.address) {
        return {
          kind: "swap_result",
          status: "error",
          actor: context.actor,
          adapter: "cow",
          summary: "Swap routing failed",
          message: "Sell token and buy token resolved to the same asset. Choose two different assets.",
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          error: "Sell token and buy token must differ.",
        };
      }

      let amountAtoms: bigint;
      try {
        amountAtoms = parseUnits(amount, resolvedSellToken.token.decimals);
      } catch {
        return {
          kind: "swap_result",
          status: "error",
          actor: context.actor,
          adapter: "cow",
          summary: "Swap routing failed",
          message: `Could not parse ${amount} ${resolvedSellToken.token.symbol}.`,
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          error: `Invalid amount ${amount}.`,
        };
      }

      if (amountAtoms <= 0n) {
        return {
          kind: "swap_result",
          status: "error",
          actor: context.actor,
          adapter: "cow",
          summary: "Swap routing failed",
          message: "Swap amount must be greater than zero.",
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          error: "Amount must be greater than zero.",
        };
      }

      const owner = getOwnerAddress(runtimeConfig, context.actor);
      if (!owner) {
        return {
          kind: "swap_result",
          status: "error",
          actor: context.actor,
          adapter: "cow",
          summary: "Swap execution needs a signer",
          message: "Configure an EOA private key before using the EOA or Railgun swap path.",
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          error: "Missing EOA signer.",
        };
      }

      try {
        const quoteResults = await getQuoteOnly(context.actor, {
          networkConfig: context.networkConfig,
          chainId: context.networkConfig.chainId as SupportedChainId,
          owner,
          sellToken: resolvedSellToken.token,
          buyToken: resolvedBuyToken.token,
          amountAtoms,
        });
        const quote = buildQuoteSummary(
          quoteResults,
          resolvedSellToken.token,
          resolvedBuyToken.token,
        );
        const summary = buildExecutionSummary(
          context.actor,
          amount,
          resolvedSellToken.token,
          resolvedBuyToken.token,
          context.chain.name,
        );

        if (context.actor === "safe") {
          return executeSafeSwap({
            runtimeConfig,
            context,
            owner,
            sellToken: resolvedSellToken.token,
            buyToken: resolvedBuyToken.token,
            amountAtoms,
            requestedSellAmount: amount,
          });
        }

        if (context.actor === "railgun") {
          const plan = buildPlan({
            actor: context.actor,
            context,
            sellToken: resolvedSellToken.token,
            buyToken: resolvedBuyToken.token,
            requestedSellAmount: amount,
            quote,
            steps: [
              {
                key: "quote",
                label: "Fetch CoW quote",
                status: "complete",
                detail: `${quote.buyAmount} ${resolvedBuyToken.token.symbol} estimated output.`,
              },
              {
                key: "private-routing",
                label: "Check private routing",
                status: "error",
                detail:
                  "Private Railgun swap routing is not supported yet. Switch to EOA mode for the same public route.",
              },
            ],
          });

          return {
            kind: "swap_result",
            status: "unsupported",
            actor: context.actor,
            adapter: "cow",
            summary,
            message:
              "Private Railgun swap execution is not supported yet. The quote below is a public CoW route; switch to EOA mode to execute it.",
            chain: {
              id: context.chain.id,
              name: context.chain.name,
            },
            plan,
            quote,
          };
        }

        const execution = await executeEoaSwap({
          runtimeConfig,
          context,
          owner,
          sellToken: resolvedSellToken.token,
          buyToken: resolvedBuyToken.token,
          amountAtoms,
          quote: quoteResults,
        });
        const approvalDetail = execution.approvalTxHash
          ? `Approval tx ${execution.approvalTxHash} was submitted before posting the CoW order.`
          : "No ERC-20 approval transaction was needed for this swap.";
        const plan = buildPlan({
          actor: context.actor,
          context,
          sellToken: resolvedSellToken.token,
          buyToken: resolvedBuyToken.token,
          requestedSellAmount: amount,
          quote,
          steps: [
            {
              key: "quote",
              label: "Fetch CoW quote",
              status: "complete",
              detail: `${quote.buyAmount} ${resolvedBuyToken.token.symbol} estimated output.`,
            },
            {
              key: "approval",
              label: "Handle token approval",
              status: "complete",
              detail: approvalDetail,
            },
            {
              key: "execution",
              label: "Post CoW order",
              status: "complete",
              detail: execution.orderId
                ? `Order ${execution.orderId} is live in the CoW order book.`
                : "Swap order posted.",
            },
          ],
        });

        return {
          kind: "swap_result",
          status: "executed",
          actor: context.actor,
          adapter: "cow",
          summary,
          message: execution.orderId
            ? "The swap order was signed and submitted to CoW."
            : "The swap flow completed, but no order ID was returned.",
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          plan,
          quote,
          execution: {
            orderId: execution.orderId,
            txHash: execution.txHash,
            approvalTxHash: execution.approvalTxHash,
            owner,
          },
        };
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Could not route the swap through CoW.";

        return {
          kind: "swap_result",
          status: "error",
          actor: context.actor,
          adapter: "cow",
          summary: "Swap routing failed",
          message,
          chain: {
            id: context.chain.id,
            name: context.chain.name,
          },
          error: message,
        };
      }
    },
  });

  return {
    swapTokens,
  };
}
