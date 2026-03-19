// No mocking. Browser tests run against a real LLM and a real server.
// Do not introduce mock scenarios or stub responses here — tests must reflect
// actual end-to-end behavior.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { privateKeyToAccount } from "viem/accounts";
import { getSecret } from "@/lib/secret-store";
import {
  BALANCE_ROUTING_ETH_AMOUNT,
  BALANCE_ROUTING_PRIVACY_GUIDANCE,
} from "../helpers/railgun-balance-routing";
import { ensureRailgunShieldedEthBalance } from "../helpers/railgun";

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
const E2E_WALLET_PRIVATE_KEY = (await getSecret("EOA_PRIVATE_KEY")) ?? "";
const HAS_SAFE_AUTOMATION = Boolean(
  (await getSecret("SAFE_API_KEY")) && E2E_WALLET_PRIVATE_KEY,
);
const E2E_WALLET_ADDRESS = E2E_WALLET_PRIVATE_KEY
  ? privateKeyToAccount(
      (E2E_WALLET_PRIVATE_KEY.startsWith("0x")
        ? E2E_WALLET_PRIVATE_KEY
        : `0x${E2E_WALLET_PRIVATE_KEY}`) as `0x${string}`,
    ).address
  : "";
const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

process.env.RAILGUN_PRIVACY_GUIDANCE_TEXT = BALANCE_ROUTING_PRIVACY_GUIDANCE;

let devServer: Bun.Subprocess | undefined;
let startedDevServer = false;
const RAILGUN_APPROVAL_TEST_THRESHOLD = "0.0000005";
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
      EOA_LOCAL_APPROVAL_NATIVE_THRESHOLD:
        process.env.E2E_LOCAL_APPROVAL_NATIVE_THRESHOLD ?? "0.00001",
      RAILGUN_SHIELD_APPROVAL_THRESHOLD: RAILGUN_APPROVAL_TEST_THRESHOLD,
      RAILGUN_TRANSFER_APPROVAL_THRESHOLD: RAILGUN_APPROVAL_TEST_THRESHOLD,
      RAILGUN_UNSHIELD_APPROVAL_THRESHOLD: RAILGUN_APPROVAL_TEST_THRESHOLD,
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

async function click(selector: string) {
  await runAgentBrowser(["click", selector]);
}

