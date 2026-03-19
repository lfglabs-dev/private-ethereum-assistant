import { beforeEach, describe, expect, test } from "bun:test";
import { resolveTokenMetadata, resolveTokenQuery } from "./token-metadata";
import { clearTokenSearchIndexCache } from "./token-search-index";
import { clearTrustWalletAssetCache, type FetchLike } from "./trustwallet-assets";

function createTokenList(tokens: Array<Record<string, unknown>>) {
  return new Response(
    JSON.stringify({
      name: "Test list",
      tokens,
    }),
    {
      headers: { "content-type": "application/json" },
    },
  );
}

describe("token-metadata", () => {
  beforeEach(() => {
    clearTokenSearchIndexCache();
    clearTrustWalletAssetCache();
  });

  test("falls back to on-chain metadata when Trust Wallet has no entry", async () => {
    const fetchMock: FetchLike = async () => new Response(null, { status: 404 });

    const token = await resolveTokenMetadata({
      chainId: 8453,
      address: "0x4200000000000000000000000000000000000006",
      fetchImpl: fetchMock,
      readOnchainMetadata: async () => ({
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
      }),
    });

    expect(token).toEqual({
      chainId: 8453,
      chainName: "Base",
      address: "0x4200000000000000000000000000000000000006",
      symbol: 'data("WETH")',
      name: 'data("Wrapped Ether")',
      decimals: 18,
      source: "onchain",
      verified: false,
    });
  });

  test("returns disambiguation candidates for an ambiguous cross-chain symbol", async () => {
    const fetchMock: FetchLike = async (input) => {
      const url = String(input);

      if (url.includes("/blockchains/base/tokenlist.json")) {
        return createTokenList([
          {
            address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
          },
        ]);
      }

      if (url.includes("/blockchains/ethereum/tokenlist.json")) {
        return createTokenList([
          {
            address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
          },
        ]);
      }

      return createTokenList([]);
    };

    const resolution = await resolveTokenQuery({
      query: "USDC",
      fetchImpl: fetchMock,
      now: 1,
    });

    expect(resolution.status).toBe("ambiguous");
    if (resolution.status !== "ambiguous") {
      throw new Error("Expected an ambiguous resolution.");
    }

    expect(resolution.candidates).toHaveLength(2);
    expect(resolution.message).toContain("multiple verified tokens");
  });
});
