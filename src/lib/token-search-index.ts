import { type Address } from "viem";
import {
  buildTrustWalletChainPaths,
  buildTrustWalletTokenPaths,
  getSupportedTrustWalletChainIds,
  getTrustWalletChainName,
  normalizeEvmAddress,
  type FetchLike,
  type NormalizedToken,
  type TrustWalletTokenList,
  type TrustWalletTokenListEntry,
} from "./trustwallet-assets";

export type TokenMatchKind =
  | "exact_symbol"
  | "exact_name"
  | "prefix_symbol"
  | "prefix_name"
  | "substring_symbol"
  | "substring_name";

export type TokenSearchCandidate = NormalizedToken & {
  matchKind: TokenMatchKind;
  score: number;
};

type CachedTokenList = {
  fetchedAt: number;
  tokens: NormalizedToken[];
};

const TOKENLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const tokenListCache = new Map<number, Promise<CachedTokenList>>();

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreMatch(kind: TokenMatchKind) {
  switch (kind) {
    case "exact_symbol":
      return 600;
    case "exact_name":
      return 500;
    case "prefix_symbol":
      return 400;
    case "prefix_name":
      return 300;
    case "substring_symbol":
      return 200;
    case "substring_name":
      return 100;
  }
}

function getMatchKind(
  token: NormalizedToken,
  normalizedQuery: string,
): TokenMatchKind | null {
  const symbol = normalizeSearchTerm(token.symbol);
  const name = normalizeSearchTerm(token.name ?? "");

  if (symbol === normalizedQuery) return "exact_symbol";
  if (name && name === normalizedQuery) return "exact_name";
  if (symbol.startsWith(normalizedQuery)) return "prefix_symbol";
  if (name && name.startsWith(normalizedQuery)) return "prefix_name";
  if (symbol.includes(normalizedQuery)) return "substring_symbol";
  if (name && name.includes(normalizedQuery)) return "substring_name";
  return null;
}

function compareCandidates(a: TokenSearchCandidate, b: TokenSearchCandidate) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.symbol.length !== b.symbol.length) return a.symbol.length - b.symbol.length;
  return a.address.localeCompare(b.address);
}

function normalizeTokenListEntry(
  chainId: number,
  entry: TrustWalletTokenListEntry,
): NormalizedToken | null {
  let address: Address;

  try {
    address = normalizeEvmAddress(entry.address);
  } catch {
    return null;
  }

  const paths = buildTrustWalletTokenPaths(chainId, address);

  return {
    chainId,
    chainName: getTrustWalletChainName(chainId),
    chainSlug: paths?.chainSlug,
    address,
    asset: entry.asset,
    symbol: entry.symbol?.trim() || address,
    name: entry.name?.trim() || undefined,
    decimals: typeof entry.decimals === "number" ? entry.decimals : null,
    iconUrl: paths?.logoUrl ?? entry.logoURI,
    metadataUrl: paths?.metadataUrl,
    source: "trustwallet",
    verified: true,
  };
}

async function fetchTokenList(
  chainId: number,
  fetchImpl: FetchLike,
): Promise<NormalizedToken[]> {
  const chainPaths = buildTrustWalletChainPaths(chainId);
  if (!chainPaths) return [];

  const response = await fetchImpl(chainPaths.tokenListUrl, {
    headers: { accept: "application/json" },
  });

  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(
      `Trust Wallet token list fetch failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as TrustWalletTokenList;
  return (payload.tokens ?? [])
    .map((entry) => normalizeTokenListEntry(chainId, entry))
    .filter((token): token is NormalizedToken => Boolean(token));
}

export function clearTokenSearchIndexCache() {
  tokenListCache.clear();
}

export async function getChainTokenSearchIndex(
  chainId: number,
  options?: {
    fetchImpl?: FetchLike;
    now?: number;
  },
) {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = options?.now ?? Date.now();
  const cached = tokenListCache.get(chainId);

  if (cached) {
    let resolved: CachedTokenList;
    try {
      resolved = await cached;
    } catch (error) {
      tokenListCache.delete(chainId);
      throw error;
    }

    if (now - resolved.fetchedAt < TOKENLIST_CACHE_TTL_MS) {
      return resolved.tokens;
    }
    tokenListCache.delete(chainId);
  }

  const pending = fetchTokenList(chainId, fetchImpl)
    .then((tokens) => ({
      fetchedAt: now,
      tokens,
    }))
    .catch((error) => {
      tokenListCache.delete(chainId);
      throw error;
    });
  tokenListCache.set(chainId, pending);
  return (await pending).tokens;
}

export async function searchTrustWalletTokens(options: {
  query: string;
  chainId?: number;
  limit?: number;
  fetchImpl?: FetchLike;
  now?: number;
}) {
  const normalizedQuery = normalizeSearchTerm(options.query);
  if (!normalizedQuery) return [] as TokenSearchCandidate[];

  const chainIds =
    typeof options.chainId === "number"
      ? [options.chainId]
      : getSupportedTrustWalletChainIds();

  const indexes = await Promise.all(
    chainIds.map((chainId) =>
      getChainTokenSearchIndex(chainId, {
        fetchImpl: options.fetchImpl,
        now: options.now,
      }),
    ),
  );

  const candidates = indexes
    .flat()
    .flatMap((token) => {
      const matchKind = getMatchKind(token, normalizedQuery);
      if (!matchKind) return [];

      return [
        {
          ...token,
          matchKind,
          score: scoreMatch(matchKind),
        },
      ];
    })
    .sort(compareCandidates);

  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    const key = `${candidate.chainId}:${candidate.address.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, options.limit ?? 5);
}