async function selectMode(mode: "eoa" | "safe" | "railgun") {
  const labelByMode = {
    eoa: "EOA",
    safe: "Safe",
    railgun: "Private",
  } as const;

  await click(`[data-testid="runtime-mode-picker-${mode}"]`);
  await waitForBodyCondition((text) => text.includes(`Mode ${labelByMode[mode]}`), 30_000);
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
  await runAgentBrowser(["wait", '[data-testid="runtime-mode-picker"]']);
  await expectText("body", ["OpenRouter", "Mode EOA"]);
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
    "Top-right mode picker switches modes manually",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("safe");
      await selectMode("railgun");
      await selectMode("eoa");
    },
    "mode-picker.png",
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
    "High-value transfers require local approval in chat",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage(`Send 0.00002 ETH to ${E2E_WALLET_ADDRESS}`);
      await waitForText('[data-testid="result-local-approval"]', [
        "Local Approval Required",
        "Recipient:",
        "Amount:",
        "Estimated gas:",
      ]);
      await waitForAssistantAnswer(["approval"]);
    },
    "local-approval-required.png",
  );

  await runTest(
    "Local approval approve path completes the send",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage(`Send 0.00002 ETH to ${E2E_WALLET_ADDRESS}`);
      await waitForText('[data-testid="result-local-approval"]', [
        "Local Approval Required",
      ]);
      await click('[data-testid="local-approval-approve"]');
      await waitForText('[data-testid="result-transaction-progress"]', [
        "Confirmed",
        "Tx hash:",
      ]);
    },
    "local-approval-approve.png",
  );

  await runTest(
    "Local approval reject path aborts without broadcast",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage(`Send 0.00002 ETH to ${E2E_WALLET_ADDRESS}`);
      await waitForText('[data-testid="result-local-approval"]', [
        "Local Approval Required",
      ]);
      await click('[data-testid="local-approval-reject"]');
      await waitForText('[data-testid="result-transaction-aborted"]', [
        "Transfer Aborted",
        "not signed or broadcast",
      ]);

      const bodyText = await getText("body");
      if (bodyText.includes("Tx hash:")) {
        throw new Error(`Reject flow should not broadcast a transaction.\n${bodyText}`);
      }
    },
    "local-approval-reject.png",
  );

  await runTest(
    "Railgun balances render in chat",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("railgun");
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
    "High-value Railgun shields require local approval and can be approved",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("railgun");
      await submitMessage(
        "I understand the Railgun deposit is public. Shield 0.000001 ETH into Railgun now.",
      );
      await waitForText('[data-testid="result-railgun-approval"]', [
        "Shield 0.000001 ETH",
        "Privacy impact",
        "Approve locally",
      ]);
      await runAgentBrowser(["click", '[data-testid="railgun-approval-approve"]']);
      await waitForBodyCondition(
        (text) =>
          text.includes("Shield transaction confirmed") &&
          text.includes("View on Arbiscan"),
        180_000,
      );
    },
    "railgun-approval-approve.png",
  );

  await runTest(
    "High-value Railgun unshields can be rejected locally without submission",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("railgun");
      await submitMessage(
        `I understand this exits the privacy pool. Unshield 0.0000001 ETH to ${E2E_WALLET_ADDRESS}.`,
      );
      await waitForText('[data-testid="result-railgun-approval"]', [
        "Unshield 0.0000001 ETH",
        "Privacy impact",
        "Reject",
      ]);
      await runAgentBrowser(["click", '[data-testid="railgun-approval-reject"]']);
      await waitForText('[data-testid="railgun-approval-cancelled"]', [
        "Local approval was rejected",
      ]);
      await waitForBodyCondition(
        (text) =>
          text.includes("No Railgun transaction was signed or submitted.") ||
          text.includes("Local approval was rejected"),
      );
    },
    "railgun-approval-reject.png",
  );

  await runTest(
    "Railgun private shortfalls recommend shielding in chat",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("railgun");
      await submitMessage(
        `Send ${BALANCE_ROUTING_ETH_AMOUNT} ETH to vitalik.eth from my private balance.`,
      );
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
    "Railgun public-recipient sends render as unshield flows",
    async () => {
      await ensureRailgunShieldedEthBalance("0.00001");
      await ensureDeveloperModeReady();
      await selectMode("railgun");
      await submitMessage("Send 0.00001 ETH to vitalik.eth from my private balance.");
      await waitForText(
        '[data-testid="result-railgun-unshield"]',
        ["Public recipient", VITALIK_ADDRESS, "Tx hash", "privacy pool"],
        360_000,
      );
      await waitForBodyCondition(
        (text) =>
          text.includes(VITALIK_ADDRESS) &&
          /0x[a-fA-F0-9]{64}/.test(text) &&
          text.toLowerCase().includes("privacy"),
        360_000,
      );
    },
    "railgun-public-send.png",
  );

  await runTest(
    "Out-of-mode requests show a confirmation widget and replay after confirmation",
    async () => {
      await ensureDeveloperModeReady();
      await submitMessage("Show Safe wallet info");
      await waitForText('[data-testid="mode-switch-card"]', [
        "Switch to Safe mode",
        "Requested: Safe",
      ]);
      await click('[data-testid="mode-switch-confirm"]');
      await waitForBodyCondition((text) => text.includes("Mode Safe"), 30_000);
      await waitForText('[data-testid="result-safe-info"]', [
        "Safe Info",
        "Threshold",
        "Owners",
      ]);
    },
    "mode-switch-confirmation.png",
  );

  await runTest(
    "Safe info renders in chat when Safe mode is active",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("safe");
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
    "Safe swap flow renders the CoW swap card",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("safe");
      await submitMessage("Swap 0.001 ETH for USDC.");
      await waitForText('[data-testid="result-swap"]', ["SAFE", "USDC"], 120_000);

      if (HAS_SAFE_AUTOMATION) {
        await waitForText(
          '[data-testid="result-swap"]',
          ["proposed", "Sign on Safe", "Safe Tx:"],
          120_000,
        );
      } else {
        await waitForText(
          '[data-testid="result-swap"]',
          ["manual action required", "Configure Safe API key"],
          120_000,
        );
      }

      await waitForAssistantAnswer(["Safe", "swap", "USDC"], 120_000);
    },
    "safe-swap-card.png",
  );

  await runTest(
    "Private-mode swap requests ask for an EOA mode switch",
    async () => {
      await ensureDeveloperModeReady();
      await selectMode("railgun");
      await submitMessage("Swap 0.001 ETH for USDC.");
      await waitForText('[data-testid="mode-switch-card"]', [
        "Switch to EOA mode",
        "Requested: EOA",
      ]);
    },
    "railgun-swap-mode-switch.png",
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
