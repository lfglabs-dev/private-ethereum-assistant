import { describe, expect, test } from "bun:test";
import { createDefaultRuntimeConfig } from "./runtime-config";
import {
  mergeRuntimeConfigWithEnvSecrets,
  upsertEnvFileContent,
} from "./env-secrets";

describe("env secret helpers", () => {
  test("merges runtime config secrets from process.env", () => {
    const originalWalletPrivateKey = process.env.EOA_PRIVATE_KEY;
    const originalSafeSignerPrivateKey = process.env.SAFE_SIGNER_PRIVATE_KEY;

    process.env.EOA_PRIVATE_KEY =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.SAFE_SIGNER_PRIVATE_KEY =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    try {
      const runtimeConfig = mergeRuntimeConfigWithEnvSecrets(createDefaultRuntimeConfig());

      expect(runtimeConfig.wallet.eoaPrivateKey).toBe(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      expect(runtimeConfig.safe.signerPrivateKey).toBe(
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
    } finally {
      if (originalWalletPrivateKey === undefined) {
        delete process.env.EOA_PRIVATE_KEY;
      } else {
        process.env.EOA_PRIVATE_KEY = originalWalletPrivateKey;
      }

      if (originalSafeSignerPrivateKey === undefined) {
        delete process.env.SAFE_SIGNER_PRIVATE_KEY;
      } else {
        process.env.SAFE_SIGNER_PRIVATE_KEY = originalSafeSignerPrivateKey;
      }
    }
  });

  test("updates matching env vars without clobbering unrelated lines", () => {
    const nextContent = upsertEnvFileContent(
      [
        "FOO=bar",
        "EOA_PRIVATE_KEY=0xold",
        "SAFE_API_KEY=old-api-key",
        "",
      ].join("\n"),
      {
        eoaPrivateKey:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        safeSignerPrivateKey:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    );

    expect(nextContent).toContain("FOO=bar");
    expect(nextContent).toContain(
      "EOA_PRIVATE_KEY=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(nextContent).toContain(
      "SAFE_SIGNER_PRIVATE_KEY=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(nextContent).toContain("SAFE_API_KEY=old-api-key");
  });
});
