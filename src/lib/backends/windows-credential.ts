import { existsSync } from "node:fs";
import path from "node:path";
import type { SecretBackend } from "../secret-store";
import { SECRET_STORE_SERVICE } from "./constants";

export const WINDOWS_CREDENTIAL_SERVICE = SECRET_STORE_SERVICE;
const CREDENTIAL_HELPER_RELATIVE_PATH = "native/credential-helper/credential-helper.ps1";

type SpawnResult = Pick<
  Bun.Subprocess<Blob | "ignore", "pipe", "pipe">,
  "exited" | "stdout" | "stderr"
>;

type SpawnLike = typeof Bun.spawn;

export function getWindowsCredentialHelperPath(rootDir = process.cwd()) {
  return path.resolve(rootDir, CREDENTIAL_HELPER_RELATIVE_PATH);
}

async function readOutput(
  stream: ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined,
) {
  if (!stream || typeof stream === "number") {
    return "";
  }

  return new Response(stream).text();
}

export class WindowsCredentialBackend implements SecretBackend {
  readonly name = "Windows Credential Manager";

  constructor(
    private readonly serviceName = WINDOWS_CREDENTIAL_SERVICE,
    private readonly helperPath = getWindowsCredentialHelperPath(),
    private readonly spawn: SpawnLike = Bun.spawn,
  ) {}

  isAvailable() {
    return process.platform === "win32" && existsSync(this.helperPath);
  }

  async get(account: string) {
    const result = await this.run("get", account);
    if (result.exitCode === 1) {
      return null;
    }

    this.assertSuccess("get", account, result);
    return result.stdout;
  }

  async set(account: string, value: string) {
    const result = await this.run("set", account, value);
    this.assertSuccess("set", account, result);
  }

  async delete(account: string) {
    const result = await this.run("delete", account);
    if (result.exitCode === 1) {
      return;
    }

    this.assertSuccess("delete", account, result);
  }

  async list() {
    const result = await this.run("list");
    this.assertSuccess("list", undefined, result);

    const parsed = JSON.parse(result.stdout || "[]");
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new Error(`${this.name} returned an invalid account list.`);
    }

    return parsed;
  }

  async loadAll() {
    const result = await this.run("export");
    this.assertSuccess("export", undefined, result);

    const parsed = JSON.parse(result.stdout || "{}");
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(
        ([key, value]) => typeof key !== "string" || typeof value !== "string",
      )
    ) {
      throw new Error(`${this.name} returned an invalid secret export.`);
    }

    return parsed as Record<string, string>;
  }

  private async run(command: string, account?: string, input?: string) {
    const proc = this.spawn({
      cmd: [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.helperPath,
        command,
        this.serviceName,
        ...(account ? [account] : []),
      ],
      cwd: process.cwd(),
      env: process.env,
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
    account: string | undefined,
    result: { exitCode: number; stderr: string },
  ) {
    if (result.exitCode === 0) {
      return;
    }

    const scope = account ? ` for ${account}` : "";
    throw new Error(
      result.stderr || `${this.name} ${command}${scope} failed with exit code ${result.exitCode}.`,
    );
  }
}
