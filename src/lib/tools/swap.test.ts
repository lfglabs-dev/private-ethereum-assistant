import { describe, expect, test } from "bun:test";
import { SigningScheme } from "@cowprotocol/cow-sdk";
import type { QuoteResults } from "@cowprotocol/cow-sdk";
import { createDefaultRuntimeConfig } from "../runtime-config";
import { buildSafeQuoteRequest, createSwapTools } from "./swap";

const ETH_TOKEN = {
  kind: "native" as const,
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  symbol: "ETH",
  decimals: 18,
  source: "native" as const,
};

const USDC_TOKEN = {
  kind: "erc20" as const,
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  displayAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
  source: "verified" as const,
};

function createRuntimeConfig(actor: "eoa" | "safe" | "railgun") {
  const runtimeConfig = createDefaultRuntimeConfig();

  return {
    ...runtimeConfig,
    network: {
      chainId: 42161,
      rpcUrl: "https://arb1.arbitrum.io/rpc",
    },
    safe: {
      ...runtimeConfig.safe,
      address: "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
      chainId: 8453,
      rpcUrl: "https://mainnet.base.org",
    },
    wallet: {
      ...runtimeConfig.wallet,
      eoaPrivateKey:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    actor: {
      type: actor,
    },
  };
}

function createQuoteResults(): QuoteResults {
  return {
    tradeParameters: {} as QuoteResults["tradeParameters"],
    suggestedSlippageBps: 50,
    amountsAndCosts: {} as QuoteResults["amountsAndCosts"],
    orderToSign: {} as QuoteResults["orderToSign"],
    appDataInfo: {} as QuoteResults["appDataInfo"],
    orderTypedData: {} as QuoteResults["orderTypedData"],
    quoteResponse: {
      from: "0x1111111111111111111111111111111111111111",
      expiration: "2026-03-15T12:00:00.000Z",
      id: 42,
      verified: true,
      quote: {
        sellToken: ETH_TOKEN.address,
        buyToken: USDC_TOKEN.address,
        receiver: "0x1111111111111111111111111111111111111111",
        sellAmount: "1000000000000000000",
        buyAmount: "2500000",
        feeAmount: "1000000000000000",
        validTo: 1_800_000_000,
        appData: "0x0",
        kind: "sell",
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
      },
    } as QuoteResults["quoteResponse"],
  };
}

const executionResult = {
  approvalTxHash: "0xapproval",
  orderId: "cow-order-1",
  txHash: "0xorder",
};

async function executeSwap(actor: "eoa" | "safe" | "railgun") {
  const runtimeConfig = createRuntimeConfig(actor);
  const tools = createSwapTools(runtimeConfig, {
    resolveToken: async ({ query }) => {
      if (query.toUpperCase() === "ETH") {
        return {
          status: "resolved",
          token: ETH_TOKEN,
        };
      }

      if (query.toUpperCase() === "USDC") {
        return {
          status: "resolved",
          token: USDC_TOKEN,
        };
      }

      return {
        status: "error",
        message: `Unknown token ${query}`,
      };
    },
    getQuoteOnly: async () => createQuoteResults(),
    executeEoaSwap: async () => executionResult,
  });

  if (!tools.swapTokens.execute) {
    throw new Error("swapTokens tool should be executable.");
  }

  return tools.swapTokens.execute(
    {
      sellToken: "ETH",
      buyToken: "USDC",
      amount: "1",
    },
    {
      toolCallId: crypto.randomUUID(),
      messages: [],
    },
  );
}

function asSwapResult(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    Symbol.asyncIterator in value
  ) {
    throw new Error("Expected swap tool to return a plain result object.");
  }

  return value as {
    kind: string;
    status: string;
    actor: string;
    plan?: {
      executionPath?: string;
    };
    execution?: {
      orderId?: string;
      approvalTxHash?: string;
      safeAddress?: string;
      safeUILink?: string;
    };
    quote?: {
      buyAmount?: string;
    };
    candidates?: unknown[];
  };
}

