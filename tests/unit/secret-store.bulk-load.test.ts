import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getSecret,
  invalidateSecretCache,
  listStoredSecretKeys,
  loadAllSecrets,
  rememberStoredSecret,
} from "../../src/lib/secret-store";

function createSpawnResult(exitCode: number, stdout = "", stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
  } as Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
}

function getSpawnCommand(call: unknown) {
  if (!call || typeof call !== "object" || !("cmd" in call)) {
    throw new Error("Expected Bun.spawn to be called with an options object.");
  }

  const { cmd } = call as { cmd?: string[] };
  if (!Array.isArray(cmd)) {
    throw new Error("Expected Bun.spawn to receive a cmd array.");
  }

  return cmd;
}

describe("secret store access", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    invalidateSecretCache();
    mock.restore();
  });

  test("reads a requested secret once and serves later reads from memory", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "pea-secret-store-cache-"));

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
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(helperPath, 0o755);

      const spawn = spyOn(Bun, "spawn").mockImplementation(({ cmd }) => {
        const [, command, , account] = cmd;

        if (command !== "get") {
          throw new Error(`Unexpected helper command: ${command}`);
        }

        if (account === "EOA_PRIVATE_KEY") {
          return createSpawnResult(0, "eoa-secret");
        }
        if (account === "SAFE_API_KEY") {
          return createSpawnResult(0, "safe-api-key");
        }

        throw new Error(`Unexpected account lookup: ${account}`);
      });

      await expect(
        Promise.all([
          getSecret("EOA_PRIVATE_KEY"),
          getSecret("EOA_PRIVATE_KEY"),
        ]),
      ).resolves.toEqual(["eoa-secret", "eoa-secret"]);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(getSpawnCommand(spawn.mock.calls[0]?.[0])).toEqual([
        realpathSync(helperPath),
        "get",
        "com.lfglabs.private-ethereum-assistant",
        "EOA_PRIVATE_KEY",
      ]);

      await expect(getSecret("SAFE_API_KEY")).resolves.toBe("safe-api-key");
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(getSpawnCommand(spawn.mock.calls[1]?.[0])).toEqual([
        realpathSync(helperPath),
        "get",
        "com.lfglabs.private-ethereum-assistant",
        "SAFE_API_KEY",
      ]);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("lists configured secret keys without exporting secret values", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "pea-secret-store-memory-"));

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
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(helperPath, 0o755);

      const spawn = spyOn(Bun, "spawn").mockImplementation(({ cmd }) => {
        const [, command] = cmd;
        if (command !== "list") {
          throw new Error(`Unexpected helper command: ${command}`);
        }

        return createSpawnResult(0, '["EOA_PRIVATE_KEY","SAFE_API_KEY"]');
      });

      await expect(listStoredSecretKeys()).resolves.toEqual([
        "EOA_PRIVATE_KEY",
        "SAFE_API_KEY",
      ]);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(getSpawnCommand(spawn.mock.calls[0]?.[0])).toEqual([
        realpathSync(helperPath),
        "list",
        "com.lfglabs.private-ethereum-assistant",
      ]);

      await expect(listStoredSecretKeys()).resolves.toEqual([
        "EOA_PRIVATE_KEY",
        "SAFE_API_KEY",
      ]);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("merges saved values into the loaded in-memory cache", async () => {
    rememberStoredSecret("SAFE_API_KEY", "new-safe-api-key");

    await expect(getSecret("SAFE_API_KEY")).resolves.toBe("new-safe-api-key");
  });

  test("developer mode prefers encrypted env secrets over Keychain", async () => {
    const originalAppMode = process.env.APP_MODE;
    const originalEoaPrivateKey = process.env.EOA_PRIVATE_KEY;
    const originalRailgunMnemonic = process.env.RAILGUN_MNEMONIC;

    process.env.APP_MODE = "developer";
    process.env.EOA_PRIVATE_KEY = "env-eoa-secret";
    process.env.RAILGUN_MNEMONIC =
      "test test test test test test test test test test test junk";

    try {
      await expect(getSecret("EOA_PRIVATE_KEY")).resolves.toBe("env-eoa-secret");
      await expect(listStoredSecretKeys()).resolves.toEqual([
        "EOA_PRIVATE_KEY",
        "RAILGUN_MNEMONIC",
      ]);
    } finally {
      if (originalAppMode === undefined) {
        delete process.env.APP_MODE;
      } else {
        process.env.APP_MODE = originalAppMode;
      }

      if (originalEoaPrivateKey === undefined) {
        delete process.env.EOA_PRIVATE_KEY;
      } else {
        process.env.EOA_PRIVATE_KEY = originalEoaPrivateKey;
      }

      if (originalRailgunMnemonic === undefined) {
        delete process.env.RAILGUN_MNEMONIC;
      } else {
        process.env.RAILGUN_MNEMONIC = originalRailgunMnemonic;
      }
    }
  });

  test("explicit export seeds later reads from memory", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "pea-secret-store-export-"));

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
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(helperPath, 0o755);

      const spawn = spyOn(Bun, "spawn").mockImplementation(({ cmd }) => {
        const [, command] = cmd;
        if (command !== "export") {
          throw new Error(`Unexpected helper command: ${command}`);
        }

        return createSpawnResult(
          0,
          JSON.stringify({
            EOA_PRIVATE_KEY: "eoa-secret",
            SAFE_API_KEY: "safe-api-key",
          }),
        );
      });

      await expect(loadAllSecrets()).resolves.toEqual({
        EOA_PRIVATE_KEY: "eoa-secret",
        SAFE_API_KEY: "safe-api-key",
      });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(getSpawnCommand(spawn.mock.calls[0]?.[0])).toEqual([
        realpathSync(helperPath),
        "export",
        "com.lfglabs.private-ethereum-assistant",
      ]);

      await expect(getSecret("EOA_PRIVATE_KEY")).resolves.toBe("eoa-secret");
      await expect(listStoredSecretKeys()).resolves.toEqual([
        "EOA_PRIVATE_KEY",
        "SAFE_API_KEY",
      ]);
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
