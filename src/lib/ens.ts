import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  type Address,
  zeroAddress,
} from "viem";
import { namehash, normalize } from "viem/ens";
import { mainnet } from "viem/chains";

const ENS_MAINNET_RPC_URL = "https://cloudflare-eth.com";
const ENS_MAINNET_FALLBACK_RPC_URLS = [
  "https://eth.merkle.io",
  "https://ethereum-rpc.publicnode.com",
  ENS_MAINNET_RPC_URL,
] as const;
const ENS_REGISTRY_ADDRESS =
  "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

const ensRegistryAbi = [
  {
    inputs: [{ name: "node", type: "bytes32" }],
    name: "owner",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "node", type: "bytes32" }],
    name: "resolver",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type ResolveEnsErrorCode =
  | "invalid_name"
  | "name_not_found"
  | "no_address"
  | "network_error";

export type ReverseResolveEnsErrorCode =
  | "invalid_address"
  | "name_not_found"
  | "network_error";

type CachedForwardResolution =
  | {
      address: Address;
      error: null;
      errorCode: null;
      normalizedName: string;
      resolutionChainId: number;
    }
  | {
      address: null;
      error: string;
      errorCode: ResolveEnsErrorCode;
      normalizedName: string;
      resolutionChainId: number;
    };

type CachedReverseResolution =
  | {
      address: Address;
      error: null;
      errorCode: null;
      name: string;
      resolutionChainId: number;
    }
  | {
      address: Address;
      error: string;
      errorCode: ReverseResolveEnsErrorCode;
      name: null;
      resolutionChainId: number;
    };

export type ResolveEnsResult = {
  address: Address | null;
  error: string | null;
  errorCode: ResolveEnsErrorCode | null;
  name: string;
  normalizedName: string | null;
  resolutionChainId: number;
};

export type ReverseResolveEnsResult = {
  address: Address;
  error: string | null;
  errorCode: ReverseResolveEnsErrorCode | null;
  name: string | null;
  resolutionChainId: number;
};

type EnsClient = {
  getEnsAddress(args: { name: string }): Promise<Address | null>;
  getEnsName(args: { address: Address }): Promise<string | null>;
  readContract(args: {
    functionName: "owner" | "resolver";
    args: [`0x${string}`];
  }): Promise<Address>;
};

const publicMainnetEnsClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    ENS_MAINNET_FALLBACK_RPC_URLS.map((url) =>
      http(url, {
        retryCount: 1,
        retryDelay: 150,
        timeout: 10_000,
      })
    )
  ),
});

const mainnetEnsClient: EnsClient = {
  getEnsAddress: ({ name }) => publicMainnetEnsClient.getEnsAddress({ name }),
  getEnsName: ({ address }) => publicMainnetEnsClient.getEnsName({ address }),
  readContract: ({ functionName, args }) =>
    publicMainnetEnsClient.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ensRegistryAbi,
      functionName,
      args,
    }),
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function createEnsService(client: EnsClient = mainnetEnsClient) {
  const forwardCache = new Map<string, Promise<CachedForwardResolution>>();
  const reverseCache = new Map<string, Promise<CachedReverseResolution>>();

  async function resolveExactRegistryRecord(name: string) {
    const node = namehash(name);
    const [owner, resolver] = await Promise.all([
      client.readContract({
        functionName: "owner",
        args: [node],
      }),
      client.readContract({
        functionName: "resolver",
        args: [node],
      }),
    ]);

    return { owner, resolver };
  }

  async function resolveNameUncached(
    normalizedName: string
  ): Promise<CachedForwardResolution> {
    try {
      const address = await client.getEnsAddress({
        name: normalizedName,
      });

      if (address) {
        return {
          normalizedName,
          address,
          error: null,
          errorCode: null,
          resolutionChainId: mainnet.id,
        };
      }

      const { owner, resolver } = await resolveExactRegistryRecord(
        normalizedName
      );

      if (owner === zeroAddress) {
        return {
          normalizedName,
          address: null,
          error: "ENS name not found",
          errorCode: "name_not_found",
          resolutionChainId: mainnet.id,
        };
      }

      if (resolver === zeroAddress) {
        return {
          normalizedName,
          address: null,
          error: "ENS name exists but no resolver is configured",
          errorCode: "no_address",
          resolutionChainId: mainnet.id,
        };
      }

      return {
        normalizedName,
        address: null,
        error: "ENS name exists but no address is set",
        errorCode: "no_address",
        resolutionChainId: mainnet.id,
      };
    } catch (error) {
      return {
        normalizedName,
        address: null,
        error: `ENS lookup failed: ${getErrorMessage(error)}`,
        errorCode: "network_error",
        resolutionChainId: mainnet.id,
      };
    }
  }

  async function resolveName(name: string): Promise<ResolveEnsResult> {
    const rawName = name.trim();

    try {
      const normalizedName = normalize(rawName);

      let resolution = forwardCache.get(normalizedName);
      if (!resolution) {
        resolution = resolveNameUncached(normalizedName);
        forwardCache.set(normalizedName, resolution);
      }

      const result = await resolution;
      return {
        name: rawName,
        normalizedName: result.normalizedName,
        address: result.address,
        error: result.error,
        errorCode: result.errorCode,
        resolutionChainId: result.resolutionChainId,
      };
    } catch (error) {
      return {
        name: rawName,
        normalizedName: null,
        address: null,
        error: `Invalid ENS name: ${getErrorMessage(error)}`,
        errorCode: "invalid_name",
        resolutionChainId: mainnet.id,
      };
    }
  }

  async function resolveNames(names: string[]) {
    return Promise.all(names.map((name) => resolveName(name)));
  }

  async function reverseResolveUncached(
    address: Address
  ): Promise<CachedReverseResolution> {
    try {
      const name = await client.getEnsName({
        address,
      });

      if (!name) {
        return {
          address,
          name: null,
          error: "No primary ENS name is set for this address",
          errorCode: "name_not_found",
          resolutionChainId: mainnet.id,
        };
      }

      const forwardResolution = await resolveName(name);
      if (!forwardResolution.address) {
        return {
          address,
          name: null,
          error:
            "Primary ENS name exists but does not forward-resolve to this address",
          errorCode: "name_not_found",
          resolutionChainId: mainnet.id,
        };
      }

      if (forwardResolution.address.toLowerCase() !== address.toLowerCase()) {
        return {
          address,
          name: null,
          error:
            "Primary ENS name exists but does not forward-resolve to this address",
          errorCode: "name_not_found",
          resolutionChainId: mainnet.id,
        };
      }

      return {
        address,
        name: forwardResolution.normalizedName ?? name,
        error: null,
        errorCode: null,
        resolutionChainId: mainnet.id,
      };
    } catch (error) {
      return {
        address,
        name: null,
        error: `ENS reverse lookup failed: ${getErrorMessage(error)}`,
        errorCode: "network_error",
        resolutionChainId: mainnet.id,
      };
    }
  }

  async function reverseResolveAddress(
    inputAddress: string
  ): Promise<ReverseResolveEnsResult> {
    try {
      const address = getAddress(inputAddress);

      let resolution = reverseCache.get(address);
      if (!resolution) {
        resolution = reverseResolveUncached(address);
        reverseCache.set(address, resolution);
      }

      return await resolution;
    } catch (error) {
      return {
        address: zeroAddress,
        name: null,
        error: `Invalid Ethereum address: ${getErrorMessage(error)}`,
        errorCode: "invalid_address",
        resolutionChainId: mainnet.id,
      };
    }
  }

  return {
    resolveName,
    resolveNames,
    reverseResolveAddress,
  };
}
