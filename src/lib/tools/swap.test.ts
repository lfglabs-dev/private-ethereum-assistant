import { describe, expect, test } from "bun:test";
import type { QuoteResults } from "@cowprotocol/cow-sdk";
import { createDefaultRuntimeConfig } from "../runtime-config";
import { createSwapTools } from "./swap";

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
    const result = asSwapResult(await executeSwap("safe"));

    expect(result.kind).toBe("swap_result");
    expect(result.status).toBe("manual_action_required");
    expect(result.actor).toBe("safe");
    expect(result.plan?.executionPath).toBe("safe_manual");
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
