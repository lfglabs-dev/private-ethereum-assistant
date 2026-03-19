import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { getMacKeychainHelperPath } from "../src/lib/backends/macos-keychain";
import { SECRET_STORE_KEYS } from "../src/lib/secret-store";

export {};

const args = process.argv.slice(2);
const cwd = process.cwd();
const bunBin = Bun.which("bun") ?? "bun";
const ollamaBin = Bun.which("ollama");
const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
const requiredDeps = [
  ["next", nextBin],
  ["typescript", path.join(cwd, "node_modules", "typescript", "package.json")],
];
const missingDeps = requiredDeps.filter(([, depPath]) => !existsSync(depPath));
const defaultBaseUrl = process.env.LLM_BASE_URL || "http://localhost:11434/v1";
const defaultModel = process.env.LLM_MODEL || "llama3.2:3b";
const baseUrl = new URL(defaultBaseUrl);
const requestedPort = getPort(args);
const managesOllama = isManagedOllamaBaseUrl(baseUrl);

if (missingDeps.length > 0) {
  const missingNames = missingDeps.map(([name]) => name).join(", ");
  console.error(
    `Missing local dependencies (${missingNames}). Run "bun install --frozen-lockfile" before starting the app.`,
  );
  process.exit(1);
}

console.log("Starting Private Ethereum Assistant in normal mode.");
console.log(`Local model base URL: ${baseUrl.toString()}`);
console.log(`Local model: ${defaultModel}`);

let ollamaProc: Bun.Subprocess | undefined;
let appProc: Bun.Subprocess | undefined;
let startedOllama = false;
let shuttingDown = false;
let managedAppUrl = "";

try {
  if (managesOllama) {
    if (!ollamaBin) {
      throw new Error(
        'Ollama is required for the default local flow, but "ollama" was not found in PATH.\nInstall Ollama or set LLM_BASE_URL and LLM_MODEL for another local OpenAI-compatible server.',
      );
    }

    const ollamaReady = await isOllamaReady(baseUrl.origin);
    if (!ollamaReady) {
      console.log("Ollama is not running. Starting it now...");
      ollamaProc = Bun.spawn({
        cmd: [ollamaBin, "serve"],
        cwd,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      startedOllama = true;
      await waitForOllama(baseUrl.origin, ollamaProc);
    } else {
      console.log("Ollama is already running.");
    }

    console.log(`Ensuring the local model is available: ${defaultModel}`);
    await runCommand([ollamaBin, "pull", defaultModel]);
  } else {
    console.log(
      "Skipping Ollama management because LLM_BASE_URL points at a custom server.",
    );
  }

  await ensureCredentialStoreReady();

  process.on("SIGINT", () => {
    void shutdown(130);
  });
  process.on("SIGTERM", () => {
    void shutdown(143);
  });

  const existingAppUrl = await findExistingAppUrl();
  if (existingAppUrl) {
    const existingAppHealthy = await isHttpReady(existingAppUrl, 5_000);
    if (!existingAppHealthy) {
      throw new Error(
        `Found an existing app server for this workspace at ${existingAppUrl}, but it is not responding.\nStop the stale server and rerun "bun run local".`,
      );
    }

    console.log(`Reusing existing app server: ${existingAppUrl}`);
    openBrowser(existingAppUrl);

    if (startedOllama) {
      console.log("Press Ctrl+C to stop the managed Ollama process.");
      await keepAlive();
    }

    await shutdown(0);
  } else {
    const selectedPort = await findAvailablePort(requestedPort);
    if (selectedPort !== requestedPort) {
      console.log(`Port ${requestedPort} is in use. Starting the app on ${selectedPort} instead.`);
    }

    managedAppUrl = `http://localhost:${selectedPort}`;
    console.log(`App URL: ${managedAppUrl}`);

    appProc = Bun.spawn({
      cmd: [bunBin, nextBin, "dev", ...normalizePortArgs(args, selectedPort)],
      cwd,
      env: getCleanEnv(),
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });

    await waitForHttp(managedAppUrl);
    openBrowser(managedAppUrl);

    const exitCode = await appProc.exited;
    await shutdown(exitCode);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await shutdown(1);
}

function getPort(forwardedArgs: string[]) {
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index];
    if (arg === "--port" || arg === "-p") {
      const value = forwardedArgs[index + 1];
      if (value && /^\d+$/.test(value)) {
        return value;
      }
    }

    const portMatch = arg.match(/^--port=(\d+)$/);
    if (portMatch) {
      return portMatch[1];
    }
  }

  return process.env.PORT || "3000";
}

function isManagedOllamaBaseUrl(url: URL) {
  return (
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    (url.port === "" || url.port === "11434") &&
    (url.pathname === "/v1" || url.pathname === "/v1/")
  );
}

function normalizePortArgs(forwardedArgs: string[], port: string) {
  const nextArgs: string[] = [];
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index];
    if (arg === "--port" || arg === "-p") {
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      continue;
    }

    nextArgs.push(arg);
  }

  nextArgs.push("--port", port);
  return nextArgs;
}

