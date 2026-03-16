import { tool } from "ai";
import {
  EVM_NATIVE_CURRENCY_ADDRESS,
  OrderKind,
  TradingSdk,
  isSupportedChain,
  type QuoteResults,
  type SupportedChainId,
} from "@cowprotocol/cow-sdk";
import { ViemAdapter } from "@cowprotocol/sdk-viem-adapter";
import { z } from "zod";
import {
  erc20Abi,
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
import { getSafeUiLink } from "./safe";

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
  executionPath: "eoa_direct" | "safe_manual" | "railgun_unsupported";
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
}): SwapPlan {
  const executionPath =
    args.actor === "eoa"
      ? "eoa_direct"
      : args.actor === "safe"
        ? "safe_manual"
        : "railgun_unsupported";

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
    return `${baseSummary} through the Safe actor`;
  }

  if (actor === "railgun") {
    return `${baseSummary} from the Railgun actor`;
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

  const swapTokens = tool({
    description:
      "Plan and execute a CoW-backed swap behind one actor-aware abstraction. Use this for prompts like 'Swap 1 ETH for USDC'. The tool resolves tokens, fetches a CoW quote, then executes differently for EOA, Safe, and Railgun.",
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
                key: "proposal",
                label: "Continue in Safe",
                status: "pending",
                detail: "Open the Safe UI and use the native CoW swap flow with this quote context.",
              },
            ],
          });

          return {
            kind: "swap_result",
            status: "manual_action_required",
            actor: context.actor,
            adapter: "cow",
            summary,
            message:
              "The CoW quote is ready, but Safe-native CoW proposal submission is not automated here yet. Continue in the Safe UI for approval and signing.",
            chain: {
              id: context.chain.id,
              name: context.chain.name,
            },
            plan,
            quote,
            execution: {
              safeAddress: runtimeConfig.safe.address,
              safeUILink: getSafeUiLink(runtimeConfig.safe),
            },
          };
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
                  "Private Railgun swap routing is not supported yet. Use the EOA actor for the same public route.",
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
              "Private Railgun swap execution is not supported yet. The quote below is a public CoW route; switch the actor to EOA to execute it.",
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
