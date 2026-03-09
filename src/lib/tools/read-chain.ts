import { tool } from "ai";
import { z } from "zod";
import {
  createPublicClient,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  hexToString,
  http,
  parseAbi,
  type Address,
} from "viem";
import { base, mainnet } from "viem/chains";
import { createEnsService } from "../ens";
import { config } from "../config";

const client = createPublicClient({
  chain: base,
  transport: http(config.ethereum.rpcUrl),
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const symbolBytes32Abi = parseAbi(["function symbol() view returns (bytes32)"]);

export const BASE_WELL_KNOWN_TOKENS = [
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    decimals: 6,
  },
  {
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    symbol: "USDT",
    decimals: 6,
  },
  {
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    symbol: "DAI",
    decimals: 18,
  },
  {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    decimals: 18,
  },
  {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH",
    decimals: 18,
  },
] as const;

const wellKnownTokenMap = new Map(
  BASE_WELL_KNOWN_TOKENS.map((token) => [token.address.toLowerCase(), token])
);
const wellKnownTokenSymbolMap = new Map(
  BASE_WELL_KNOWN_TOKENS.map((token) => [token.symbol.toUpperCase(), token])
);

export interface NativeBalanceResult {
  symbol: "ETH";
  decimals: 18;
  rawBalance: string;
  formattedBalance: string;
}

export interface TokenBalanceResult {
  address: string;
  symbol: string;
  decimals: number | null;
  rawBalance: string | null;
  formattedBalance: string | null;
  error?: string;
}

export interface BalanceSnapshot {
  address: string;
  blockNumber: number | null;
  nativeBalance: NativeBalanceResult | null;
  tokens: TokenBalanceResult[];
  errors: string[];
}

export function formatWithGrouping(value: string) {
  if (!value || value === "0") return "0";

  const [whole, fraction = ""] = value.split(".");
  const groupedWhole = BigInt(whole).toLocaleString("en-US");
  const trimmedFraction = fraction.replace(/0+$/, "");

  return trimmedFraction ? `${groupedWhole}.${trimmedFraction}` : groupedWhole;
}

export function formatTokenAmount(rawBalance: bigint, decimals: number | null) {
  if (decimals === null) {
    return rawBalance.toLocaleString("en-US");
  }

  return formatWithGrouping(formatUnits(rawBalance, decimals));
}

export function normalizeAddressInput(value: string, label: string): Address {
  try {
    return getAddress(value.trim());
  } catch {
    throw new Error(
      `Invalid ${label}. Expected a 42-character 0x-prefixed Ethereum address.`
    );
  }
}

export function resolveRequestedTokenAddresses(
  tokenAddress?: string,
  tokenAddresses?: string[]
) {
  const requested = [tokenAddress, ...(tokenAddresses ?? [])].filter(
    (value): value is string => Boolean(value?.trim())
  );
  const seen = new Set<string>();

  return requested.flatMap((value) => {
    try {
      const normalized = normalizeAddressInput(value, "token address");
      const key = normalized.toLowerCase();

      if (seen.has(key)) return [];
      seen.add(key);
      return [normalized];
    } catch {
      return [value.trim()];
    }
  });
}

export function resolveRequestedTokenSymbols(
  tokenSymbol?: string,
  tokenSymbols?: string[]
) {
  const requested = [tokenSymbol, ...(tokenSymbols ?? [])].filter(
    (value): value is string => Boolean(value?.trim())
  );
  const errors: string[] = [];

  const resolved = requested.flatMap((value) => {
    const symbol = value.trim().toUpperCase();
    const token = wellKnownTokenSymbolMap.get(symbol);

    if (!token) {
      errors.push(
        `Unknown Base token symbol "${value}". Supported symbols: ${BASE_WELL_KNOWN_TOKENS.map((knownToken) => knownToken.symbol).join(", ")}.`
      );
      return [];
    }

    return [token.address];
  });

  return { resolved, errors };
}

function buildErrorResult(address: string, error: string): BalanceSnapshot {
  return {
    address,
    blockNumber: null,
    nativeBalance: null,
    tokens: [],
    errors: [error],
  };
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 3) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("RPC request failed after retrying.");
}

