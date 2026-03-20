import { afterEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultRuntimeConfig } from "./runtime-config";
import {
  getEnvSecretStatus,
  mergeRuntimeConfigWithEnvSecrets,
  saveEnvSecrets,
} from "./env-secrets";
import {
  MacKeychainAccessDeniedError,
  MacKeychainBackend,
} from "./backends/macos-keychain";

const mockGetSecret = mock();
const mockGetSecretBackend = mock();
const mockListStoredSecretKeys = mock();

mockGetSecretBackend.mockImplementation(() => {
  const backend = new MacKeychainBackend();
  return backend.isAvailable() ? backend : null;
});
mockListStoredSecretKeys.mockImplementation(async () => []);

mock.module("./secret-store", () => ({
  getSecret: mockGetSecret,
  listStoredSecretKeys: mockListStoredSecretKeys,
  invalidateSecretCache: () => {},
  getSecretBackend: mockGetSecretBackend,
  SECRET_STORE_KEYS: [
    "EOA_PRIVATE_KEY",
    "SAFE_SIGNER_PRIVATE_KEY",
    "SAFE_API_KEY",
    "RAILGUN_MNEMONIC",
  ],
}));

describe("env secret helpers", () => {
  afterEach(() => {
    mockGetSecret.mockReset();
    mockGetSecretBackend.mockReset();
    mockListStoredSecretKeys.mockReset();
    mockGetSecretBackend.mockImplementation(() => {
      const backend = new MacKeychainBackend();
      return backend.isAvailable() ? backend : null;
    });
    mockListStoredSecretKeys.mockImplementation(async () => []);
  });

  test("reports configured secrets from a single listed-key lookup", async () => {
    mockListStoredSecretKeys.mockResolvedValue([
      "EOA_PRIVATE_KEY",
      "RAILGUN_MNEMONIC",
    ]);

    await expect(getEnvSecretStatus()).resolves.toEqual({
      eoaPrivateKey: true,
      safeSignerPrivateKey: false,
      safeApiKey: false,
      railgunMnemonic: true,
      accessDenied: false,
    });
    expect(mockGetSecret).not.toHaveBeenCalled();
  });

  test("treats keychain denial as a non-fatal status response", async () => {
    mockListStoredSecretKeys.mockRejectedValue(
      new MacKeychainAccessDeniedError("macOS Keychain", "list"),
    );

    await expect(getEnvSecretStatus()).resolves.toEqual({
      eoaPrivateKey: false,
      safeSignerPrivateKey: false,
      safeApiKey: false,
      railgunMnemonic: false,
      accessDenied: true,
    });
  });

  test("merges runtime config secrets from secret store", async () => {
    mockGetSecret.mockImplementation(async (key: string) => {
      if (key === "EOA_PRIVATE_KEY") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      }
      if (key === "SAFE_SIGNER_PRIVATE_KEY") {
        return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      }
      if (key === "RAILGUN_MNEMONIC") {
        return "test test test test test test test test test test test junk";
      }
      return null;
    });

    const runtimeConfig = await mergeRuntimeConfigWithEnvSecrets(createDefaultRuntimeConfig());

    expect(runtimeConfig.wallet.eoaPrivateKey).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(runtimeConfig.safe.signerPrivateKey).toBe(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(runtimeConfig.railgun.mnemonic).toBe(
      "test test test test test test test test test test test junk",
    );
  });

  test("requires a secret backend when storing keys", async () => {
    mockGetSecretBackend.mockImplementation(() => null);

    await expect(
      saveEnvSecrets({
        eoaPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow("No secret backend is available.");
  });

  test("stores secrets in the credential backend when available", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(path.join(tmpdir(), "pea-secret-store-"));

    try {
      process.chdir(tempDir);

      const helperPath = path.join(
        tempDir,
        "native",
        "keychain-helper",
        ".build",
        "release",
        "keychain-helper",
      );
      mkdirSync(path.dirname(helperPath), { recursive: true });
      writeFileSync(
        helperPath,
        [
          "#!/bin/sh",
          "set -eu",
          "input=$(cat)",
          "printf '%s|%s|%s|%s\\n' \"$1\" \"$2\" \"$3\" \"$input\" >> ./helper.log",
        ].join("\n"),
        "utf8",
      );
      chmodSync(helperPath, 0o755);

      const result = await saveEnvSecrets({
        eoaPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });

      expect(result).toEqual({
        success: true,
        saved: ["eoaPrivateKey"],
      });
      expect(readFileSync("helper.log", "utf8")).toContain(
        "set|com.lfglabs.private-ethereum-assistant|EOA_PRIVATE_KEY|0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