async function isOllamaReady(origin: string) {
  try {
    const response = await fetch(new URL("/api/tags", origin));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForOllama(origin: string, proc: Bun.Subprocess) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isOllamaReady(origin)) {
      return;
    }

    if ((await Promise.race([proc.exited, Bun.sleep(100)])) !== undefined) {
      break;
    }

    await Bun.sleep(400);
  }

  const stdout = await readProcessOutput(proc.stdout);
  const stderr = await readProcessOutput(proc.stderr);
  throw new Error(
    `Ollama did not become ready on ${origin}.\n${stdout}\n${stderr}`.trim(),
  );
}

async function isHttpReady(url: string, timeoutMs: number) {
  const effectiveDeadline = Date.now() + timeoutMs;
  while (Date.now() < effectiveDeadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Ignore connection errors while the server is starting.
    }

    await Bun.sleep(500);
  }

  return false;
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore connection errors while the dev server is starting.
    }

    await Bun.sleep(500);
  }

  throw new Error(`App did not become ready on ${url}.`);
}

async function findExistingAppUrl() {
  const serverPath = `${cwd}/node_modules/next/dist/server/lib/start-server.js`;
  const processList = await runCommandCapture(["ps", "-axo", "pid=,command="]);
  const matchingLine = processList
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes(serverPath));

  if (!matchingLine) {
    return null;
  }

  const pid = matchingLine.split(/\s+/, 1)[0];
  const lsofOutput = await runCommandCapture([
    "lsof",
    "-nP",
    "-a",
    "-p",
    pid,
    "-iTCP",
    "-sTCP:LISTEN",
  ]);

  const portMatch = lsofOutput.match(/TCP\s+\*:(\d+)\s+\(LISTEN\)/);
  return portMatch ? `http://localhost:${portMatch[1]}` : null;
}

async function findAvailablePort(startPort: string) {
  let port = Number(startPort);
  if (!Number.isFinite(port) || port <= 0) {
    port = 3000;
  }

  for (; port < 3100; port += 1) {
    if (await canListen(port)) {
      return String(port);
    }
  }

  throw new Error(`Could not find an open port starting from ${startPort}.`);
}

async function canListen(port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "localhost", () => {
      server.close(() => resolve(true));
    });
  });
}

async function runCommand(cmd: string[]) {
  const proc = Bun.spawn({
    cmd,
    cwd,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")}`);
  }
}

async function runCommandInDir(cmd: string[], workdir = cwd) {
  const proc = Bun.spawn({
    cmd,
    cwd: workdir,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd.join(" ")}`);
  }
}

async function runCommandCapture(cmd: string[], workdir = cwd) {
  const proc = Bun.spawn({
    cmd,
    cwd: workdir,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `Command failed: ${cmd.join(" ")}`);
  }

  return stdout;
}

async function ensureCredentialStoreReady() {
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is required to store wallet secrets.");
  }

  const helperPath = getMacKeychainHelperPath(cwd);
  if (existsSync(helperPath)) {
    return;
  }

  const swiftBin = Bun.which("swift");
  if (!swiftBin) {
    throw new Error(
      "Swift is required to build the macOS Keychain helper. Install Xcode Command Line Tools or run `bun run build:keychain` first.",
    );
  }

  const keychainProjectDir = path.join(cwd, "native", "keychain-helper");
  console.log("Building macOS Keychain helper...");

  await runCommandInDir([swiftBin, "build", "-c", "release"], keychainProjectDir);

  if (!existsSync(helperPath)) {
    throw new Error("Failed to build the macOS Keychain helper.");
  }
}

function openBrowser(url: string) {
  const openBin = Bun.which("open");
  if (!openBin) {
    return;
  }

  Bun.spawn({
    cmd: [openBin, url],
    cwd,
    env: process.env,
    stdout: "ignore",
    stderr: "ignore",
  });
}

async function keepAlive() {
  await new Promise(() => undefined);
}

async function readProcessOutput(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | number | undefined,
) {
  return stream instanceof ReadableStream ? new Response(stream).text() : "";
}

function getCleanEnv() {
  const env = { ...process.env };
  for (const key of SECRET_STORE_KEYS) {
    delete env[key];
  }
  return env;
}

async function shutdown(exitCode: number) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (appProc && appProc.exitCode === null) {
    appProc.kill();
    await appProc.exited.catch(() => undefined);
  }

  if (startedOllama && ollamaProc && ollamaProc.exitCode === null) {
    ollamaProc.kill();
    await ollamaProc.exited.catch(() => undefined);
  }

  process.exit(exitCode);
}