async function readTokenSymbol(tokenAddress: Address, blockNumber: bigint) {
  const wellKnownToken = wellKnownTokenMap.get(tokenAddress.toLowerCase());
  if (wellKnownToken) return wellKnownToken.symbol;

  try {
    return await withRetry(() =>
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
        blockNumber,
      })
    );
  } catch {
    try {
      const symbol = await withRetry(() =>
        client.readContract({
          address: tokenAddress,
          abi: symbolBytes32Abi,
          functionName: "symbol",
          blockNumber,
        })
      );
      return hexToString(symbol, { size: 32 }).replace(/\0/g, "") || tokenAddress;
    } catch {
      return tokenAddress;
    }
  }
}

async function readTokenDecimals(tokenAddress: Address, blockNumber: bigint) {
  const wellKnownToken = wellKnownTokenMap.get(tokenAddress.toLowerCase());
  if (wellKnownToken) return wellKnownToken.decimals;

  try {
    return await withRetry(() =>
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber,
      })
    );
  } catch {
    return null;
  }
}

async function readTokenBalance(
  ownerAddress: Address,
  tokenAddressInput: string,
  blockNumber: bigint
): Promise<TokenBalanceResult> {
  let tokenAddress: Address;

  try {
    tokenAddress = normalizeAddressInput(tokenAddressInput, "token address");
  } catch (error) {
    return {
      address: tokenAddressInput,
      symbol: tokenAddressInput,
      decimals: null,
      rawBalance: null,
      formattedBalance: null,
      error: error instanceof Error ? error.message : "Invalid token address.",
    };
  }

  if (tokenAddress === ZERO_ADDRESS) {
    return {
      address: tokenAddress,
      symbol: tokenAddress,
      decimals: null,
      rawBalance: null,
      formattedBalance: null,
      error:
        "Token address 0x0000000000000000000000000000000000000000 is not a valid ERC-20 contract.",
    };
  }

  const bytecode = await withRetry(() =>
    client.getBytecode({ address: tokenAddress, blockNumber })
  );
  if (!bytecode || bytecode === "0x") {
    return {
      address: tokenAddress,
      symbol: tokenAddress,
      decimals: null,
      rawBalance: null,
      formattedBalance: null,
      error: `No contract was found at ${tokenAddress} on Base.`,
    };
  }

  try {
    const balance = await withRetry(() =>
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [ownerAddress],
        blockNumber,
      })
    );
    const [symbol, decimals] = await Promise.all([
      readTokenSymbol(tokenAddress, blockNumber),
      readTokenDecimals(tokenAddress, blockNumber),
    ]);

    return {
      address: tokenAddress,
      symbol,
      decimals,
      rawBalance: balance.toString(),
      formattedBalance: formatTokenAmount(balance, decimals),
    };
  } catch {
    return {
      address: tokenAddress,
      symbol: tokenAddress,
      decimals: null,
      rawBalance: null,
      formattedBalance: null,
      error: `Unable to read an ERC-20 balance from ${tokenAddress} on Base.`,
    };
  }
}

export async function fetchBalanceSnapshot({
  address,
  tokenAddress,
  tokenAddresses,
  tokenSymbol,
  tokenSymbols,
}: {
  address: string;
  tokenAddress?: string;
  tokenAddresses?: string[];
  tokenSymbol?: string;
  tokenSymbols?: string[];
}): Promise<BalanceSnapshot> {
  let ownerAddress: Address;

  try {
    ownerAddress = normalizeAddressInput(address, "wallet address");
  } catch (error) {
    return buildErrorResult(
      address,
      error instanceof Error ? error.message : "Invalid wallet address."
    );
  }

  const blockNumber = await withRetry(() => client.getBlockNumber());
  const nativeBalance = await withRetry(() =>
    client.getBalance({
      address: ownerAddress,
      blockNumber,
    })
  );
  const resolvedSymbols = resolveRequestedTokenSymbols(tokenSymbol, tokenSymbols);
  const requestedTokenAddresses = resolveRequestedTokenAddresses(tokenAddress, [
    ...(tokenAddresses ?? []),
    ...resolvedSymbols.resolved,
  ]);
  const tokens = await Promise.all(
    requestedTokenAddresses.map((requestedTokenAddress) =>
      readTokenBalance(ownerAddress, requestedTokenAddress, blockNumber)
    )
  );

  return {
    address: ownerAddress,
    blockNumber: Number(blockNumber),
    nativeBalance: {
      symbol: "ETH",
      decimals: 18,
      rawBalance: nativeBalance.toString(),
      formattedBalance: formatWithGrouping(formatEther(nativeBalance)),
    },
    tokens,
    errors: [
      ...resolvedSymbols.errors,
      ...tokens.flatMap((token) => (token.error ? [token.error] : [])),
    ],
  };
}

