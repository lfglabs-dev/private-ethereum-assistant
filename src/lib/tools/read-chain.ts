import { tool } from "ai";
import { z } from "zod";
import {
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  hexToString,
  parseAbi,
  type Address,
} from "viem";
import { base, mainnet } from "viem/chains";
import { createEnsService } from "../ens";
import { createEthereumContext, type NetworkConfig } from "../ethereum";
import { resolveTokenMetadata, resolveTokenQuery } from "../token-metadata";
import { getTrustWalletChainSlug } from "../trustwallet-assets";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const symbolBytes32Abi = parseAbi(["function symbol() view returns (bytes32)"]);
const nameBytes32Abi = parseAbi(["function name() view returns (bytes32)"]);

export const BASE_PORTFOLIO_TOKEN_ADDRESSES = [
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
  {
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  },
  {
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  },
  {
    address: "0x4200000000000000000000000000000000000006",
  },
  {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  },
] as const;

export interface NativeBalanceResult {
  symbol: string;
  decimals: 18;
  rawBalance: string;
  formattedBalance: string;
}

export interface TokenBalanceResult {
  chainId: number;
  chainName: string;
  address: string;
  symbol: string;
  name?: string;
  decimals: number | null;
  rawBalance: string | null;
  formattedBalance: string | null;
  iconUrl?: string;
  metadataUrl?: string;
  source: "verified" | "onchain";
  error?: string;
}

export interface TokenCandidateResult {
  chainId: number;
  chainName: string;
  address: string;
  symbol: string;
  name?: string;
  iconUrl?: string;
  source: "verified" | "onchain";
}

