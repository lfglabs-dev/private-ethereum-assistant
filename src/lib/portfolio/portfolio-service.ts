import { type Address, erc20Abi, formatUnits } from "viem";
import { createEthereumContext, type NetworkConfig, getChainMetadata } from "../ethereum";
import { createEnsService } from "../ens";
import { buildTrustWalletTokenPaths } from "../trustwallet-assets";
import { getPortfolioTokens, USDC_ADDRESSES, type PortfolioTokenEntry } from "./top-tokens";
import { fetchTokenPrices, type TokenPriceRequest } from "./uniswap-price";
import { formatWithGrouping } from "../tools/read-chain";

export type PortfolioToken = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  balance: string;
  formattedBalance: string;
  usdPrice: number | null;
  usdValue: number | null;
  iconUrl: string | undefined;
  isNative: boolean;
};

export type RailgunSyncInfo = {
  lastSyncAt: string | null;
  syncStatus: string | null;
  freshness: {
    source: string;
    updatedAt: string;
    ageMs: number;
    refreshing: boolean;
  } | null;
};

export type PortfolioData = {
  chainId: number;
  chainName: string;
  walletAddress: string;
  ensName: string | null;
  totalUsdValue: number;
  tokens: PortfolioToken[];
  fetchedAt: number;
  railgunSync?: RailgunSyncInfo;
};

function getTokenIconUrl(chainId: number, tokenAddress: string): string | undefined {
  const paths = buildTrustWalletTokenPaths(chainId, tokenAddress);
  return paths?.logoUrl;
}

