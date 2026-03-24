import type { Address } from "viem";
import { getAddress, isAddress } from "viem";
import { resolveTokenQuery, type TokenQueryResolution } from "./token-metadata";
import { buildTrustWalletTokenPaths } from "./trustwallet-assets";

export type TokenAliasEntry = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
};

export const TOKEN_ALIASES: Record<number, Record<string, TokenAliasEntry>> = {
  1: {
    USDC: {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
  42161: {
    USDC: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
  8453: {
    USDC: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
};

export type ResolvedToken = {
  address: Address;
  symbol: string;
  name?: string;
  decimals: number;
  iconUrl?: string;
  source: "alias" | "verified" | "onchain";
};

export type TokenResolutionResult =
  | { status: "resolved"; token: ResolvedToken }
  | { status: "error"; message: string; candidates?: Array<Record<string, unknown>> };

export function lookupTokenAlias(
  chainId: number,
  symbol: string,
): TokenAliasEntry | undefined {
  return TOKEN_ALIASES[chainId]?.[symbol.trim().toUpperCase()];
}

export function getTokenAliasAddress(
  chainId: number,
  symbol: string,
): Address | undefined {
  return lookupTokenAlias(chainId, symbol)?.address;
}

export async function resolveTokenBySymbolOrAddress(
  query: string,
  chainId: number,
  nativeSymbol: string,
): Promise<TokenResolutionResult> {
  const trimmed = query.trim();

  if (
    trimmed.toUpperCase() === "ETH" ||
    trimmed.toUpperCase() === nativeSymbol.toUpperCase() ||
    trimmed.toUpperCase() === "NATIVE"
  ) {
    return {
      status: "resolved",
      token: {
        address: "0x0000000000000000000000000000000000000000" as Address,
        symbol: nativeSymbol,
        name: nativeSymbol,
        decimals: 18,
        source: "alias",
      },
    };
  }

  const alias = lookupTokenAlias(chainId, trimmed);
  if (alias) {
    return {
      status: "resolved",
      token: {
        address: getAddress(alias.address),
        symbol: alias.symbol,
        name: alias.name,
        decimals: alias.decimals,
        iconUrl: buildTrustWalletTokenPaths(chainId, alias.address)?.logoUrl,
        source: "alias",
      },
    };
  }

  if (isAddress(trimmed)) {
    return {
      status: "resolved",
      token: {
        address: getAddress(trimmed),
        symbol: trimmed,
        decimals: 18,
        source: "onchain",
      },
    };
  }

  const resolution = await resolveTokenQuery({ query: trimmed, chainId });

  if (resolution.status === "resolved") {
    return {
      status: "resolved",
      token: {
        address: resolution.token.address,
        symbol: resolution.token.symbol,
        name: resolution.token.name,
        decimals: resolution.token.decimals ?? 18,
        iconUrl: resolution.token.iconUrl,
        source: "verified",
      },
    };
  }

  if (resolution.status === "ambiguous") {
    return {
      status: "error",
      message: resolution.message,
      candidates: resolution.candidates as Array<Record<string, unknown>>,
    };
  }

  return {
    status: "error",
    message: resolution.message,
  };
}
