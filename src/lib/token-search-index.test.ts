import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearTokenSearchIndexCache,
  getChainTokenSearchIndex,
  searchTrustWalletTokens,
} from "./token-search-index";
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

describe("token-search-index", () => {
  beforeEach(() => {
    clearTokenSearchIndexCache();
    clearTrustWalletAssetCache();
  });

  test("caches token lists and prefers exact symbol matches", async () => {
    let fetchCount = 0;
    const fetchMock: FetchLike = async (input) => {
      fetchCount += 1;
      const url = String(input);

      if (!url.includes("/blockchains/base/tokenlist.json")) {
        throw new Error(`Unexpected request: ${url}`);
      }

      return createTokenList([
        {
          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
        },
        {
          address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
          symbol: "USDbC",
          name: "USD Base Coin",
          decimals: 6,
        },
      ]);
    };

    const [first, second] = await Promise.all([
      getChainTokenSearchIndex(8453, { fetchImpl: fetchMock, now: 1 }),
      getChainTokenSearchIndex(8453, { fetchImpl: fetchMock, now: 2 }),
    ]);
    const matches = await searchTrustWalletTokens({
      chainId: 8453,
      query: "USDC",
      fetchImpl: fetchMock,
      now: 3,
    });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(fetchCount).toBe(1);
    expect(matches[0]?.symbol).toBe("USDC");
    expect(matches[0]?.matchKind).toBe("exact_symbol");
  });

  test("returns cross-chain matches for ambiguous symbols", async () => {
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

      if (url.includes("/blockchains/arbitrum/tokenlist.json")) {
        return createTokenList([
          {
            address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
          },
        ]);
      }

      return createTokenList([]);
    };

    const matches = await searchTrustWalletTokens({
      query: "USDC",
      fetchImpl: fetchMock,
      now: 1,
    });

    expect(matches.map((match) => `${match.chainName}:${match.address}`)).toEqual([
      "Base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "Arbitrum One:0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    ]);
  });
});