export const getBalance = tool({
  description:
    "Get the ETH balance and optional ERC-20 token balances for an Ethereum address on Base. Supports one token address, an array of token addresses, or well-known Base token symbols such as USDC, USDT, DAI, WETH, and cbETH.",
  inputSchema: z.object({
    address: z.string().describe("The Ethereum address (0x...)"),
    tokenAddress: z
      .string()
      .optional()
      .describe("Optional ERC-20 token contract address."),
    tokenAddresses: z
      .array(z.string())
      .optional()
      .describe("Optional list of ERC-20 token contract addresses to query."),
    tokenSymbol: z
      .string()
      .optional()
      .describe("Optional well-known Base token symbol such as USDC, USDT, DAI, WETH, or cbETH."),
    tokenSymbols: z
      .array(z.string())
      .optional()
      .describe("Optional list of well-known Base token symbols to query."),
  }),
  execute: async ({
    address,
    tokenAddress,
    tokenAddresses,
    tokenSymbol,
    tokenSymbols,
  }) =>
    fetchBalanceSnapshot({
      address,
      tokenAddress,
      tokenAddresses,
      tokenSymbol,
      tokenSymbols,
    }),
});

export const getPortfolio = tool({
  description:
    "Get the ETH balance plus a curated set of popular Base token balances for an Ethereum address.",
  inputSchema: z.object({
    address: z.string().describe("The Ethereum address (0x...)"),
  }),
  execute: async ({ address }) =>
    fetchBalanceSnapshot({
      address,
      tokenAddresses: BASE_WELL_KNOWN_TOKENS.map((token) => token.address),
    }),
});

export const getTransaction = tool({
  description: "Look up a transaction by its hash on Base.",
  inputSchema: z.object({
    hash: z.string().describe("The transaction hash (0x...)"),
  }),
  execute: async ({ hash }) => {
    const tx = await client.getTransaction({
      hash: hash as `0x${string}`,
    });
    const receipt = await client.getTransactionReceipt({
      hash: hash as `0x${string}`,
    });
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: formatEther(tx.value),
      status: receipt.status === "success" ? "Success" : "Failed",
      blockNumber: Number(tx.blockNumber),
      gasUsed: Number(receipt.gasUsed),
    };
  },
});

const resolveEnsInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("A single ENS name to resolve (e.g. vitalik.eth)"),
    names: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Optional batch of ENS names to resolve in one call, preserving input order."
      ),
  })
  .refine(({ name, names }) => Boolean(name || names?.length), {
    message: "Provide either name or names.",
  })
  .refine(({ name, names }) => !(name && names?.length), {
    message: "Provide either name or names, not both.",
  });

export function createReadChainTools() {
  const ensService = createEnsService();

  const resolveEns = tool({
    description:
      "Resolve one or more ENS names on Ethereum mainnet to Ethereum addresses. Returns clear validation, not-found, no-address, or network errors without throwing.",
    inputSchema: resolveEnsInputSchema,
    execute: async ({ name, names }) => {
      const requestedNames = names ?? (name ? [name] : []);
      const results = await ensService.resolveNames(requestedNames);

      if (requestedNames.length === 1) {
        return results[0];
      }

      return {
        results,
        resolutionChainId: mainnet.id,
      };
    },
  });

  const reverseResolveEns = tool({
    description:
      "Reverse-resolve an Ethereum address on Ethereum mainnet to its primary ENS name, if one is configured and forward-confirmed.",
    inputSchema: z.object({
      address: z.string().describe("The Ethereum address (0x...)"),
    }),
    execute: async ({ address }) => ensService.reverseResolveAddress(address),
  });

  return {
    getBalance,
    getPortfolio,
    getTransaction,
    resolveEns,
    reverseResolveEns,
  };
}
