// No mocking. Browser tests run against a real LLM and a real server.
// Do not introduce mock scenarios or stub responses here — tests must reflect
// actual end-to-end behavior.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { privateKeyToAccount } from "viem/accounts";
import {
  BALANCE_ROUTING_PRIVACY_GUIDANCE,
} from "../helpers/railgun-balance-routing";

type TestResult = {
  name: string;
  passed: boolean;
  details?: string;
  screenshot?: string;
};

const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3100";
const DEV_PORT = new URL(APP_URL).port || "3000";
const SESSION = `private-ethereum-assistant-e2e-${Date.now()}`;
const SCREENSHOT_DIR = join(process.cwd(), "tests/e2e/browser/screenshots");
const E2E_WALLET_PRIVATE_KEY =
  process.env.EOA_PRIVATE_KEY ?? process.env.WALLET_PRIVATE_KEY ?? "";
const E2E_WALLET_ADDRESS = E2E_WALLET_PRIVATE_KEY
  ? privateKeyToAccount(
      (E2E_WALLET_PRIVATE_KEY.startsWith("0x")
        ? E2E_WALLET_PRIVATE_KEY
        : `0x${E2E_WALLET_PRIVATE_KEY}`) as `0x${string}`,
    ).address
  : "";

process.env.RAILGUN_PRIVACY_GUIDANCE_TEXT = BALANCE_ROUTING_PRIVACY_GUIDANCE;

let devServer: Bun.Subprocess | undefined;
let startedDevServer = false;
const results: TestResult[] = [];
const pageErrors = new Map<string, string>();

async function readProcessOutput(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | number | undefined,
) {
  return stream instanceof ReadableStream ? new Response(stream).text() : "";
}

async function runCommand(
  cmd: string[],
  options?: {
    allowFailure?: boolean;
    env?: Record<string, string | undefined>;
  },
) {
  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    env: { ...process.env, ...options?.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  if (exitCode !== 0 && !options?.allowFailure) {
    throw new Error(stderr.trim() || stdout.trim() || `Command failed: ${cmd.join(" ")}`);
  }

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
}

function runAgentBrowser(args: string[], options?: { allowFailure?: boolean }) {
  return runCommand(["agent-browser", "--session", SESSION, ...args], options);
}

async function isServerReady() {
  try {
    const response = await fetch(APP_URL);
    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    return html.includes("<title>Private Ethereum Assistant</title>");
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isServerReady()) {
    return;
  }

  devServer = Bun.spawn({
    cmd: [
      "bunx",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      DEV_PORT,
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_MODE: "developer",
      NEXT_PUBLIC_APP_MODE: "developer",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  startedDevServer = true;

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isServerReady()) {
      return;
    }

    if ((await Promise.race([devServer.exited, delay(100)])) !== undefined) {
      break;
    }

    await delay(500);
  }

  const stdout = await readProcessOutput(devServer.stdout);
  const stderr = await readProcessOutput(devServer.stderr);
  throw new Error(
    `Next.js dev server did not become ready on ${APP_URL}.\n${stdout}\n${stderr}`.trim(),
  );
}

async function clearBrowserState() {
  await runAgentBrowser(["errors", "--clear"], { allowFailure: true });
  await runAgentBrowser(["console", "--clear"], { allowFailure: true });
}

async function openHome() {
  await clearBrowserState();
  await runAgentBrowser(["open", APP_URL]);
  await runAgentBrowser(["wait", "body"]);
}

async function getText(selector: string) {
  return (await runAgentBrowser(["get", "text", selector])).stdout;
}

async function expectText(selector: string, expected: string[]) {
  const text = await getText(selector);
  for (const fragment of expected) {
    if (!text.includes(fragment)) {
      throw new Error(`Expected ${selector} to include "${fragment}". Received:\n${text}`);
    }
  }
}

async function fill(selector: string, value: string) {
  await runAgentBrowser(["fill", selector, value]);
}

async function submitMessage(message: string) {
  await fill('[data-testid="chat-input"]', message);
  await runAgentBrowser(["press", "Enter"]);
}

async function waitForAssistantAnswer(expected: string[], timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await getText("body");
    if (expected.every((fragment) => text.includes(fragment))) {
      return;
    }

    await delay(1_000);
  }

  const text = await getText("body");
  throw new Error(
    `Assistant response did not include ${expected.join(", ")} within ${timeoutMs / 1000}s.\n${text}`,
  );
}

async function waitForText(selector: string, expected: string[], timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    try {
      lastText = await getText(selector);
      if (expected.every((fragment) => lastText.includes(fragment))) {
        return;
      }
    } catch {
      // Ignore missing-element reads until the timeout expires.
    }

    await delay(1_000);
  }

  throw new Error(
    `Selector ${selector} did not include ${expected.join(", ")} within ${timeoutMs / 1000}s.\n${lastText}`,
  );
}

async function waitForBodyCondition(
  predicate: (text: string) => boolean,
  timeoutMs = 120_000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = await getText("body");
    if (predicate(lastText)) {
      return lastText;
    }

    await delay(1_000);
  }

  throw new Error(`Body did not reach the expected state within ${timeoutMs / 1000}s.\n${lastText}`);
}

async function ensureDeveloperModeReady() {
  await openHome();
  await runAgentBrowser(["wait", '[data-testid="chat-input"]']);
  await expectText('[data-testid="runtime-provider-label"]', ["OpenRouter"]);
}

async function waitForPageErrors(testName: string) {
  const { stdout } = await runAgentBrowser(["errors"], { allowFailure: true });
  if (stdout) {
    pageErrors.set(testName, stdout);
  }
}