export async function fetchPortfolio(
  walletAddress: Address,
  networkConfig: NetworkConfig,
): Promise<PortfolioData> {
  const { publicClient } = createEthereumContext(networkConfig);
  const chainMetadata = getChainMetadata(networkConfig);
  const tokenEntries = getPortfolioTokens(networkConfig.chainId);

  if (tokenEntries.length === 0) {
    // Unsupported chain — return native balance only
    let nativeBalance = 0n;
    try {
      nativeBalance = await publicClient.getBalance({ address: walletAddress });
    } catch {}

    const formattedNative = formatWithGrouping(formatUnits(nativeBalance, 18));

    return {
      chainId: networkConfig.chainId,
      chainName: chainMetadata.name,
      walletAddress,
      ensName: null,
      totalUsdValue: 0,
      tokens: [
        {
          symbol: chainMetadata.nativeSymbol,
          name: chainMetadata.nativeName,
          address: "native",
          decimals: 18,
          balance: nativeBalance.toString(),
          formattedBalance: formattedNative,
          usdPrice: null,
          usdValue: null,
          iconUrl: undefined,
          isNative: true,
        },
      ],
      fetchedAt: Date.now(),
    };
  }

  // Separate native and ERC-20 tokens
  const nativeEntry = tokenEntries.find((t) => t.address === "native");
  const erc20Entries = tokenEntries.filter((t) => t.address !== "native");

  // Fetch everything in parallel
  const [nativeBalance, erc20Balances, prices, ensResult] = await Promise.all([
    // Native balance
    nativeEntry
      ? publicClient.getBalance({ address: walletAddress }).catch(() => 0n)
      : Promise.resolve(0n),

    // ERC-20 balances via multicall
    erc20Entries.length > 0
      ? publicClient
          .multicall({
            contracts: erc20Entries.map((token) => ({
              address: token.address as Address,
              abi: erc20Abi,
              functionName: "balanceOf" as const,
              args: [walletAddress] as const,
            })),
            allowFailure: true,
          })
          .catch(() => erc20Entries.map(() => ({ status: "failure" as const, error: new Error("multicall failed"), result: undefined })))
      : Promise.resolve([]),

    // Token prices via Uniswap V3
    fetchTokenPrices(
      publicClient,
      networkConfig.chainId,
      tokenEntries
        .filter((t) => !t.isStablecoin && t.poolFee > 0)
        .map((t): TokenPriceRequest => ({
          tokenAddress: (t.address === "native" ? t.wrappedAddress! : t.address) as Address,
          tokenDecimals: t.decimals,
          poolFee: t.poolFee,
        })),
    ),

    // ENS reverse resolution (only on mainnet, but try anyway)
    createEnsService()
      .reverseResolveAddress(walletAddress)
      .then((r) => r.name)
      .catch(() => null),
  ]);

  // Build price lookup map
  const priceMap = new Map<string, number | null>();
  for (const priceResult of prices) {
    priceMap.set(priceResult.tokenAddress.toLowerCase(), priceResult.priceUsd);
  }

  // Assemble tokens
  const tokens: PortfolioToken[] = [];

  // Native token
  if (nativeEntry) {
    const formattedBalance = formatWithGrouping(formatUnits(nativeBalance, nativeEntry.decimals));
    const priceAddress = nativeEntry.wrappedAddress?.toLowerCase();
    const usdPrice = priceAddress ? (priceMap.get(priceAddress) ?? null) : null;
    const balanceNum = Number(formatUnits(nativeBalance, nativeEntry.decimals));
    const usdValue = usdPrice !== null ? balanceNum * usdPrice : null;

    tokens.push({
      symbol: nativeEntry.symbol,
      name: nativeEntry.name,
      address: "native",
      decimals: nativeEntry.decimals,
      balance: nativeBalance.toString(),
      formattedBalance,
      usdPrice,
      usdValue,
      iconUrl: nativeEntry.wrappedAddress
        ? getTokenIconUrl(networkConfig.chainId, nativeEntry.wrappedAddress)
        : undefined,
      isNative: true,
    });
  }

  // ERC-20 tokens
  for (let i = 0; i < erc20Entries.length; i++) {
    const entry = erc20Entries[i];
    const balanceResult = erc20Balances[i];
    const balance =
      balanceResult && balanceResult.status === "success" && balanceResult.result != null
        ? (balanceResult.result as bigint)
        : 0n;

    const formattedBalance = formatWithGrouping(formatUnits(balance, entry.decimals));
    const balanceNum = Number(formatUnits(balance, entry.decimals));

    let usdPrice: number | null;
    let usdValue: number | null;

    if (entry.isStablecoin) {
      usdPrice = 1;
      usdValue = balanceNum;
    } else {
      usdPrice = priceMap.get((entry.address as string).toLowerCase()) ?? null;
      usdValue = usdPrice !== null ? balanceNum * usdPrice : null;
    }

    tokens.push({
      symbol: entry.symbol,
      name: entry.name,
      address: entry.address as string,
      decimals: entry.decimals,
      balance: balance.toString(),
      formattedBalance,
      usdPrice,
      usdValue,
      iconUrl: getTokenIconUrl(networkConfig.chainId, entry.address as string),
      isNative: false,
    });
  }

  // Sort: non-zero USD value descending, then non-zero balance without price, then zero balance
  tokens.sort((a, b) => {
    const aHasValue = a.usdValue !== null && a.usdValue > 0;
    const bHasValue = b.usdValue !== null && b.usdValue > 0;
    if (aHasValue && bHasValue) return b.usdValue! - a.usdValue!;
    if (aHasValue) return -1;
    if (bHasValue) return 1;

    const aHasBalance = a.balance !== "0";
    const bHasBalance = b.balance !== "0";
    if (aHasBalance && !bHasBalance) return -1;
    if (!aHasBalance && bHasBalance) return 1;
    return 0;
  });

  const totalUsdValue = tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);

  return {
    chainId: networkConfig.chainId,
    chainName: chainMetadata.name,
    walletAddress,
    ensName: ensResult,
    totalUsdValue,
    tokens,
    fetchedAt: Date.now(),
  };
}

