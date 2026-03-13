import { beforeEach, describe, expect, test } from "bun:test";
import {
  buildTrustWalletTokenPaths,
  clearTrustWalletAssetCache,
  fetchTrustWalletMetadata,
  getTrustWalletChainSlug,
  normalizeTrustWalletToken,
  urlExists,
  type FetchLike,
} from "./trustwallet-assets";

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("trustwallet-assets", () => {
  beforeEach(() => {
    clearTrustWalletAssetCache();
  });

  test("maps supported chain ids and builds checksum token paths", () => {
    const paths = buildTrustWalletTokenPaths(
      8453,
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    );

    expect(getTrustWalletChainSlug(42161)).toBe("arbitrum");
    expect(paths?.checksumAddress).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
    expect(paths?.metadataUrl).toContain(
      "blockchains/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/info.json",
    );
  });

  test("returns null when metadata is missing and false when a logo is missing", async () => {
    const fetchMock: FetchLike = async (_input, init) => {
      const method = init?.method ?? "GET";
      return new Response(null, { status: method === "HEAD" ? 404 : 404 });
    };

    const metadata = await fetchTrustWalletMetadata(
      8453,
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      fetchMock,
    );
    const hasLogo = await urlExists(
      "https://raw.githubusercontent.com/trustwallet/assets/master/missing.png",
      fetchMock,
    );

    expect(metadata).toBeNull();
    expect(hasLogo).toBe(false);
  });

  test("normalizes verified token metadata and omits a missing icon", async () => {
    const fetchMock: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/info.json")) {
        return createJsonResponse({
          name: "USD Coin",
          symbol: "USDC",
          decimals: 6,
        });
      }

      if (init?.method === "HEAD" && url.endsWith("/logo.png")) {
        return new Response(null, { status: 404 });
      }

      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    };

    const token = await normalizeTrustWalletToken(
      8453,
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      fetchMock,
    );

    expect(token).toEqual({
      chainId: 8453,
      chainName: "Base",
      chainSlug: "base",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      iconUrl: undefined,
      metadataUrl:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/info.json",
      source: "trustwallet",
      verified: true,
    });
  });
});
