import type { SecretBackend } from "../secret-store";
import {
  SECRET_STORE_ACCOUNT_ATTRIBUTE,
  SECRET_STORE_LABEL_PREFIX,
  SECRET_STORE_SERVICE,
  SECRET_STORE_SERVICE_ATTRIBUTE,
} from "./constants";

type SpawnResult = Pick<
  Bun.Subprocess<Blob | "ignore", "pipe", "pipe">,
  "exited" | "stdout" | "stderr"
>;

type SpawnLike = typeof Bun.spawn;

type SyncCommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type SyncRunLike = (cmd: string[], env?: NodeJS.ProcessEnv) => SyncCommandResult;

const textDecoder = new TextDecoder();

function decodeOutput(output: string | Uint8Array | null | undefined) {
  if (!output) {
    return "";
  }

  if (typeof output === "string") {
    return output;
  }

  return textDecoder.decode(output);
}

function runSyncCommand(cmd: string[], env = process.env): SyncCommandResult {
  const result = Bun.spawnSync({
    cmd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: decodeOutput(result.stdout),
    stderr: decodeOutput(result.stderr).trim(),
  };
}

async function readOutput(
  stream: ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined,
) {
  if (!stream || typeof stream === "number") {
    return "";
  }

  return new Response(stream).text();
}

function isCommandAvailable(command: string, runSync: SyncRunLike, env = process.env) {
  const result = runSync(["/bin/sh", "-lc", `command -v "${command}" >/dev/null 2>&1`], env);
  return result.exitCode === 0;
}

function hasSecretServiceOwner(runSync: SyncRunLike, env = process.env) {
  if (isCommandAvailable("dbus-send", runSync, env)) {
    const result = runSync([
      "dbus-send",
      "--session",
      "--dest=org.freedesktop.DBus",
      "--type=method_call",
      "--print-reply",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus.NameHasOwner",
      "string:org.freedesktop.secrets",
    ], env);
    return result.exitCode === 0 && /\bboolean true\b/.test(result.stdout);
  }

  if (isCommandAvailable("gdbus", runSync, env)) {
    const result = runSync([
      "gdbus",
      "call",
      "--session",
      "--dest",
      "org.freedesktop.DBus",
      "--object-path",
      "/org/freedesktop/DBus",
      "--method",
      "org.freedesktop.DBus.NameHasOwner",
      "org.freedesktop.secrets",
    ], env);
    return result.exitCode === 0 && /\(\s*true\b/.test(result.stdout);
  }

  return false;
}

export function isLinuxSecretServiceAvailable(
  platform = process.platform,
  env = process.env,
  runSync: SyncRunLike = runSyncCommand,
) {
  if (platform !== "linux") {
    return false;
  }

  if (!env.DBUS_SESSION_BUS_ADDRESS?.trim()) {
    return false;
  }

  if (!isCommandAvailable("secret-tool", runSync, env)) {
    return false;
  }

  return hasSecretServiceOwner(runSync, env);
}

export class LinuxSecretServiceBackend implements SecretBackend {
  readonly name = "Linux Secret Service";

  constructor(
    private readonly knownAccounts: readonly string[],
    private readonly serviceName = SECRET_STORE_SERVICE,
    private readonly spawn: SpawnLike = Bun.spawn,
    private readonly runSync: SyncRunLike = runSyncCommand,
    private readonly env = process.env,
  ) {}

  isAvailable() {
    return isLinuxSecretServiceAvailable(process.platform, this.env, this.runSync);
  }

  async get(account: string) {
    const result = await this.run("lookup", [
      SECRET_STORE_SERVICE_ATTRIBUTE,
      this.serviceName,
      SECRET_STORE_ACCOUNT_ATTRIBUTE,
      account,
    ]);
    if (result.exitCode === 1) {
      return null;
    }

    this.assertSuccess("lookup", account, result);
    return result.stdout;
  }

  async set(account: string, value: string) {
    const result = await this.run(
      "store",
      [
        `--label=${this.getLabel(account)}`,
        SECRET_STORE_SERVICE_ATTRIBUTE,
        this.serviceName,
        SECRET_STORE_ACCOUNT_ATTRIBUTE,
        account,
      ],
      value,
    );
    this.assertSuccess("store", account, result);
  }

  async delete(account: string) {
    const result = await this.run("clear", [
      SECRET_STORE_SERVICE_ATTRIBUTE,
      this.serviceName,
      SECRET_STORE_ACCOUNT_ATTRIBUTE,
      account,
    ]);
    if (result.exitCode === 1) {
      return;
    }

    this.assertSuccess("clear", account, result);
  }

  async list() {
    const entries = await Promise.all(
      this.knownAccounts.map(async (account) => ({
        account,
        value: await this.get(account),
      })),
    );

    return entries.flatMap(({ account, value }) => (value === null ? [] : [account]));
  }

  async loadAll() {
    const entries = await Promise.all(
      this.knownAccounts.map(async (account) => [account, await this.get(account)] as const),
    );

    return Object.fromEntries(
      entries.flatMap(([account, value]) => (value === null ? [] : [[account, value]])),
    );
  }

  private getLabel(account: string) {
    return `${SECRET_STORE_LABEL_PREFIX}:${account}`;
  }

  private async run(command: string, args: string[], input?: string) {
    const proc = this.spawn({
      cmd: ["secret-tool", command, ...args],
      cwd: process.cwd(),
      env: this.env,
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    }) as SpawnResult;

    const [stdout, stderr, exitCode] = await Promise.all([
      readOutput(proc.stdout),
      readOutput(proc.stderr),
      proc.exited,
    ]);

    return {
      exitCode,
      stdout,
      stderr: stderr.trim(),
    };
  }

  private assertSuccess(
    command: string,
    account: string,
    result: { exitCode: number; stderr: string },
  ) {
    if (result.exitCode === 0) {
      return;
    }

    throw new Error(
      result.stderr ||
        `${this.name} ${command} for ${account} failed with exit code ${result.exitCode}.`,
    );
  }
}