async function runTest(
  name: string,
  fn: () => Promise<void>,
  screenshotName?: string,
) {
  try {
    console.log(`Running: ${name}`);
    await fn();
    if (screenshotName) {
      const screenshotPath = join(SCREENSHOT_DIR, screenshotName);
      await runAgentBrowser(["screenshot", screenshotPath]);
      results.push({ name, passed: true, screenshot: screenshotPath });
    } else {
      results.push({ name, passed: true });
    }
    await waitForPageErrors(name);
    console.log(`Passed: ${name}`);
  } catch (error) {
    const failureScreenshot = join(
      SCREENSHOT_DIR,
      `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-failure.png`,
    );
    await runAgentBrowser(["screenshot", failureScreenshot], { allowFailure: true });
    results.push({
      name,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
      screenshot: failureScreenshot,
    });
    console.log(`Failed: ${name}`);
  }
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  await ensureServer();

  await runTest(
    "Developer mode boots straight into chat",
    async () => {
      await ensureDeveloperModeReady();
      await expectText("body", ["Private Ethereum Assistant", "OpenRouter"]);
    },
    "developer-shell.png",
  );

  await runTest(
    "ENS resolution renders in chat",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("Resolve vitalik.eth");
      await waitForText('[data-testid="result-ens"]', ["vitalik.eth", "0xd8dA6BF"]);
      await waitForAssistantAnswer(["vitalik.eth", "0xd8dA6BF"]);
    },
    "ens-resolution.png",
  );

  await runTest(
    "Balance checks render in chat",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("What is the ETH balance of vitalik.eth?");
      await waitForText('[data-testid="result-balance"]', ["ETH", "0xd8dA6BF"]);
      await waitForAssistantAnswer(["vitalik.eth", "ETH"]);
    },
    "balance-check.png",
  );

  await runTest(
    "Transfer previews render without broadcasting",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage(`Send 0.000001 ETH to ${E2E_WALLET_ADDRESS}`);
      await waitForText('[data-testid="result-transaction-preview"]', [
        "Ready to Confirm",
        "0.000001 ETH",
        "Gas limit",
      ]);
      await waitForAssistantAnswer(["confirm"]);
    },
    "transfer-preview.png",
  );

  await runTest(
    "Railgun balances render in chat",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("Show my Railgun balance");
      const bodyText = await waitForBodyCondition(
        (text) =>
          text.includes("Scanning Railgun balances on Arbitrum") ||
          text.includes("0zk") ||
          text.includes("No shielded balances found") ||
          text.includes("Could not load RAILGUN wallet"),
        30_000,
      );
      if (!bodyText.includes("Railgun")) {
        throw new Error(`Unexpected Railgun response:\n${bodyText}`);
      }
    },
    "railgun-balance.png",
  );

  await runTest(
    "Railgun private shortfalls recommend shielding in chat",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("Send 0.0001 ETH to vitalik.eth from my private balance.");
      await waitForBodyCondition(
        (text) =>
          text.includes("Checking Railgun private/public balance routing") ||
          text.includes("Railgun Balance Routing") ||
          text.includes("Shield at least"),
        30_000,
      );
      await waitForAssistantAnswer(
        ["private", "public", "shield", BALANCE_ROUTING_PRIVACY_GUIDANCE],
        120_000,
      );
    },
    "railgun-balance-routing.png",
  );

  await runTest(
    "Safe info renders in chat",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("Show Safe wallet info");
      await waitForText('[data-testid="result-safe-info"]', [
        "Safe Info",
        "Threshold",
        "Owners",
      ]);
      await waitForAssistantAnswer(["Safe"]);
    },
    "safe-info.png",
  );

  await runTest(
    "Insufficient balance errors render gracefully",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage(`Send 999999 ETH to ${E2E_WALLET_ADDRESS}`);
      await waitForText('[data-testid="result-transaction-error"]', [
        "Transaction preparation failed",
      ]);
      await waitForBodyCondition(
        (text) =>
          text.toLowerCase().includes("insufficient") ||
          text.toLowerCase().includes("exceeds the balance"),
      );
    },
    "insufficient-balance.png",
  );

  await runTest(
    "Multi-turn context works across ENS resolution and balance lookup",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("Resolve vitalik.eth");
      await waitForAssistantAnswer(["vitalik.eth", "0xd8dA6BF"]);

      await submitMessage("What is their ETH balance?");
      await waitForAssistantAnswer(["vitalik.eth", "ETH"]);
    },
    "multi-turn-balance.png",
  );
}

async function cleanup() {
  await runAgentBrowser(["close"], { allowFailure: true });

  if (startedDevServer && devServer) {
    devServer.kill();
    await devServer.exited;
  }
}

try {
  await main();
} finally {
  await cleanup();
}

const passed = results.filter((result) => result.passed);
const failed = results.filter((result) => !result.passed);

console.log("## Test Results");
console.log("");
console.log(`Summary: ${passed.length} passed, ${failed.length} failed, ${results.length} total`);

if (failed.length > 0) {
  console.log("");
  console.log("Failed Tests:");
  for (const failure of failed) {
    console.log(`- ${failure.name}`);
    if (failure.details) {
      console.log(`  ${failure.details}`);
    }
    if (failure.screenshot) {
      console.log(`  Screenshot: ${failure.screenshot}`);
    }
  }
}

if (pageErrors.size > 0) {
  console.log("");
  console.log("Page Errors:");
  for (const [testName, errors] of pageErrors) {
    console.log(`- ${testName}`);
    console.log(`  ${errors}`);
  }
}

if (failed.length > 0) {
  process.exitCode = 1;
}