export interface BalanceSnapshot {
  chainId: number;
  chainName: string;
  address: string;
  blockNumber: number | null;
  nativeBalance: NativeBalanceResult | null;
  tokens: TokenBalanceResult[];
  tokenCandidates: TokenCandidateResult[];
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

function buildErrorResult(address: string, error: string): BalanceSnapshot {
  return {
    chainId: 0,
    chainName: "Unknown",
    address,
    blockNumber: null,
    nativeBalance: null,
    tokens: [],
    tokenCandidates: [],
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

export function createReadChainTools(networkConfig: NetworkConfig) {
  const { publicClient, chainMetadata } = createEthereumContext(networkConfig);
  const ensService = createEnsService();
  const supportsBasePresets = chainMetadata.id === base.id;
  const supportsTrustWalletTokenSearch = Boolean(
    getTrustWalletChainSlug(chainMetadata.id)
  );

  async function resolveSelectedNetworkTokenQueries(
    tokenSymbol?: string,
    tokenSymbols?: string[]
  ) {
    const requested = [tokenSymbol, ...(tokenSymbols ?? [])].filter(
      (value): value is string => Boolean(value?.trim())
    );
    const errors: string[] = [];

    if (!supportsTrustWalletTokenSearch && requested.length > 0) {
      errors.push(
        `Verified token search is not configured for ${chainMetadata.name}. Provide token contract addresses instead.`
      );
      return {
        resolved: [] as string[],
        candidates: [] as TokenCandidateResult[],
        errors,
      };
    }

    const resolved: string[] = [];
    const candidates: TokenCandidateResult[] = [];
    const seenCandidates = new Set<string>();

    for (const value of requested) {
      try {
        const resolution = await resolveTokenQuery({
          chainId: chainMetadata.id,
          query: value,
        });

        if (resolution.status === "resolved") {
          resolved.push(resolution.token.address);
          continue;
        }

        errors.push(resolution.message);

        if (resolution.status === "ambiguous") {
          resolution.candidates.forEach((candidate) => {
            const key = `${candidate.chainId}:${candidate.address.toLowerCase()}`;
            if (seenCandidates.has(key)) return;
            seenCandidates.add(key);
            candidates.push({
              chainId: candidate.chainId,
              chainName: candidate.chainName,
              address: candidate.address,
              symbol: candidate.symbol,
              name: candidate.name,
              iconUrl: candidate.iconUrl,
              source: candidate.verified ? "verified" : "onchain",
            });
          });
        }
      } catch {
        errors.push(
          `Unable to load the verified token index for "${value}" on ${chainMetadata.name}. Provide a token contract address instead.`
        );
      }
    }

    return {
      resolved,
      candidates,
      errors,
    };
  }

  async function readTokenSymbol(tokenAddress: Address, blockNumber: bigint) {
    try {
      return await withRetry(() =>
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber,
        })
      );
    } catch {
      try {
        const symbol = await withRetry(() =>
          publicClient.readContract({
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

  async function readTokenName(tokenAddress: Address, blockNumber: bigint) {
    try {
      return await withRetry(() =>
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "name",
          blockNumber,
        })
      );
    } catch {
      try {
        const name = await withRetry(() =>
          publicClient.readContract({
            address: tokenAddress,
            abi: nameBytes32Abi,
            functionName: "name",
            blockNumber,
          })
        );
        return hexToString(name, { size: 32 }).replace(/\0/g, "") || undefined;
      } catch {
        return undefined;
      }
    }
  }

  async function readTokenDecimals(tokenAddress: Address, blockNumber: bigint) {
    try {
      return await withRetry(() =>
        publicClient.readContract({
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
        chainId: chainMetadata.id,
        chainName: chainMetadata.name,
        address: tokenAddressInput,
        symbol: tokenAddressInput,
        decimals: null,
        rawBalance: null,
        formattedBalance: null,
        source: "onchain",
        error: error instanceof Error ? error.message : "Invalid token address.",
      };
    }

    if (tokenAddress === ZERO_ADDRESS) {
      return {
        chainId: chainMetadata.id,
        chainName: chainMetadata.name,
        address: tokenAddress,
        symbol: tokenAddress,
        decimals: null,
        rawBalance: null,
        formattedBalance: null,
        source: "onchain",
        error:
          "Token address 0x0000000000000000000000000000000000000000 is not a valid ERC-20 contract.",
      };
    }

    const bytecode = await withRetry(() =>
      publicClient.getBytecode({ address: tokenAddress, blockNumber })
    );
    if (!bytecode || bytecode === "0x") {
      return {
        chainId: chainMetadata.id,
        chainName: chainMetadata.name,
        address: tokenAddress,
        symbol: tokenAddress,
        decimals: null,
        rawBalance: null,
        formattedBalance: null,
        source: "onchain",
        error: `No contract was found at ${tokenAddress} on ${chainMetadata.name}.`,
      };
    }

    try {
      const balance = await withRetry(() =>
        publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [ownerAddress],
          blockNumber,
        })
      );
      const metadata = await resolveTokenMetadata({
        chainId: chainMetadata.id,
        address: tokenAddress,
        readOnchainMetadata: async (resolvedAddress) => {
          const [symbol, name, decimals] = await Promise.all([
            readTokenSymbol(resolvedAddress, blockNumber),
            readTokenName(resolvedAddress, blockNumber),
            readTokenDecimals(resolvedAddress, blockNumber),
          ]);

          return {
            symbol,
            name,
            decimals,
          };
        },
      });

      return {
        chainId: chainMetadata.id,
        chainName: chainMetadata.name,
        address: tokenAddress,
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals ?? null,
        rawBalance: balance.toString(),
        formattedBalance: formatTokenAmount(balance, metadata.decimals ?? null),
        iconUrl: metadata.iconUrl,
        metadataUrl: metadata.metadataUrl,
        source: metadata.verified ? "verified" : "onchain",
      };
    } catch {
      return {
        chainId: chainMetadata.id,
        chainName: chainMetadata.name,
        address: tokenAddress,
        symbol: tokenAddress,
        decimals: null,
        rawBalance: null,
        formattedBalance: null,
        source: "onchain",
        error: `Unable to read an ERC-20 balance from ${tokenAddress} on ${chainMetadata.name}.`,
      };
    }
  }

  async function fetchBalanceSnapshot({
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

    const [blockNumber, resolvedQueries] = await Promise.all([
      withRetry(() => publicClient.getBlockNumber()),
      resolveSelectedNetworkTokenQueries(tokenSymbol, tokenSymbols),
    ]);
    const nativeBalance = await withRetry(() =>
      publicClient.getBalance({
        address: ownerAddress,
        blockNumber,
      })
    );
    const requestedTokenAddresses = resolveRequestedTokenAddresses(tokenAddress, [
      ...(tokenAddresses ?? []),
      ...resolvedQueries.resolved,
    ]);
    const tokens = await Promise.all(
      requestedTokenAddresses.map((requestedTokenAddress) =>
        readTokenBalance(ownerAddress, requestedTokenAddress, blockNumber)
      )
    );

    return {
      chainId: chainMetadata.id,
      chainName: chainMetadata.name,
      address: ownerAddress,
      blockNumber: Number(blockNumber),
      nativeBalance: {
        symbol: chainMetadata.nativeSymbol,
        decimals: 18,
        rawBalance: nativeBalance.toString(),
        formattedBalance: formatWithGrouping(formatEther(nativeBalance)),
      },
      tokens,
      tokenCandidates: resolvedQueries.candidates,
      errors: [
        ...resolvedQueries.errors,
        ...tokens.flatMap((token) => (token.error ? [token.error] : [])),
      ],
    };
  }

  const getBalance = tool({
    description: `Get the ${chainMetadata.nativeSymbol} balance and optional ERC-20 token balances for an address on ${chainMetadata.name}.`,
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
        .describe(
          "Optional verified token symbol or name for the active network when Trust Wallet indexing is available."
        ),
      tokenSymbols: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of verified token symbols or names for the active network when Trust Wallet indexing is available."
        ),
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

  const getPortfolio = tool({
    description:
      "Get the native balance plus a curated set of popular Base token balances for an Ethereum address. This is only configured for Base.",
    inputSchema: z.object({
      address: z.string().describe("The Ethereum address (0x...)"),
    }),
    execute: async ({ address }) => {
      if (!supportsBasePresets) {
        return buildErrorResult(
          address,
          `Portfolio token presets are only configured for Base. On ${chainMetadata.name}, use get_balance with tokenAddresses instead.`
        );
      }

      return fetchBalanceSnapshot({
        address,
        tokenAddresses: BASE_PORTFOLIO_TOKEN_ADDRESSES.map((token) => token.address),
      });
    },
  });

  const getTransaction = tool({
    description: `Look up a transaction by its hash on ${chainMetadata.name}.`,
    inputSchema: z.object({
      hash: z.string().describe("The transaction hash (0x...)"),
    }),
    execute: async ({ hash }) => {
      try {
        const tx = await publicClient.getTransaction({
          hash: hash as `0x${string}`,
        });
        const receipt = await publicClient.getTransactionReceipt({
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
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : `Could not find transaction ${hash} on ${chainMetadata.name}.`;

        return {
          hash,
          status: "error",
          message,
        };
      }
    },
  });

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
