import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  EncryptedFileBackend,
  getEncryptedSecretFilePath,
} from "./backends/encrypted-file";

describe("EncryptedFileBackend", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("encrypts secrets at rest and round-trips values", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "pea-encrypted-file-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PEA_SECRET_STORE_PASSPHRASE: "correct horse battery staple",
      XDG_CONFIG_HOME: tempDir,
    };
    const filePath = getEncryptedSecretFilePath(
      "com.lfglabs.private-ethereum-assistant",
      env,
      tempDir,
    );
    const backend = new EncryptedFileBackend(
      "com.lfglabs.private-ethereum-assistant",
      filePath,
      env,
    );

    expect(backend.isAvailable()).toBe(process.platform === "linux");

    await backend.set("SEED_PHRASE", "super-secret");
    await backend.set("SAFE_API_KEY", "safe-api-key");

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).not.toContain("super-secret");
    expect(statSync(filePath).mode & 0o777).toBe(0o600);

    await expect(backend.get("SEED_PHRASE")).resolves.toBe("super-secret");
    await expect(backend.list()).resolves.toEqual([
      "SEED_PHRASE",
      "SAFE_API_KEY",
    ]);
    await expect(backend.loadAll()).resolves.toEqual({
      SEED_PHRASE: "super-secret",
      SAFE_API_KEY: "safe-api-key",
    });
  });

  test("removes the backing file when the last secret is deleted", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "pea-encrypted-file-delete-"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PEA_SECRET_STORE_PASSPHRASE: "correct horse battery staple",
      XDG_CONFIG_HOME: tempDir,
    };
    const filePath = getEncryptedSecretFilePath(
      "com.lfglabs.private-ethereum-assistant",
      env,
      tempDir,
    );
    const backend = new EncryptedFileBackend(
      "com.lfglabs.private-ethereum-assistant",
      filePath,
      env,
    );

    await backend.set("SEED_PHRASE", "super-secret");
    await backend.delete("SEED_PHRASE");

    expect(existsSync(filePath)).toBe(false);
  });
});
