/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { zeroAddress } from "viem";
import { createEnsService } from "./ens";

type MockClient = {
  getEnsAddress: (args: { name: string }) => Promise<Address | null>;
  getEnsName: (args: { address: Address }) => Promise<string | null>;
  readContract: (args: {
    functionName: "owner" | "resolver";
    args: [`0x${string}`];
  }) => Promise<Address>;
};

function createMockClient(options?: {
  owner?: Address;
  resolver?: Address;
  ensAddress?: Address | null;
  ensName?: string | null;
  throwOnRead?: boolean;
  throwOnGetEnsAddress?: boolean;
  throwOnGetEnsName?: boolean;
}) {
  const calls = {
    getEnsAddress: 0,
    getEnsName: 0,
    owner: 0,
    resolver: 0,
  };

  const client: MockClient = {
    async getEnsAddress() {
      calls.getEnsAddress += 1;
      if (options?.throwOnGetEnsAddress) {
        throw new Error("rpc offline");
      }

      return options?.ensAddress ?? null;
    },
    async getEnsName() {
      calls.getEnsName += 1;
      if (options?.throwOnGetEnsName) {
        throw new Error("rpc offline");
      }

      return options?.ensName ?? null;
    },
    async readContract({ functionName }) {
      if (options?.throwOnRead) {
        throw new Error("rpc offline");
      }

      if (functionName === "owner") {
        calls.owner += 1;
        return options?.owner ?? zeroAddress;
      }

      calls.resolver += 1;
      return options?.resolver ?? zeroAddress;
    },
  };

  return { client, calls };
}

describe("createEnsService", () => {
  test("returns a clear validation error for malformed names", async () => {
    const { client } = createMockClient();
    const service = createEnsService(client);

    const result = await service.resolveName("invalid..eth");

    expect(result.errorCode).toBe("invalid_name");
    expect(result.address).toBeNull();
    expect(result.error).toContain("Invalid ENS name");
  });

  test("distinguishes missing names from names without an address", async () => {
    const missing = createMockClient();
    const missingService = createEnsService(missing.client);
    const missingResult = await missingService.resolveName("ghost.eth");

    expect(missingResult.errorCode).toBe("name_not_found");
    expect(missingResult.error).toBe("ENS name not found");

    const noAddress = createMockClient({
      owner: "0x0000000000000000000000000000000000000001",
      resolver: "0x0000000000000000000000000000000000000002",
      ensAddress: null,
    });
    const noAddressService = createEnsService(noAddress.client);
    const noAddressResult = await noAddressService.resolveName("configured.eth");

    expect(noAddressResult.errorCode).toBe("no_address");
    expect(noAddressResult.error).toBe("ENS name exists but no address is set");
  });

  test("batch resolution reuses the same cache entry for duplicate names", async () => {
    const { client, calls } = createMockClient({
      owner: "0x0000000000000000000000000000000000000001",
      resolver: "0x0000000000000000000000000000000000000002",
      ensAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    const service = createEnsService(client);

    const results = await service.resolveNames(["vitalik.eth", "vitalik.eth"]);

    expect(results).toHaveLength(2);
    expect(results[0]?.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(results[1]?.address).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(calls.owner).toBe(1);
    expect(calls.resolver).toBe(1);
    expect(calls.getEnsAddress).toBe(1);
  });

  test("reverse resolution validates the primary name with a forward lookup", async () => {
    const { client } = createMockClient({
      owner: "0x0000000000000000000000000000000000000001",
      resolver: "0x0000000000000000000000000000000000000002",
      ensAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      ensName: "vitalik.eth",
    });
    const service = createEnsService(client);

    const result = await service.reverseResolveAddress(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );

    expect(result.errorCode).toBeNull();
    expect(result.name).toBe("vitalik.eth");
  });

  test("returns a clear error for invalid addresses in reverse resolution", async () => {
    const { client } = createMockClient();
    const service = createEnsService(client);

    const result = await service.reverseResolveAddress("not-an-address");

    expect(result.errorCode).toBe("invalid_address");
    expect(result.name).toBeNull();
    expect(result.error).toContain("Invalid Ethereum address");
  });

  test("converts RPC failures into network errors instead of throwing", async () => {
    const { client } = createMockClient({ throwOnRead: true });
    const service = createEnsService(client);

    const result = await service.resolveName("vitalik.eth");

    expect(result.errorCode).toBe("network_error");
    expect(result.error).toContain("ENS lookup failed");
  });
});
