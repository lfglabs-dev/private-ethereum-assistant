import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  LinuxSecretServiceBackend,
  isLinuxSecretServiceAvailable,
} from "./backends/linux-secret-service";

function createSpawnResult(exitCode: number, stdout = "", stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
  } as Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
}

describe("LinuxSecretServiceBackend", () => {
  afterEach(() => {
    mock.restore();
  });

  test("checks for secret-tool, a session bus, and the Secret Service owner", () => {
    const calls: string[][] = [];
    const runSync = (cmd: string[]) => {
      calls.push(cmd);

      if (cmd[0] === "/bin/sh" && cmd[2]?.includes("secret-tool")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      if (cmd[0] === "/bin/sh" && cmd[2]?.includes("dbus-send")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      if (cmd[0] === "dbus-send") {
        return {
          exitCode: 0,
          stdout: 'method return time=0 sender=:1.2 -> dest=:1.3 serial=3 reply_serial=2\n   boolean true\n',
          stderr: "",
        };
      }

      throw new Error(`Unexpected command: ${cmd.join(" ")}`);
    };

    expect(
      isLinuxSecretServiceAvailable(
        "linux",
        { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus" },
        runSync,
      ),
    ).toBe(true);
    expect(calls).toHaveLength(3);
  });

  test("falls back when the D-Bus session bus is missing", () => {
    expect(
      isLinuxSecretServiceAvailable(
        "linux",
        process.env,
        () => {
          throw new Error("should not be called");
        },
      ),
    ).toBe(false);
  });

  test("stores and reads secrets through secret-tool", async () => {
    const calls: Array<{ cmd: string[]; stdin: Blob | "ignore" }> = [];
    const spawn = ((options: { cmd: string[]; stdin: Blob | "ignore" }) => {
      calls.push(options);
      const [, command, ...args] = options.cmd;

      if (command === "lookup") {
        return createSpawnResult(0, "secret-value");
      }

      if (command === "store") {
        expect(args).toEqual([
          "--label=private-ethereum-assistant:EOA_PRIVATE_KEY",
          "service",
          "com.lfglabs.private-ethereum-assistant",
          "account",
          "EOA_PRIVATE_KEY",
        ]);
        expect(options.stdin).toBeInstanceOf(Blob);
        return createSpawnResult(0);
      }

      throw new Error(`Unexpected command: ${options.cmd.join(" ")}`);
    }) as unknown as typeof Bun.spawn;
    const backend = new LinuxSecretServiceBackend(
      ["EOA_PRIVATE_KEY"],
      "com.lfglabs.private-ethereum-assistant",
      spawn,
      () => ({ exitCode: 0, stdout: "", stderr: "" }),
      { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus" },
    );

    await backend.set("EOA_PRIVATE_KEY", "secret-value");
    await expect((calls[0]?.stdin as Blob).text()).resolves.toBe("secret-value");
    await expect(backend.get("EOA_PRIVATE_KEY")).resolves.toBe("secret-value");
  });

  test("lists and exports only configured accounts", async () => {
    const values = new Map<string, string>([
      ["EOA_PRIVATE_KEY", "eoa-secret"],
      ["SAFE_API_KEY", "safe-api-key"],
    ]);
    const spawn = (({ cmd }: { cmd: string[] }) => {
      const account = cmd[cmd.length - 1];
      return createSpawnResult(values.has(account) ? 0 : 1, values.get(account) ?? "");
    }) as unknown as typeof Bun.spawn;
    const backend = new LinuxSecretServiceBackend(
      ["EOA_PRIVATE_KEY", "SAFE_API_KEY", "RAILGUN_MNEMONIC"],
      "com.lfglabs.private-ethereum-assistant",
      spawn,
      () => ({ exitCode: 0, stdout: "", stderr: "" }),
      { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/dbus" },
    );

    await expect(backend.list()).resolves.toEqual([
      "EOA_PRIVATE_KEY",
      "SAFE_API_KEY",
    ]);
    await expect(backend.loadAll()).resolves.toEqual({
      EOA_PRIVATE_KEY: "eoa-secret",
      SAFE_API_KEY: "safe-api-key",
    });
  });
});
