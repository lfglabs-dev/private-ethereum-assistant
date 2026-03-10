import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { E2EChatMockScenario } from "@/lib/testing/e2e-chat-mocks"

type TestResult = {
  name: string
  passed: boolean
  details?: string
  screenshot?: string
}

const APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3100"
const DEV_PORT = new URL(APP_URL).port || "3000"
const SESSION = `private-ethereum-assistant-e2e-${Date.now()}`
const SCREENSHOT_DIR = join(process.cwd(), "tests/e2e/browser/screenshots")
const SHOULD_SKIP_LLM_SMOKE = process.env.E2E_SKIP_LLM_SMOKE === "1"
const E2E_CHAT_MOCK_STORAGE_KEY = "private-ethereum-assistant.e2e-chat-mock-scenario"
const E2E_LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://127.0.0.1:11434/v1"
const E2E_LLM_MODEL = process.env.LLM_MODEL ?? "llama3.1:latest"

let devServer: Bun.Subprocess | undefined
let startedDevServer = false
const results: TestResult[] = []
const pageErrors = new Map<string, string>()

async function readProcessOutput(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>> | number | undefined
) {
  return stream instanceof ReadableStream ? new Response(stream).text() : ""
}

async function runCommand(
  cmd: string[],
  options?: {
    allowFailure?: boolean
    env?: Record<string, string | undefined>
  }
) {
  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    env: { ...process.env, ...options?.env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ])

  if (exitCode !== 0 && !options?.allowFailure) {
    throw new Error(stderr.trim() || stdout.trim() || `Command failed: ${cmd.join(" ")}`)
  }

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  }
}

function runAgentBrowser(args: string[], options?: { allowFailure?: boolean }) {
  return runCommand(["agent-browser", "--session", SESSION, ...args], options)
}

async function isServerReady() {
  try {
    const response = await fetch(APP_URL)
    if (!response.ok) {
      return false
    }

    const html = await response.text()
    return html.includes("<title>Private Ethereum Assistant</title>")
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await isServerReady()) {
    return
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
      LLM_BASE_URL: E2E_LLM_BASE_URL,
      LLM_MODEL: E2E_LLM_MODEL,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  startedDevServer = true

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await isServerReady()) {
      return
    }

    if ((await Promise.race([devServer.exited, delay(100)])) !== undefined) {
      break
    }

    await delay(500)
  }

  const stdout = await readProcessOutput(devServer.stdout)
  const stderr = await readProcessOutput(devServer.stderr)
  throw new Error(
    `Next.js dev server did not become ready on ${APP_URL}.\n${stdout}\n${stderr}`.trim()
  )
}

async function clearBrowserState() {
  await runAgentBrowser(["errors", "--clear"], { allowFailure: true })
  await runAgentBrowser(["console", "--clear"], { allowFailure: true })
}

async function openHome() {
  await clearBrowserState()
  await runAgentBrowser(["open", APP_URL])
  await runAgentBrowser(["wait", '[data-testid="chat-input"]'])
  await runAgentBrowser([
    "eval",
    `window.localStorage.removeItem(${JSON.stringify(E2E_CHAT_MOCK_STORAGE_KEY)})`,
  ])
}

async function getText(selector: string) {
  return (await runAgentBrowser(["get", "text", selector])).stdout
}

async function expectText(selector: string, expected: string[]) {
  const text = await getText(selector)
  for (const fragment of expected) {
    if (!text.includes(fragment)) {
      throw new Error(`Expected ${selector} to include "${fragment}". Received:\n${text}`)
    }
  }
}

async function setMockScenario(scenario: E2EChatMockScenario) {
  await runAgentBrowser([
    "eval",
    `window.localStorage.setItem(${JSON.stringify(E2E_CHAT_MOCK_STORAGE_KEY)}, ${JSON.stringify(
      scenario
    )})`,
  ])
}

