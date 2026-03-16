import { z } from "zod";
import { createPublicClient, http, type Chain } from "viem";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
} from "viem/chains";
import { config } from "./config";

const CHAIN_BY_ID: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [polygon.id]: polygon,
  [avalanche.id]: avalanche,
  [bsc.id]: bsc,
};

export const networkConfigSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  rpcUrl: z.string().url(),
});

export type NetworkConfig = z.infer<typeof networkConfigSchema>;

export type ChainMetadata = {
  id: number;
  name: string;
  nativeName: string;
  nativeSymbol: string;
  explorerBaseUrl?: string;
  defaultRpcUrl?: string;
};

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  chainId: config.ethereum.chainId,
  rpcUrl: config.ethereum.rpcUrl,
};

export const NETWORK_PRESETS = [
  { id: "ethereum", chain: mainnet, name: "Ethereum Mainnet" },
  { id: "arbitrum", chain: arbitrum, name: "Arbitrum One" },
  { id: "base", chain: base, name: "Base" },
  { id: "optimism", chain: optimism, name: "OP Mainnet" },
  { id: "polygon", chain: polygon, name: "Polygon PoS" },
  { id: "bnb", chain: bsc, name: "BNB Smart Chain" },
  { id: "avalanche", chain: avalanche, name: "Avalanche C-Chain" },
].map(({ id, chain, name }) => ({
  id,
  name,
  chainId: chain.id,
  rpcUrl: chain.rpcUrls.default.http[0],
  nativeSymbol: chain.nativeCurrency.symbol,
}));

export function getChainDefinition(chainId: number) {
  return CHAIN_BY_ID[chainId];
}

export function getChainMetadata(networkConfig: NetworkConfig): ChainMetadata {
  const chain = getChainDefinition(networkConfig.chainId);
  return {
    id: networkConfig.chainId,
    name: chain?.name ?? `Chain ${networkConfig.chainId}`,
    nativeName: chain?.nativeCurrency.name ?? chain?.nativeCurrency.symbol ?? "Native asset",
    nativeSymbol: chain?.nativeCurrency.symbol ?? "ETH",
    explorerBaseUrl: chain?.blockExplorers?.default.url,
    defaultRpcUrl: chain?.rpcUrls.default.http[0],
  };
}

export function getNetworkLabel(networkConfig: NetworkConfig) {
  return (
    NETWORK_PRESETS.find((preset) => preset.chainId === networkConfig.chainId)?.name ??
    `Chain ${networkConfig.chainId}`
  );
}

export function createEthereumContext(networkConfig: NetworkConfig) {
  const chain = getChainDefinition(networkConfig.chainId);
  const chainMetadata = getChainMetadata(networkConfig);

  const publicClient = createPublicClient({
    ...(chain ? { chain } : {}),
    transport: http(networkConfig.rpcUrl),
  });

  const ensClient = createPublicClient({
    chain: mainnet,
    transport: http(mainnet.rpcUrls.default.http[0]),
  });

  return {
    networkConfig,
    chain,
    chainMetadata,
    publicClient,
    ensClient,
  };
}

export function getExplorerTxUrl(hash: string, networkConfig: NetworkConfig) {
  const metadata = getChainMetadata(networkConfig);
  return metadata.explorerBaseUrl
    ? `${metadata.explorerBaseUrl}/tx/${hash}`
    : undefined;
}
