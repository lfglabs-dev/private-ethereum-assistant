import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  MAC_KEYCHAIN_SERVICE,
  MacKeychainBackend,
} from "./backends/macos-keychain";

function createSpawnResult(exitCode: number, stdout = "", stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
  } as Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
}

function getSpawnOptions(
  call: unknown,
): {
  stdin: Blob | "ignore";
} {
  if (!call || typeof call !== "object" || !("stdin" in call)) {
    throw new Error("Expected Bun.spawn to be called with an options object.");
  }

  return call as { stdin: Blob | "ignore" };
}

describe("MacKeychainBackend", () => {
  afterEach(() => {
    mock.restore();
  });

  test("reads secrets from the helper", async () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(() =>
      createSpawnResult(0, "secret-value"),
    );
    const backend = new MacKeychainBackend(
      MAC_KEYCHAIN_SERVICE,
      "/tmp/keychain-helper",
    );

    await expect(backend.get("EOA_PRIVATE_KEY")).resolves.toBe("secret-value");
    expect(spawn).toHaveBeenCalledWith({
      cmd: [
        "/tmp/keychain-helper",
        "get",
        MAC_KEYCHAIN_SERVICE,
        "EOA_PRIVATE_KEY",
      ],
      cwd: process.cwd(),
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  test("returns null when a secret is missing", async () => {
    spyOn(Bun, "spawn").mockImplementation(() => createSpawnResult(1));
    const backend = new MacKeychainBackend(
      MAC_KEYCHAIN_SERVICE,
      "/tmp/keychain-helper",
    );

    await expect(backend.get("SAFE_API_KEY")).resolves.toBeNull();
  });

  test("writes secret values to stdin when storing", async () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => createSpawnResult(0));
    const backend = new MacKeychainBackend(
      MAC_KEYCHAIN_SERVICE,
      "/tmp/keychain-helper",
    );

    await backend.set("SAFE_SIGNER_PRIVATE_KEY", "0xabc");

    const stdin = getSpawnOptions(spawn.mock.calls[0]?.[0]).stdin;
    expect(stdin).toBeInstanceOf(Blob);
    await expect((stdin as Blob).text()).resolves.toBe("0xabc");
  });

  test("parses list output as JSON", async () => {
    spyOn(Bun, "spawn").mockImplementation(() =>
      createSpawnResult(0, '["EOA_PRIVATE_KEY","SAFE_API_KEY"]'),
    );
    const backend = new MacKeychainBackend(
      MAC_KEYCHAIN_SERVICE,
      "/tmp/keychain-helper",
    );

    await expect(backend.list()).resolves.toEqual([
      "EOA_PRIVATE_KEY",
      "SAFE_API_KEY",
    ]);
  });

  test("parses exported secrets as JSON", async () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(() =>
      createSpawnResult(
        0,
        '{"EOA_PRIVATE_KEY":"secret-value","SAFE_API_KEY":"safe-api-key"}',
      ),
    );
    const backend = new MacKeychainBackend(
      MAC_KEYCHAIN_SERVICE,
      "/tmp/keychain-helper",
    );

    await expect(backend.loadAll()).resolves.toEqual({
      EOA_PRIVATE_KEY: "secret-value",
      SAFE_API_KEY: "safe-api-key",
    });
    expect(spawn).toHaveBeenCalledWith({
      cmd: ["/tmp/keychain-helper", "export", MAC_KEYCHAIN_SERVICE],
      cwd: process.cwd(),
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  });

  test("surfaces denied access distinctly", async () => {
    spyOn(Bun, "spawn").mockImplementation(() =>
      createSpawnResult(2, "", "denied"),
    );
    const backend = new MacKeychainBackend(
      MAC_KEYCHAIN_SERVICE,
      "/tmp/keychain-helper",
    );

    await expect(backend.set("EOA_PRIVATE_KEY", "secret")).rejects.toThrow(
      'macOS Keychain access was denied while running "set".',
    );
  });
});
