import { afterEach, describe, expect, mock, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultRuntimeConfig } from "./runtime-config";
import {
  mergeRuntimeConfigWithEnvSecrets,
  saveEnvSecrets,
} from "./env-secrets";
import { MacKeychainBackend } from "./backends/macos-keychain";

const mockGetSecret = mock();
const mockGetSecretBackend = mock();

mockGetSecretBackend.mockImplementation(() => {
  const backend = new MacKeychainBackend();
  return backend.isAvailable() ? backend : null;
});

mock.module("./secret-store", () => ({
  getSecret: mockGetSecret,
  hasSecret: async (key: string) => {
    const value = await mockGetSecret(key);
    return value !== null && value !== undefined && value.trim().length > 0;
  },
  invalidateSecretCache: () => {},
  getSecretBackend: mockGetSecretBackend,
  SECRET_STORE_KEYS: ["EOA_PRIVATE_KEY", "SAFE_SIGNER_PRIVATE_KEY", "SAFE_API_KEY"],
}));

describe("env secret helpers", () => {
  afterEach(() => {
    mockGetSecret.mockReset();
    mockGetSecretBackend.mockReset();
    mockGetSecretBackend.mockImplementation(() => {
      const backend = new MacKeychainBackend();
      return backend.isAvailable() ? backend : null;
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
      return null;
    });

    const runtimeConfig = await mergeRuntimeConfigWithEnvSecrets(createDefaultRuntimeConfig());

    expect(runtimeConfig.wallet.eoaPrivateKey).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(runtimeConfig.safe.signerPrivateKey).toBe(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });

  test("requires a secret backend when storing keys", async () => {
    mockGetSecretBackend.mockImplementation(() => null);

    await expect(
      saveEnvSecrets({
        eoaPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow("No secret backend is available. macOS Keychain is required.");
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
