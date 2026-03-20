import type { Address } from "viem";

export type PortfolioTokenEntry = {
  symbol: string;
  name: string;
  address: Address | "native";
  decimals: number;
  wrappedAddress?: Address;
  isStablecoin: boolean;
  poolFee: number;
};

/**
 * Curated top tokens per chain for the portfolio sidebar.
 * Native tokens use "native" as address with wrappedAddress for price lookup.
 * Stablecoins are priced at $1 without pool reads.
 * poolFee is the Uniswap V3 fee tier for the token/USDC pair.
 */
export const PORTFOLIO_TOKENS: Record<number, PortfolioTokenEntry[]> = {
  // Ethereum Mainnet
  1: [
    { symbol: "ETH", name: "Ethereum", address: "native", decimals: 18, wrappedAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", isStablecoin: false, poolFee: 500 },
    { symbol: "USDC", name: "USD Coin", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, isStablecoin: false, poolFee: 500 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, isStablecoin: true, poolFee: 0 },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, isStablecoin: false, poolFee: 3000 },
    { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "LINK", name: "Chainlink", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "AAVE", name: "Aave", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "stETH", name: "Lido Staked ETH", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, isStablecoin: false, poolFee: 100 },
  ],

  // Base
  8453: [
    { symbol: "ETH", name: "Ethereum", address: "native", decimals: 18, wrappedAddress: "0x4200000000000000000000000000000000000006", isStablecoin: false, poolFee: 500 },
    { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, isStablecoin: false, poolFee: 500 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, isStablecoin: true, poolFee: 0 },
    { symbol: "USDbC", name: "USD Base Coin", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, isStablecoin: false, poolFee: 3000 },
  ],

  // Arbitrum One
  42161: [
    { symbol: "ETH", name: "Ethereum", address: "native", decimals: 18, wrappedAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", isStablecoin: false, poolFee: 500 },
    { symbol: "USDC", name: "USD Coin", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "USDT", name: "Tether USD", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, isStablecoin: false, poolFee: 500 },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, isStablecoin: false, poolFee: 3000 },
    { symbol: "ARB", name: "Arbitrum", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, isStablecoin: true, poolFee: 0 },
    { symbol: "LINK", name: "Chainlink", address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18, isStablecoin: false, poolFee: 3000 },
  ],

  // Optimism
  10: [
    { symbol: "ETH", name: "Ethereum", address: "native", decimals: 18, wrappedAddress: "0x4200000000000000000000000000000000000006", isStablecoin: false, poolFee: 500 },
    { symbol: "USDC", name: "USD Coin", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "USDT", name: "Tether USD", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18, isStablecoin: false, poolFee: 500 },
    { symbol: "OP", name: "Optimism", address: "0x4200000000000000000000000000000000000042", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, isStablecoin: true, poolFee: 0 },
  ],

  // Polygon PoS
  137: [
    { symbol: "POL", name: "POL", address: "native", decimals: 18, wrappedAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", isStablecoin: false, poolFee: 3000 },
    { symbol: "USDC", name: "USD Coin", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "USDT", name: "Tether USD", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "WETH", name: "Wrapped Ether", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, isStablecoin: false, poolFee: 500 },
    { symbol: "WPOL", name: "Wrapped POL", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "DAI", name: "Dai Stablecoin", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, isStablecoin: true, poolFee: 0 },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8, isStablecoin: false, poolFee: 3000 },
  ],

  // BNB Smart Chain
  56: [
    { symbol: "BNB", name: "BNB", address: "native", decimals: 18, wrappedAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", isStablecoin: false, poolFee: 2500 },
    { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, isStablecoin: true, poolFee: 0 },
    { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, isStablecoin: true, poolFee: 0 },
    { symbol: "WBNB", name: "Wrapped BNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, isStablecoin: false, poolFee: 2500 },
    { symbol: "ETH", name: "Ethereum", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18, isStablecoin: false, poolFee: 2500 },
    { symbol: "BTCB", name: "Bitcoin BEP2", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, isStablecoin: false, poolFee: 2500 },
  ],

  // Avalanche C-Chain
  43114: [
    { symbol: "AVAX", name: "Avalanche", address: "native", decimals: 18, wrappedAddress: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", isStablecoin: false, poolFee: 3000 },
    { symbol: "USDC", name: "USD Coin", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "USDT", name: "Tether USD", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6, isStablecoin: true, poolFee: 0 },
    { symbol: "WAVAX", name: "Wrapped AVAX", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18, isStablecoin: false, poolFee: 3000 },
    { symbol: "WETH.e", name: "Wrapped Ether", address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", decimals: 18, isStablecoin: false, poolFee: 3000 },
  ],
};

export const USDC_ADDRESSES: Record<number, { address: Address; decimals: number }> = {
  1: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  8453: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  42161: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
  10: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
  137: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
  56: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  43114: { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
};

export function getPortfolioTokens(chainId: number): PortfolioTokenEntry[] {
  return PORTFOLIO_TOKENS[chainId] ?? [];
}
