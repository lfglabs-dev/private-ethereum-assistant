import type { Address, PublicClient } from "viem";
import { USDC_ADDRESSES } from "./top-tokens";

const uniswapV3FactoryAbi = [
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ name: "pool", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const uniswapV3PoolAbi = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

const UNISWAP_V3_FACTORY: Record<number, Address> = {
  1: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  8453: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  42161: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  10: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
};

type PriceCache = Map<string, { price: number | null; fetchedAt: number }>;
const priceCache: PriceCache = new Map();
const PRICE_CACHE_TTL_MS = 60_000;

function getCacheKey(chainId: number, tokenAddress: Address): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function getCachedPrice(chainId: number, tokenAddress: Address): number | null | undefined {
  const entry = priceCache.get(getCacheKey(chainId, tokenAddress));
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > PRICE_CACHE_TTL_MS) {
    priceCache.delete(getCacheKey(chainId, tokenAddress));
    return undefined;
  }
  return entry.price;
}

function setCachedPrice(chainId: number, tokenAddress: Address, price: number | null): void {
  priceCache.set(getCacheKey(chainId, tokenAddress), { price, fetchedAt: Date.now() });
}

function computePriceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  tokenDecimals: number,
  usdcDecimals: number,
  tokenIsToken0: boolean,
): number {
  // price = (sqrtPriceX96 / 2^96)^2
  // This gives price of token0 in terms of token1
  // price = token1/token0
  const Q96 = 2n ** 96n;

  // Use high precision: multiply sqrtPriceX96 by a large factor before dividing
  const PRECISION = 10n ** 18n;
  const sqrtPriceScaled = (sqrtPriceX96 * PRECISION) / Q96;
  const priceScaled = (sqrtPriceScaled * sqrtPriceScaled) / PRECISION;

  // priceScaled = price of token0 in token1 * PRECISION
  // We need to adjust for decimals: actual_price = raw_price * 10^(token0Decimals - token1Decimals)
  const priceAsNumber = Number(priceScaled) / Number(PRECISION);

  if (tokenIsToken0) {
    // price = token1Amount / token0Amount (already in terms of USDC per token)
    // Adjust for decimal difference
    const decimalAdjustment = 10 ** (tokenDecimals - usdcDecimals);
    return priceAsNumber * decimalAdjustment;
  } else {
    // token is token1, so we need 1/price
    if (priceAsNumber === 0) return 0;
    const decimalAdjustment = 10 ** (usdcDecimals - tokenDecimals);
    return (1 / priceAsNumber) * decimalAdjustment;
  }
}

export type TokenPriceRequest = {
  tokenAddress: Address;
  tokenDecimals: number;
  poolFee: number;
};

export type TokenPriceResult = {
  tokenAddress: Address;
  priceUsd: number | null;
};

export async function fetchTokenPrices(
  publicClient: PublicClient,
  chainId: number,
  requests: TokenPriceRequest[],
): Promise<TokenPriceResult[]> {
  const factoryAddress = UNISWAP_V3_FACTORY[chainId];
  const usdcInfo = USDC_ADDRESSES[chainId];

  if (!factoryAddress || !usdcInfo) {
    return requests.map((r) => ({ tokenAddress: r.tokenAddress, priceUsd: null }));
  }

  // Filter out requests that are cached or don't need pricing
  const results: TokenPriceResult[] = [];
  const uncachedRequests: { index: number; request: TokenPriceRequest }[] = [];

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];

    // If the token IS USDC, price is $1
    if (req.tokenAddress.toLowerCase() === usdcInfo.address.toLowerCase()) {
      results[i] = { tokenAddress: req.tokenAddress, priceUsd: 1 };
      continue;
    }

    const cached = getCachedPrice(chainId, req.tokenAddress);
    if (cached !== undefined) {
      results[i] = { tokenAddress: req.tokenAddress, priceUsd: cached };
      continue;
    }

    uncachedRequests.push({ index: i, request: req });
  }

  if (uncachedRequests.length === 0) return results;

  // Batch getPool calls via multicall
  let poolAddresses: (Address | null)[];
  try {
    const poolResults = await publicClient.multicall({
      contracts: uncachedRequests.map(({ request }) => ({
        address: factoryAddress,
        abi: uniswapV3FactoryAbi,
        functionName: "getPool" as const,
        args: [request.tokenAddress, usdcInfo.address, request.poolFee] as const,
      })),
      allowFailure: true,
    });

    poolAddresses = poolResults.map((result) => {
      if (result.status === "success" && result.result !== ZERO_ADDRESS) {
        return result.result as Address;
      }
      return null;
    });
  } catch {
    // If multicall fails entirely, return null for all uncached
    for (const { index, request } of uncachedRequests) {
      results[index] = { tokenAddress: request.tokenAddress, priceUsd: null };
      setCachedPrice(chainId, request.tokenAddress, null);
    }
    return results;
  }

  // Batch slot0 calls for pools that exist
  const slot0Requests: { uncachedIndex: number; poolAddress: Address }[] = [];
  for (let i = 0; i < uncachedRequests.length; i++) {
    const poolAddress = poolAddresses[i];
    if (poolAddress) {
      slot0Requests.push({ uncachedIndex: i, poolAddress });
    } else {
      const { index, request } = uncachedRequests[i];
      results[index] = { tokenAddress: request.tokenAddress, priceUsd: null };
      setCachedPrice(chainId, request.tokenAddress, null);
    }
  }

  if (slot0Requests.length === 0) return results;

  try {
    const slot0Results = await publicClient.multicall({
      contracts: slot0Requests.map(({ poolAddress }) => ({
        address: poolAddress,
        abi: uniswapV3PoolAbi,
        functionName: "slot0" as const,
      })),
      allowFailure: true,
    });

    for (let i = 0; i < slot0Requests.length; i++) {
      const { uncachedIndex } = slot0Requests[i];
      const { index, request } = uncachedRequests[uncachedIndex];
      const slot0Result = slot0Results[i];

      if (slot0Result.status !== "success" || !slot0Result.result) {
        results[index] = { tokenAddress: request.tokenAddress, priceUsd: null };
        setCachedPrice(chainId, request.tokenAddress, null);
        continue;
      }

      const sqrtPriceX96 = slot0Result.result[0] as bigint;
      if (sqrtPriceX96 === 0n) {
        results[index] = { tokenAddress: request.tokenAddress, priceUsd: null };
        setCachedPrice(chainId, request.tokenAddress, null);
        continue;
      }

      // Determine token0/token1 ordering (lower address is token0)
      const tokenIsToken0 =
        request.tokenAddress.toLowerCase() < usdcInfo.address.toLowerCase();

      const price = computePriceFromSqrtPriceX96(
        sqrtPriceX96,
        request.tokenDecimals,
        usdcInfo.decimals,
        tokenIsToken0,
      );

      results[index] = { tokenAddress: request.tokenAddress, priceUsd: price };
      setCachedPrice(chainId, request.tokenAddress, price);
    }
  } catch {
    for (const { uncachedIndex } of slot0Requests) {
      const { index, request } = uncachedRequests[uncachedIndex];
      if (!results[index]) {
        results[index] = { tokenAddress: request.tokenAddress, priceUsd: null };
        setCachedPrice(chainId, request.tokenAddress, null);
      }
    }
  }

  return results;
}