export async function fetchRailgunPortfolio(
  networkConfig: NetworkConfig,
): Promise<PortfolioData> {
  const { railgunBalance } = await import("@/lib/railgun");
  const { getAppMode } = await import("../runtime-config");
  const appMode = getAppMode();

  // Build the Railgun config the same way the warmup route does, so the
  // fingerprint always matches the already-locked singleton.
  let railgunRuntimeConfig;
  if (appMode === "developer") {
    const { createDeveloperRuntimeConfig } = await import("../env-secrets");
    railgunRuntimeConfig = await createDeveloperRuntimeConfig();
  } else {
    const { createStandardRuntimeConfig } = await import("../server-runtime-config");
    const { selectedRuntimeConfig } = await createStandardRuntimeConfig({});
    railgunRuntimeConfig = selectedRuntimeConfig;
  }

  const railgunToolConfig = {
    ...railgunRuntimeConfig.railgun,
    signerPrivateKey: railgunRuntimeConfig.wallet.eoaPrivateKey,
  };

  const result = await railgunBalance(undefined, railgunToolConfig);

  if (!("railgun" in result) || result.status !== "success" || result.operation !== "balance") {
    const message = "message" in result ? (result.message as string) : "Railgun balance fetch failed";
    throw new Error(message);
  }

  const { railgunAddress, balances, scan, freshness } = result;
  const chainMetadata = getChainMetadata(networkConfig);
  const tokenEntries = getPortfolioTokens(networkConfig.chainId);

  // Build a lookup map: lowercase token address → PortfolioTokenEntry.
  // Native entries take priority over ERC-20 entries with the same wrapped
  // address (e.g. ETH native vs WETH share the same contract address).
  const entryByAddress = new Map<string, PortfolioTokenEntry>();
  for (const entry of tokenEntries) {
    const addr = entry.address === "native" ? entry.wrappedAddress : entry.address;
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (!entryByAddress.has(key) || entry.address === "native") {
      entryByAddress.set(key, entry);
    }
  }

  // Collect price requests for tokens we know about
  const { publicClient } = createEthereumContext(networkConfig);
  const priceRequests: TokenPriceRequest[] = [];
  for (const row of balances) {
    const entry = entryByAddress.get(row.tokenAddress.toLowerCase());
    if (entry && !entry.isStablecoin && entry.poolFee > 0) {
      const priceAddr = entry.address === "native" ? entry.wrappedAddress! : entry.address;
      priceRequests.push({
        tokenAddress: priceAddr as Address,
        tokenDecimals: entry.decimals,
        poolFee: entry.poolFee,
      });
    }
  }

  const prices = await fetchTokenPrices(publicClient, networkConfig.chainId, priceRequests);
  const priceMap = new Map<string, number | null>();
  for (const p of prices) {
    priceMap.set(p.tokenAddress.toLowerCase(), p.priceUsd);
  }

  const tokens: PortfolioToken[] = balances.map((row) => {
    const entry = entryByAddress.get(row.tokenAddress.toLowerCase());
    const isWrappedNative = entry?.address === "native";
    const decimals = entry?.decimals ?? 18;
    const balanceNum = Number(row.amount);

    let usdPrice: number | null = null;
    let usdValue: number | null = null;

    if (entry?.isStablecoin) {
      usdPrice = 1;
      usdValue = balanceNum;
    } else {
      const priceAddr = isWrappedNative
        ? entry?.wrappedAddress?.toLowerCase()
        : row.tokenAddress.toLowerCase();
      usdPrice = priceAddr ? (priceMap.get(priceAddr) ?? null) : null;
      usdValue = usdPrice !== null ? balanceNum * usdPrice : null;
    }

    return {
      symbol: row.symbol,
      name: entry?.name ?? row.symbol,
      address: isWrappedNative ? "native" : row.tokenAddress,
      decimals,
      balance: row.rawAmount,
      formattedBalance: formatWithGrouping(row.amount),
      usdPrice,
      usdValue,
      iconUrl: getTokenIconUrl(
        networkConfig.chainId,
        isWrappedNative ? entry!.wrappedAddress! : row.tokenAddress,
      ),
      isNative: isWrappedNative,
    };
  });

  // Sort: non-zero USD value descending, then non-zero balance without price, then zero balance
  tokens.sort((a, b) => {
    const aHasValue = a.usdValue !== null && a.usdValue > 0;
    const bHasValue = b.usdValue !== null && b.usdValue > 0;
    if (aHasValue && bHasValue) return b.usdValue! - a.usdValue!;
    if (aHasValue) return -1;
    if (bHasValue) return 1;

    const aHasBalance = a.balance !== "0";
    const bHasBalance = b.balance !== "0";
    if (aHasBalance && !bHasBalance) return -1;
    if (!aHasBalance && bHasBalance) return 1;
    return 0;
  });

  const totalUsdValue = tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);

  return {
    chainId: networkConfig.chainId,
    chainName: chainMetadata.name,
    walletAddress: railgunAddress,
    ensName: null,
    totalUsdValue,
    tokens,
    fetchedAt: Date.now(),
    railgunSync: {
      lastSyncAt: scan.lastSyncAt ?? null,
      syncStatus: scan.syncStatus ?? null,
      freshness: freshness ?? null,
    },
  };
}