describe("swap tool", () => {
  test("uses a presign quote request only for Safe ERC-20 sells", () => {
    const owner = "0x1111111111111111111111111111111111111111";

    expect(buildSafeQuoteRequest(owner, ETH_TOKEN)).toEqual({
      receiver: owner,
    });
    expect(buildSafeQuoteRequest(owner, USDC_TOKEN)).toEqual({
      receiver: owner,
      signingScheme: SigningScheme.PRESIGN,
    });
  });

  test("executes the EOA actor path and returns a canonical plan", async () => {
    const result = asSwapResult(await executeSwap("eoa"));

    expect(result.kind).toBe("swap_result");
    expect(result.status).toBe("executed");
    expect(result.actor).toBe("eoa");
    expect(result.plan?.executionPath).toBe("eoa_direct");
    expect(result.execution?.orderId).toBe("cow-order-1");
    expect(result.execution?.approvalTxHash).toBe("0xapproval");
  });

  test("returns a Safe manual continuation plan", async () => {
    const runtimeConfig = createRuntimeConfig("safe");
    const tools = createSwapTools(runtimeConfig, {
      resolveToken: async ({ query }) => {
        if (query.toUpperCase() === "ETH") {
          return {
            status: "resolved",
            token: ETH_TOKEN,
          };
        }

        if (query.toUpperCase() === "USDC") {
          return {
            status: "resolved",
            token: USDC_TOKEN,
          };
        }

        return {
          status: "error",
          message: `Unknown token ${query}`,
        };
      },
      getQuoteOnly: async () => createQuoteResults(),
      executeSafeSwap: async () => ({
        kind: "swap_result",
        status: "manual_action_required",
        actor: "safe",
        adapter: "cow",
        summary: "Swap 1 ETH for USDC in Safe mode",
        message: "The CoW quote is ready, but this app needs a Safe signer key to create the swap transaction automatically.",
        chain: {
          id: 8453,
          name: "Base",
        },
        plan: {
          type: "swap",
          actor: "safe",
          adapter: "cow",
          executionPath: "safe_manual",
          chain: {
            id: 8453,
            name: "Base",
          },
          sell: {
            amount: "1",
            symbol: "ETH",
            address: ETH_TOKEN.address,
            kind: "native",
            source: "native",
          },
          buy: {
            amount: "2500",
            symbol: "USDC",
            address: USDC_TOKEN.address,
            kind: "erc20",
            source: "verified",
          },
          quote: {
            sellAmount: "1",
            buyAmount: "2500",
            feeAmount: "0.001",
            validTo: "2026-03-15T12:00:00.000Z",
            verified: true,
            slippageBps: 50,
          },
          steps: [],
        },
        quote: {
          sellAmount: "1",
          buyAmount: "2500",
          feeAmount: "0.001",
          validTo: "2026-03-15T12:00:00.000Z",
          verified: true,
          slippageBps: 50,
        },
        execution: {
          safeAddress: "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
        },
      }),
    });

    if (!tools.swapTokens.execute) {
      throw new Error("swapTokens tool should be executable.");
    }

    const result = asSwapResult(await tools.swapTokens.execute(
      {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      },
      {
        toolCallId: crypto.randomUUID(),
        messages: [],
      },
    ));

    expect(result.kind).toBe("swap_result");
    expect(result.status).toBe("manual_action_required");
    expect(result.actor).toBe("safe");
    expect(result.plan?.executionPath).toBe("safe_manual");
    expect(result.execution?.safeAddress).toBe("0x4581812Df7500277e3fC72CF93f766DBBd32d371");
  });

  test("returns a Safe proposed plan when automatic proposal succeeds", async () => {
    const runtimeConfig = {
      ...createRuntimeConfig("safe"),
      safe: {
        ...createRuntimeConfig("safe").safe,
        signerPrivateKey:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    };
    const tools = createSwapTools(runtimeConfig, {
      resolveToken: async ({ query }) => {
        if (query.toUpperCase() === "ETH") {
          return {
            status: "resolved",
            token: ETH_TOKEN,
          };
        }

        if (query.toUpperCase() === "USDC") {
          return {
            status: "resolved",
            token: USDC_TOKEN,
          };
        }

        return {
          status: "error",
          message: `Unknown token ${query}`,
        };
      },
      getQuoteOnly: async () => createQuoteResults(),
      executeSafeSwap: async () => ({
        kind: "swap_result",
        status: "proposed",
        actor: "safe",
        adapter: "cow",
        summary: "Swap 1 ETH for USDC on Base in Safe mode",
        message: "Safe swap transaction proposed.",
        chain: {
          id: 8453,
          name: "Base",
        },
        plan: {
          type: "swap",
          actor: "safe",
          adapter: "cow",
          executionPath: "safe_proposed",
          chain: {
            id: 8453,
            name: "Base",
          },
          sell: {
            amount: "1",
            symbol: "ETH",
            address: ETH_TOKEN.address,
            kind: "native",
            source: "native",
          },
          buy: {
            amount: "2500",
            symbol: "USDC",
            address: USDC_TOKEN.address,
            kind: "erc20",
            source: "verified",
          },
          quote: {
            sellAmount: "1",
            buyAmount: "2500",
            feeAmount: "0.001",
            validTo: "2026-03-15T12:00:00.000Z",
            verified: true,
            slippageBps: 50,
          },
          steps: [],
        },
        quote: {
          sellAmount: "1",
          buyAmount: "2500",
          feeAmount: "0.001",
          validTo: "2026-03-15T12:00:00.000Z",
          verified: true,
          slippageBps: 50,
        },
        execution: {
          orderId: "cow-order-safe",
          safeAddress: "0x4581812Df7500277e3fC72CF93f766DBBd32d371",
          safeUILink: "https://app.safe.global/transactions/queue?safe=base:0x4581812Df7500277e3fC72CF93f766DBBd32d371",
          safeTxHash: "0xsafeproposal",
          actionCount: 2,
        },
      }),
    });

    if (!tools.swapTokens.execute) {
      throw new Error("swapTokens tool should be executable.");
    }

    const result = asSwapResult(await tools.swapTokens.execute(
      {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      },
      {
        toolCallId: crypto.randomUUID(),
        messages: [],
      },
    ));

    expect(result.kind).toBe("swap_result");
    expect(result.status).toBe("proposed");
    expect(result.actor).toBe("safe");
    expect(result.plan?.executionPath).toBe("safe_proposed");
    expect(result.execution?.safeAddress).toBe("0x4581812Df7500277e3fC72CF93f766DBBd32d371");
    expect(result.execution?.safeUILink).toContain("app.safe.global");
  });

  test("returns a Railgun unsupported plan with the same quote shape", async () => {
    const result = asSwapResult(await executeSwap("railgun"));

    expect(result.kind).toBe("swap_result");
    expect(result.status).toBe("unsupported");
    expect(result.actor).toBe("railgun");
    expect(result.plan?.executionPath).toBe("railgun_unsupported");
    expect(result.quote?.buyAmount).toBe("2.5");
  });

  test("asks for clearer token input when resolution is ambiguous", async () => {
    const runtimeConfig = createRuntimeConfig("eoa");
    const tools = createSwapTools(runtimeConfig, {
      resolveToken: async ({ query }) => {
        if (query.toUpperCase() === "ETH") {
          return {
            status: "resolved",
            token: ETH_TOKEN,
          };
        }

        return {
          status: "input_required",
          message: "USDC matches multiple verified tokens on Arbitrum.",
          candidates: [
            {
              address: USDC_TOKEN.address,
              symbol: "USDC",
              chainName: "Arbitrum One",
              source: "verified",
            },
          ],
        };
      },
      getQuoteOnly: async () => createQuoteResults(),
      executeEoaSwap: async () => executionResult,
    });

    if (!tools.swapTokens.execute) {
      throw new Error("swapTokens tool should be executable.");
    }

    const result = asSwapResult(await tools.swapTokens.execute(
      {
        sellToken: "ETH",
        buyToken: "USDC",
        amount: "1",
      },
      {
        toolCallId: crypto.randomUUID(),
        messages: [],
      },
    ));

    expect(result.kind).toBe("swap_result");
    expect(result.status).toBe("input_required");
    expect(result.candidates?.length).toBe(1);
  });
});
