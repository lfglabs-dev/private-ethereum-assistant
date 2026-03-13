// No mocking. Browser tests run against a real LLM and a real server.
// Do not introduce mock scenarios or stub responses here — tests must reflect
// actual end-to-end behavior.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
const RUNTIME_CONFIG_STORAGE_KEY =
  "private-ethereum-assistant.runtime-config.v1";
const E2E_WALLET_PRIVATE_KEY =
  process.env.EOA_PRIVATE_KEY ?? process.env.WALLET_PRIVATE_KEY ?? "";
const E2E_OPENROUTER_MODEL = "qwen/qwen3.5-27b";

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

async function clearStoredRuntimeConfig() {
  await runAgentBrowser([
    "eval",
    `window.localStorage.removeItem(${JSON.stringify(RUNTIME_CONFIG_STORAGE_KEY)})`,
  ]);
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

async function completeOnboarding() {
  if (!E2E_WALLET_PRIVATE_KEY) {
    throw new Error(
      "Missing EOA_PRIVATE_KEY or WALLET_PRIVATE_KEY. Run the browser suite via dotenvx.",
    );
  }

  await runAgentBrowser(["wait", '[data-testid="runtime-onboarding-screen"]']);
  await runAgentBrowser(["click", '[data-testid="runtime-provider-openrouter"]']);
  await fill('[data-testid="runtime-active-model"]', E2E_OPENROUTER_MODEL);
  await fill('[data-testid="runtime-eoa-private-key"]', E2E_WALLET_PRIVATE_KEY);
  await runAgentBrowser(["click", '[data-testid="runtime-onboarding-submit"]']);
  await runAgentBrowser(["wait", '[data-testid="chat-input"]']);
}

async function openSettings() {
  await runAgentBrowser(["click", '[data-testid="runtime-settings-trigger"]']);
  await runAgentBrowser(["wait", '[data-testid="runtime-settings-save"]']);
}

async function saveSettings() {
  await runAgentBrowser(["click", '[data-testid="runtime-settings-save"]']);
  await delay(500);
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
    "First run shows onboarding",
    async () => {
      await openHome();
      await clearStoredRuntimeConfig();
      await openHome();
      await runAgentBrowser(["wait", '[data-testid="runtime-onboarding-screen"]']);
      await expectText("body", [
        "First-run onboarding",
        "No `.env.local` is required.",
        "OpenRouter",
      ]);
    },
    "onboarding.png",
  );

  await runTest(
    "OpenRouter onboarding persists and live chat succeeds",
    async () => {
      await openHome();
      await completeOnboarding();
      await expectText("body", ["Private Ethereum Assistant", "OpenRouter"]);
      await submitMessage("Resolve vitalik.eth");
      await waitForAssistantAnswer(["vitalik.eth", "0xd8dA6BF"]);
    },
    "openrouter-chat.png",
  );

  await runTest(
    "Settings edit, provider switching, and reload persistence work",
    async () => {
      await openHome();
      await openSettings();
      await runAgentBrowser(["select", '[data-testid="runtime-network-preset"]', "arbitrum"]);
      await runAgentBrowser(["click", '[data-testid="runtime-provider-local"]']);
      await saveSettings();
      await expectText('[data-testid="runtime-provider-label"]', ["Local"]);
      await expectText("body", ["Arbitrum One"]);

      await openHome();
      await expectText('[data-testid="runtime-provider-label"]', ["Local"]);
      await expectText("body", ["Arbitrum One"]);

      await openSettings();
      await runAgentBrowser(["click", '[data-testid="runtime-provider-openrouter"]']);
      await fill('[data-testid="runtime-active-model"]', E2E_OPENROUTER_MODEL);
      await saveSettings();
      await expectText('[data-testid="runtime-provider-label"]', ["OpenRouter"]);
      await submitMessage("Resolve vitalik.eth");
      await waitForAssistantAnswer(["vitalik.eth", "0xd8dA6BF"]);

      await openHome();
      await expectText('[data-testid="runtime-provider-label"]', ["OpenRouter"]);
      await expectText("body", ["Arbitrum One"]);
    },
    "settings-switch.png",
  );

  await runTest(
    "Delete all settings returns to onboarding",
    async () => {
      await openHome();
      await openSettings();
      await runAgentBrowser(["click", '[data-testid="runtime-settings-delete-all"]']);
      await runAgentBrowser(["wait", '[data-testid="runtime-onboarding-screen"]']);
      await expectText("body", ["First-run onboarding"]);
    },
    "delete-all.png",
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
