import type { Address } from "viem";
import {
  getTrustWalletChainName,
  normalizeEvmAddress,
  normalizeTrustWalletToken,
  type FetchLike,
  type NormalizedToken,
} from "./trustwallet-assets";
import {
  searchTrustWalletTokens,
  type TokenSearchCandidate,
} from "./token-search-index";
import { formatUntrustedDataLiteral } from "./untrusted-data";

export type OnchainTokenMetadata = {
  symbol: string;
  name?: string;
  decimals: number | null;
};

export type TokenQueryResolution =
  | {
      status: "resolved";
      token: TokenSearchCandidate;
    }
  | {
      status: "ambiguous";
      message: string;
      candidates: TokenSearchCandidate[];
    }
  | {
      status: "not_found";
      message: string;
    };

function formatChainScope(chainId?: number) {
  return typeof chainId === "number"
    ? `on ${getTrustWalletChainName(chainId)}`
    : "across supported networks";
}

export async function resolveTokenQuery(options: {
  query: string;
  chainId?: number;
  fetchImpl?: FetchLike;
  limit?: number;
  now?: number;
}): Promise<TokenQueryResolution> {
  const candidates = await searchTrustWalletTokens(options);
  const scope = formatChainScope(options.chainId);
  const query = options.query.trim();

  if (candidates.length === 0) {
    return {
      status: "not_found",
      message: `No verified token matched "${query}" ${scope}. Provide a token contract address instead.`,
    };
  }

  const exactSymbolMatches = candidates.filter(
    (candidate) => candidate.matchKind === "exact_symbol",
  );
  if (exactSymbolMatches.length === 1) {
    return {
      status: "resolved",
      token: exactSymbolMatches[0],
    };
  }
  if (exactSymbolMatches.length > 1) {
    return {
      status: "ambiguous",
      message: `"${query}" matches multiple verified tokens ${scope}. Choose a contract address from the candidates below.`,
      candidates: exactSymbolMatches.slice(0, options.limit ?? 5),
    };
  }

  const exactNameMatches = candidates.filter(
    (candidate) => candidate.matchKind === "exact_name",
  );
  if (exactNameMatches.length === 1) {
    return {
      status: "resolved",
      token: exactNameMatches[0],
    };
  }
  if (exactNameMatches.length > 1) {
    return {
      status: "ambiguous",
      message: `"${query}" matches multiple verified token names ${scope}. Choose a contract address from the candidates below.`,
      candidates: exactNameMatches.slice(0, options.limit ?? 5),
    };
  }

  return {
    status: "ambiguous",
    message: `Found verified token candidates for "${query}" ${scope}. Confirm the contract address to avoid guessing.`,
    candidates,
  };
}

export async function resolveTokenMetadata(options: {
  chainId: number;
  address: string;
  readOnchainMetadata: (address: Address) => Promise<OnchainTokenMetadata>;
  fetchImpl?: FetchLike;
}): Promise<NormalizedToken> {
  const checksumAddress = normalizeEvmAddress(options.address);

  try {
    const trustWalletToken = await normalizeTrustWalletToken(
      options.chainId,
      checksumAddress,
      options.fetchImpl,
    );
    if (trustWalletToken) {
      return trustWalletToken;
    }
  } catch {
    // Direct metadata lookups should never block on-chain balance reads.
  }

  const onchain = await options.readOnchainMetadata(checksumAddress);

  return {
    chainId: options.chainId,
    chainName: getTrustWalletChainName(options.chainId),
    address: checksumAddress,
    symbol: formatUntrustedDataLiteral(onchain.symbol, 32, checksumAddress),
    name: onchain.name
      ? formatUntrustedDataLiteral(onchain.name, 64, "")
      : undefined,
    decimals: onchain.decimals,
    source: "onchain",
    verified: false,
  };
}
