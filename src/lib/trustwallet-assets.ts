import { getAddress, type Address } from "viem";
import { getChainDefinition } from "./ethereum";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SupportedTrustWalletChainId =
  | 1
  | 10
  | 8453
  | 42161;

export type TrustWalletChainSlug =
  | "ethereum"
  | "optimism"
  | "base"
  | "arbitrum";

export type TrustWalletTokenInfo = {
  name?: string;
  symbol?: string;
  type?: string;
  decimals?: number;
  description?: string;
  website?: string;
  explorer?: string;
  status?: string;
  id?: string;
  tags?: string[];
  links?: Array<{ name?: string; url?: string }>;
};

export type TrustWalletTokenListEntry = {
  asset?: string;
  type?: string;
  address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  logoURI?: string;
};

export type TrustWalletTokenList = {
  tokens?: TrustWalletTokenListEntry[];
};

export type NormalizedToken = {
  chainId: number;
  chainName: string;
  chainSlug?: TrustWalletChainSlug;
  address: Address;
  asset?: string;
  symbol: string;
  name?: string;
  decimals?: number | null;
  iconUrl?: string;
  metadataUrl?: string;
  source: "trustwallet" | "onchain";
  verified: boolean;
};

export const TRUSTWALLET_RAW_BASE =
  "https://raw.githubusercontent.com/trustwallet/assets/master";

const CHAIN_SLUG_BY_ID: Record<
  SupportedTrustWalletChainId,
  TrustWalletChainSlug
> = {
  1: "ethereum",
  10: "optimism",
  8453: "base",
  42161: "arbitrum",
};

const SUPPORTED_CHAIN_IDS = Object.keys(CHAIN_SLUG_BY_ID).map((chainId) =>
  Number(chainId),
) as SupportedTrustWalletChainId[];

const metadataCache = new Map<string, Promise<TrustWalletTokenInfo | null>>();
const urlExistsCache = new Map<string, Promise<boolean>>();

function getOrCreateCacheEntry<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  loader: () => Promise<T>,
) {
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

export function clearTrustWalletAssetCache() {
  metadataCache.clear();
  urlExistsCache.clear();
}

export function getSupportedTrustWalletChainIds() {
  return [...SUPPORTED_CHAIN_IDS];
}

export function normalizeEvmAddress(address: string): Address {
  return getAddress(address.trim());
}

export function getTrustWalletChainSlug(
  chainId: number,
): TrustWalletChainSlug | undefined {
  return CHAIN_SLUG_BY_ID[chainId as SupportedTrustWalletChainId];
}

export function getTrustWalletChainName(chainId: number) {
  return getChainDefinition(chainId)?.name ?? `Chain ${chainId}`;
}

export function buildTrustWalletChainPaths(chainId: number) {
  const chainSlug = getTrustWalletChainSlug(chainId);
  if (!chainSlug) return undefined;

  const basePath = `blockchains/${chainSlug}`;
  return {
    chainSlug,
    basePath,
    infoUrl: `${TRUSTWALLET_RAW_BASE}/${basePath}/info/info.json`,
    logoUrl: `${TRUSTWALLET_RAW_BASE}/${basePath}/info/logo.png`,
    tokenListUrl: `${TRUSTWALLET_RAW_BASE}/${basePath}/tokenlist.json`,
    tokenListExtendedUrl: `${TRUSTWALLET_RAW_BASE}/${basePath}/tokenlist-extended.json`,
  };
}

export function buildTrustWalletTokenPaths(chainId: number, address: string) {
  const chainPaths = buildTrustWalletChainPaths(chainId);
  if (!chainPaths) return undefined;

  const checksumAddress = normalizeEvmAddress(address);
  const basePath = `${chainPaths.basePath}/assets/${checksumAddress}`;

  return {
    ...chainPaths,
    checksumAddress,
    basePath,
    metadataUrl: `${TRUSTWALLET_RAW_BASE}/${basePath}/info.json`,
    logoUrl: `${TRUSTWALLET_RAW_BASE}/${basePath}/logo.png`,
  };
}

export async function urlExists(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  return getOrCreateCacheEntry(urlExistsCache, url, async () => {
    const response = await fetchImpl(url, { method: "HEAD" });
    if (response.ok) return true;
    if (response.status === 404) return false;
    if (response.status === 405) {
      const fallbackResponse = await fetchImpl(url, { method: "GET" });
      return fallbackResponse.ok;
    }
    return false;
  });
}

export async function fetchTrustWalletMetadata(
  chainId: number,
  address: string,
  fetchImpl: FetchLike = fetch,
): Promise<TrustWalletTokenInfo | null> {
  const paths = buildTrustWalletTokenPaths(chainId, address);
  if (!paths) return null;

  return getOrCreateCacheEntry(
    metadataCache,
    `${chainId}:${paths.checksumAddress}`,
    async () => {
      const response = await fetchImpl(paths.metadataUrl, {
        headers: { accept: "application/json" },
      });

      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `Trust Wallet metadata fetch failed with status ${response.status}.`,
        );
      }

      return (await response.json()) as TrustWalletTokenInfo;
    },
  );
}

export async function normalizeTrustWalletToken(
  chainId: number,
  address: string,
  fetchImpl: FetchLike = fetch,
): Promise<NormalizedToken | null> {
  const paths = buildTrustWalletTokenPaths(chainId, address);
  if (!paths) return null;

  const metadata = await fetchTrustWalletMetadata(chainId, address, fetchImpl);
  if (!metadata) return null;

  const hasIcon = await urlExists(paths.logoUrl, fetchImpl);

  return {
    chainId,
    chainName: getTrustWalletChainName(chainId),
    chainSlug: paths.chainSlug,
    address: paths.checksumAddress,
    symbol: metadata.symbol?.trim() || paths.checksumAddress,
    name: metadata.name?.trim() || undefined,
    decimals: typeof metadata.decimals === "number" ? metadata.decimals : null,
    iconUrl: hasIcon ? paths.logoUrl : undefined,
    metadataUrl: paths.metadataUrl,
    source: "trustwallet",
    verified: true,
  };
}