async function submitMessage(message: string) {
  await runAgentBrowser(["fill", '[data-testid="chat-input"]', message])
  await runAgentBrowser(["press", "Enter"])
}

async function waitForPageErrors(testName: string) {
  const { stdout } = await runAgentBrowser(["errors"], { allowFailure: true })
  if (stdout) {
    pageErrors.set(testName, stdout)
  }
}

async function runTest(
  name: string,
  fn: () => Promise<void>,
  screenshotName?: string
) {
  try {
    await fn()
    if (screenshotName) {
      const screenshotPath = join(SCREENSHOT_DIR, screenshotName)
      await runAgentBrowser(["screenshot", screenshotPath])
      results.push({ name, passed: true, screenshot: screenshotPath })
    } else {
      results.push({ name, passed: true })
    }
    await waitForPageErrors(name)
  } catch (error) {
    const failureScreenshot = join(
      SCREENSHOT_DIR,
      `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-failure.png`
    )
    await runAgentBrowser(["screenshot", failureScreenshot], { allowFailure: true })
    results.push({
      name,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
      screenshot: failureScreenshot,
    })
  } finally {
    await runAgentBrowser([
      "eval",
      `window.localStorage.removeItem(${JSON.stringify(E2E_CHAT_MOCK_STORAGE_KEY)})`,
    ], { allowFailure: true })
  }
}

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true })
  await ensureServer()

  await runTest(
    "App loads and shows welcome screen",
    async () => {
      await openHome()
      await runAgentBrowser(["snapshot", "-i"])
      await expectText("body", [
        "Private Ethereum Assistant",
        "What's the ETH balance of our Safe?",
      ])
    },
    "welcome.png"
  )

  await runTest("Network settings can be changed", async () => {
    await openHome()
    await runAgentBrowser(["click", '[data-testid="network-settings-trigger"]'])
    await runAgentBrowser(["wait", '[data-testid="network-settings-panel"]'])
    await runAgentBrowser(["select", '[data-testid="network-settings-preset"]', "arbitrum"])
    await expectText('[data-testid="network-settings-trigger"]', ["42161", "Arbitrum One"])
    await expectText("body", ["Local LLM", "Arbitrum One"])
  })

  await runTest("User can send a message", async () => {
    await openHome()
    await setMockScenario("balanceWidget")
    await submitMessage("What is my ETH balance?")
    await runAgentBrowser(["wait", '[data-testid="message-user"]'])
    await runAgentBrowser(["wait", '[data-testid="result-balance"]'])
    await expectText("body", ["What is my ETH balance?", "Balances"])
  })

  await runTest(
    "Balance widget renders correctly",
    async () => {
      await openHome()
      await setMockScenario("balanceWidget")
      await submitMessage("balance")
      await runAgentBrowser(["wait", '[data-testid="result-balance"]'])
      await expectText('[data-testid="result-balance"]', ["Balances", "ETH", "USDC", "321123456"])
    },
    "balance-widget.png"
  )

  await runTest(
    "Transaction preview widget renders",
    async () => {
      await openHome()
      await setMockScenario("transactionPreviewWidget")
      await submitMessage("prepare transfer")
      await runAgentBrowser(["wait", '[data-testid="result-transaction-preview"]'])
      await expectText('[data-testid="result-transaction-preview"]', [
        "Awaiting confirmation",
        "0.000001 ETH",
        "21000",
      ])
    },
    "tx-preview.png"
  )

  await runTest(
    "Transaction confirmed widget renders",
    async () => {
      await openHome()
      await setMockScenario("transactionConfirmedWidget")
      await submitMessage("send transfer")
      await runAgentBrowser(["wait", '[data-testid="result-transaction-progress"]'])
      await expectText('[data-testid="result-transaction-progress"]', [
        "Confirmed",
        "Estimating gas",
        "Building transaction",
        "Signing transaction",
        "Broadcasting transaction",
        "Waiting for confirmation",
      ])
    },
    "tx-confirmed.png"
  )

  await runTest("ENS result widget renders", async () => {
    await openHome()
    await setMockScenario("ensWidget")
    await submitMessage("resolve vitalik.eth")
    await runAgentBrowser(["wait", '[data-testid="result-ens"]'])
    await expectText('[data-testid="result-ens"]', ["vitalik.eth", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"])
  })

  await runTest("Safe info widget renders", async () => {
    await openHome()
    await setMockScenario("safeInfoWidget")
    await submitMessage("show safe info")
    await runAgentBrowser(["wait", '[data-testid="result-safe-info"]'])
    await expectText('[data-testid="result-safe-info"]', ["Safe Info", "0.42 ETH", "2 of 2"])
  })

  await runTest("Error state renders", async () => {
    await openHome()
    await setMockScenario("errorWidget")
    await submitMessage("send 999999 eth")
    await runAgentBrowser(["wait", '[data-testid="result-transaction-error"]'])
    await expectText('[data-testid="result-transaction-error"]', [
      "Transaction preparation failed",
      "Insufficient ETH",
    ])
  })

  await runTest(
    "Timeout error keeps model trace visible",
    async () => {
      await openHome()
      await setMockScenario("timeoutError")
      await submitMessage("trigger timeout")
      await runAgentBrowser(["wait", '[data-testid="chat-error"]'])
      await runAgentBrowser(["wait", '[data-testid="chat-debug-panel"]'])
      await expectText('[data-testid="chat-error"]', [
        "Request Timed Out",
        "timed out",
      ])
      await expectText('[data-testid="chat-debug-panel"]', [
        "Model Trace",
        "Streaming failed",
        "180 seconds",
      ])
    },
    "timeout-error-trace.png"
  )

  if (SHOULD_SKIP_LLM_SMOKE) {
    results.push({
      name: 'Full LLM smoke test: "Resolve vitalik.eth"',
      passed: true,
      details: "Skipped because E2E_SKIP_LLM_SMOKE=1.",
    })
  } else {
    const liveSmokeTimeoutMs = 180_000

    await runTest(
      'Full LLM smoke test: "Resolve vitalik.eth"',
      async () => {
        await openHome()
        await submitMessage("Resolve vitalik.eth")

        const deadline = Date.now() + liveSmokeTimeoutMs
        while (Date.now() < deadline) {
          const text = await getText("body")
          if (text.includes("vitalik.eth") && text.includes("0xd8dA6BF")) {
            return
          }

          await delay(1_000)
        }

        const text = await getText("body")
        throw new Error(
          `Smoke test did not render the ENS answer within ${liveSmokeTimeoutMs / 1000}s.\n${text}`
        )
      },
      "smoke-ens.png"
    )
  }
}

async function cleanup() {
  await runAgentBrowser(["close"], { allowFailure: true })

  if (startedDevServer && devServer) {
    devServer.kill()
    await devServer.exited
  }
}

try {
  await main()
} finally {
  await cleanup()
}

const passed = results.filter((result) => result.passed)
const failed = results.filter((result) => !result.passed)

console.log("## Test Results")
console.log("")
console.log(`Summary: ${passed.length} passed, ${failed.length} failed, ${results.length} total`)

if (failed.length > 0) {
  console.log("")
  console.log("Failed Tests:")
  for (const failure of failed) {
    console.log(`- ${failure.name}`)
    if (failure.details) {
      console.log(`  ${failure.details}`)
    }
    if (failure.screenshot) {
      console.log(`  Screenshot: ${failure.screenshot}`)
    }
  }
}

if (pageErrors.size > 0) {
  console.log("")
  console.log("Page Errors:")
  for (const [testName, errors] of pageErrors) {
    console.log(`- ${testName}`)
    console.log(`  ${errors}`)
  }
}

if (failed.length > 0) {
  process.exitCode = 1
}
