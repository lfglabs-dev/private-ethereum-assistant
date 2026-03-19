import { spawn } from "node:child_process";
import { access, unlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { cleanupChatServer, ensureChatServer, sendChatPrompt } from "../tests/e2e/helpers/chat-client";
import { ARBITRUM_CONFIG } from "../tests/e2e/helpers/config";
import { createDefaultRuntimeConfig } from "../src/lib/runtime-config";

const MODELS = ["qwen2.5:3b", "llama3.2:3b", "gemma3:4b"] as const;
const REPORT_PATH = "MacBook_Air_Benchmark.md";
const VITALIK_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const LOCAL_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434/v1";
const OLLAMA_ORIGIN = new URL(LOCAL_BASE_URL).origin;
const OLLAMA_TAGS_URL = new URL("/api/tags", OLLAMA_ORIGIN).toString();
const CHAT_APP_URL = process.env.E2E_APP_URL ?? "http://127.0.0.1:3100";
const NEXT_DEV_LOCK_PATH = ".next/dev/lock";

type PromptSpec = {
  id: number;
  prompt: string;
  expectedTools: string[];
  qualityCheck: (text: string) => { pass: boolean; note: string };
};

type PromptBenchmarkResult = {
  promptId: number;
  prompt: string;
  durationMs: number;
  toolCalls: string[];
  correctTool: boolean;
  responseQuality: boolean;
  qualityNote: string;
  error: string | null;
  text: string;
};

type ModelBenchmarkResult = {
  model: string;
  averageDurationMs: number;
  toolAccuracyCount: number;
  textQualityCount: number;
  viable: boolean;
  results: PromptBenchmarkResult[];
};

const PROMPTS: PromptSpec[] = [
  {
    id: 1,
    prompt: "What is the address of vitalik.eth?",
    expectedTools: ["resolve_ens"],
    qualityCheck(text) {
      const normalized = text.toLowerCase();
      const hasEns = normalized.includes("vitalik.eth");
      const hasAddress = normalized.includes(VITALIK_ADDRESS.toLowerCase());
      return {
        pass: hasEns && hasAddress,
        note: hasEns && hasAddress
          ? "Included ENS name and resolved address."
          : "Expected the answer to mention vitalik.eth and the resolved address.",
      };
    },
  },
  {
    id: 2,
    prompt: `What is the ETH balance of ${VITALIK_ADDRESS}?`,
    expectedTools: ["get_balance"],
    qualityCheck(text) {
      const normalized = text.toLowerCase();
      const hasEth = normalized.includes("eth");
      const hasBalance = normalized.includes("balance");
      return {
        pass: hasEth && hasBalance,
        note: hasEth && hasBalance
          ? "Included ETH balance language."
          : "Expected the answer to mention an ETH balance.",
      };
    },
  },
  {
    id: 3,
    prompt: "Explain what Railgun is in one sentence.",
    expectedTools: [],
    qualityCheck(text) {
      const normalized = text.toLowerCase();
      const hasRailgun = normalized.includes("railgun");
      const hasPrivacyCue =
        normalized.includes("privacy") ||
        normalized.includes("private") ||
        normalized.includes("zero-knowledge") ||
        normalized.includes("zk");
      return {
        pass: hasRailgun && hasPrivacyCue,
        note: hasRailgun && hasPrivacyCue
          ? "Explained Railgun as a privacy-preserving system."
          : "Expected a one-sentence Railgun description with a privacy cue.",
      };
    },
  },
  {
    id: 4,
    prompt: "Send 0.001 ETH to fricoben.eth",
    expectedTools: ["resolve_ens", "prepare_eoa_transfer"],
    qualityCheck(text) {
      const normalized = text.toLowerCase();
      const hasAmount = normalized.includes("0.001");
      const hasEth = normalized.includes("eth");
      const hasPreparationCue =
        normalized.includes("prepared") ||
        normalized.includes("confirm") ||
        normalized.includes("approval") ||
        normalized.includes("preview");
      return {
        pass: hasAmount && hasEth && hasPreparationCue,
        note: hasAmount && hasEth && hasPreparationCue
          ? "Returned a transfer-preview style response."
          : "Expected a transfer preview response that mentions amount and confirmation.",
      };
    },
  },
];

function isLocalModelEndpoint() {
  const url = new URL(LOCAL_BASE_URL);
  return (
    (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
    (url.port === "" || url.port === "11434")
  );
}

async function readProcessOutput(
  stream: NodeJS.ReadableStream | null,
): Promise<string> {
  if (!stream) {
    return "";
  }

  let output = "";
  for await (const chunk of stream) {
    output += chunk.toString();
  }

  return output;
}

function runCommand(cmd: string[], label: string) {
  return new Promise<void>((resolve, reject) => {
    console.log(`\n==> ${label}`);
    console.log(`$ ${cmd.join(" ")}`);

    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
        ),
      );
    });
  });
}

async function fetchInstalledModels() {
  const response = await fetch(OLLAMA_TAGS_URL, {
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama tags request failed with ${response.status}.`);
  }

  const payload = await response.json() as {
    models?: Array<{ model?: string; name?: string }>;
  };

  return new Set(
    (payload.models ?? [])
      .flatMap((entry) => [entry.model, entry.name])
      .filter((value): value is string => Boolean(value)),
  );
}

async function isOllamaReady() {
  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startManagedOllama() {
  const child = spawn("ollama", ["serve"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const waitForReady = async () => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await isOllamaReady()) {
        return;
      }

      if (child.exitCode !== null) {
        break;
      }

      await delay(400);
    }

    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await onceProcessExit(child);
    }

    const [stdout, stderr] = await Promise.all([
      readProcessOutput(child.stdout),
      readProcessOutput(child.stderr),
    ]);

    throw new Error(
      `Ollama did not become ready on ${OLLAMA_ORIGIN}.\n${stdout}\n${stderr}`.trim(),
    );
  };

  await waitForReady();
  return child;
}

async function ensureOllama() {
  if (await isOllamaReady()) {
    console.log(`Ollama is already running at ${OLLAMA_ORIGIN}.`);
    return null;
  }

  if (!isLocalModelEndpoint()) {
    throw new Error(
      `LLM_BASE_URL points to ${LOCAL_BASE_URL}, but the server is not reachable. Start it before running the benchmark.`,
    );
  }

  console.log(`Ollama is not running at ${OLLAMA_ORIGIN}. Starting it now...`);
  return startManagedOllama();
}

async function ensureModelPulled(model: string) {
  const installedModels = await fetchInstalledModels();
  if (installedModels.has(model)) {
    console.log(`Model already available: ${model}`);
    return;
  }

  await runCommand(["ollama", "pull", model], `Pulling ${model}`);
}

async function isChatAppReady() {
  try {
    const response = await fetch(CHAT_APP_URL, {
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    return html.includes("<title>Private Ethereum Assistant</title>");
  } catch {
    return false;
  }
}

async function clearStaleNextDevLock() {
  if (await isChatAppReady()) {
    return;
  }

  try {
    await access(NEXT_DEV_LOCK_PATH);
  } catch {
    return;
  }

  await unlink(NEXT_DEV_LOCK_PATH);
  console.log(`Removed stale Next.js lock at ${NEXT_DEV_LOCK_PATH}.`);
}

function createLocalRuntimeConfig(model: string) {
  const runtimeConfig = createDefaultRuntimeConfig();

  return {
    ...runtimeConfig,
    llm: {
      ...runtimeConfig.llm,
      provider: "local" as const,
      localBaseUrl: LOCAL_BASE_URL,
      localModel: model,
      timeoutMs: Math.max(runtimeConfig.llm.timeoutMs, 240_000),
    },
    network: ARBITRUM_CONFIG,
    actor: {
      type: "eoa" as const,
    },
  };
}

function normalizeToolCalls(toolCalls: Array<{ toolName: string }>) {
  return toolCalls.map((entry) => entry.toolName);
}

function isExactToolMatch(observedTools: string[], expectedTools: string[]) {
  if (observedTools.length !== expectedTools.length) {
    return false;
  }

  return expectedTools.every((toolName, index) => observedTools[index] === toolName);
}

function createFailureResult(
  promptSpec: PromptSpec,
  durationMs: number,
  error: unknown,
): PromptBenchmarkResult {
  return {
    promptId: promptSpec.id,
    prompt: promptSpec.prompt,
    durationMs,
    toolCalls: [],
    correctTool: false,
    responseQuality: false,
    qualityNote: "The prompt failed before producing a usable response.",
    error: error instanceof Error ? error.message : String(error),
    text: "",
  };
}

async function runPromptBenchmark(
  model: string,
  promptSpec: PromptSpec,
): Promise<PromptBenchmarkResult> {
  const startedAt = performance.now();

  try {
    const exchange = await sendChatPrompt({
      prompt: promptSpec.prompt,
      runtimeConfig: createLocalRuntimeConfig(model),
      networkConfig: ARBITRUM_CONFIG,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const toolCalls = normalizeToolCalls(exchange.toolCalls);
    const quality = promptSpec.qualityCheck(exchange.text);

    return {
      promptId: promptSpec.id,
      prompt: promptSpec.prompt,
      durationMs,
      toolCalls,
      correctTool: isExactToolMatch(toolCalls, promptSpec.expectedTools),
      responseQuality: quality.pass,
      qualityNote: quality.note,
      error: exchange.toolCalls.find((entry) => entry.errorText)?.errorText ?? null,
      text: exchange.text.trim(),
    };
  } catch (error) {
    return createFailureResult(
      promptSpec,
      Math.round(performance.now() - startedAt),
      error,
    );
  }
}

async function benchmarkModel(model: string): Promise<ModelBenchmarkResult> {
  console.log(`\n### Benchmarking ${model}`);
  const results: PromptBenchmarkResult[] = [];

  for (const promptSpec of PROMPTS) {
    console.log(`Running prompt ${promptSpec.id}/${PROMPTS.length}: ${promptSpec.prompt}`);
    const result = await runPromptBenchmark(model, promptSpec);
    results.push(result);
    console.log(
      `Completed in ${(result.durationMs / 1000).toFixed(2)}s | tools=[${result.toolCalls.join(", ")}] | tool-ok=${result.correctTool} | text-ok=${result.responseQuality}${result.error ? ` | error=${result.error}` : ""}`,
    );
  }

  const averageDurationMs = Math.round(
    results.reduce((sum, result) => sum + result.durationMs, 0) / results.length,
  );
  const toolAccuracyCount = results.filter((result) => result.correctTool).length;
  const textQualityCount = results.filter((result) => result.responseQuality).length;
  const viable = toolAccuracyCount >= 3 && textQualityCount >= 3;

  return {
    model,
    averageDurationMs,
    toolAccuracyCount,
    textQualityCount,
    viable,
    results,
  };
}

async function getSystemValue(cmd: string, args: string[]) {
  return new Promise<string>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", () => resolve("unknown"));
    child.once("exit", (code) => resolve(code === 0 ? output.trim() || "unknown" : "unknown"));
  });
}

function bytesToGiB(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "unknown";
  }

  return `${(parsed / 1024 ** 3).toFixed(0)}GB`;
}

function formatDurationSeconds(durationMs: number) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\n/g, " ").replace(/\|/g, "\\|");
}

function buildPromptSummary(result: PromptBenchmarkResult) {
  return result.text
    ? escapeMarkdownCell(result.text.slice(0, 220))
    : result.error
      ? escapeMarkdownCell(`Error: ${result.error}`)
      : "No response";
}

async function buildReport(results: ModelBenchmarkResult[]) {
  const cpu = await getSystemValue("sysctl", ["-n", "machdep.cpu.brand_string"]);
  const memory = bytesToGiB(await getSystemValue("sysctl", ["-n", "hw.memsize"]));
  const macos = await getSystemValue("sw_vers", ["-productVersion"]);
  const benchmarkDate = new Date().toISOString().slice(0, 10);

  const summaryRows = results
    .map(
      (result) =>
        `| ${result.model} | ${formatDurationSeconds(result.averageDurationMs)} | ${result.toolAccuracyCount}/4 | ${result.textQualityCount}/4 | ${result.viable ? "Yes" : "No"} |`,
    )
    .join("\n");

  const detailSections = results
    .map((modelResult) => {
      const rows = modelResult.results
        .map(
          (result) =>
            `| ${result.promptId} | ${escapeMarkdownCell(result.prompt)} | ${formatDurationSeconds(result.durationMs)} | ${result.toolCalls.length > 0 ? escapeMarkdownCell(result.toolCalls.join(", ")) : "none"} | ${result.correctTool ? "Yes" : "No"} | ${result.responseQuality ? "Yes" : "No"} | ${escapeMarkdownCell(result.error ?? "none")} | ${buildPromptSummary(result)} |`,
        )
        .join("\n");

      return `### ${modelResult.model}

| Prompt # | Prompt | Time | Tool calls made | Correct tool? | Response quality | Error | Response summary |
|----------|--------|------|-----------------|---------------|------------------|-------|------------------|
${rows}
`;
    })
    .join("\n");

  const sortedByScore = [...results].sort((left, right) => {
    const leftScore = left.toolAccuracyCount * 10 + left.textQualityCount;
    const rightScore = right.toolAccuracyCount * 10 + right.textQualityCount;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.averageDurationMs - right.averageDurationMs;
  });
  const bestModel = sortedByScore[0];

  return `# MacBook Air M1 16GB — Local LLM Benchmark
Date: ${benchmarkDate} | Ollama | Private Ethereum Assistant

## Hardware
- CPU: ${cpu}
- Memory: ${memory}
- macOS: ${macos}

## Summary Table
| Model | Avg Response (s) | Tool Accuracy | Text Quality | Viable? |
|-------|------------------|---------------|--------------|---------|
${summaryRows}

## Detailed Results
${detailSections}

## Conclusions
- Best overall model in this run: ${bestModel.model}.
- Tool-use score favored exact matches to the plan's expected tool sequence for each prompt.
- Viability here means at least 3/4 tool-routing wins and 3/4 text-quality wins in the real agent flow.
`;
}

async function main() {
  const { getSecret } = await import("../src/lib/secret-store");
  const eoaKey = await getSecret("EOA_PRIVATE_KEY");
  if (!eoaKey) {
    throw new Error(
      "Missing EOA_PRIVATE_KEY in Keychain. Store it first via: bun run local",
    );
  }

  const managedOllama = await ensureOllama();

  try {
    for (const model of MODELS) {
      await ensureModelPulled(model);
    }

    await clearStaleNextDevLock();
    await ensureChatServer();

    const results: ModelBenchmarkResult[] = [];
    for (const model of MODELS) {
      results.push(await benchmarkModel(model));
    }

    const report = await buildReport(results);
    await writeFile(REPORT_PATH, report, "utf8");
    console.log(`\nWrote ${REPORT_PATH}`);
  } finally {
    await cleanupChatServer();

    if (managedOllama) {
      managedOllama.kill("SIGTERM");
      await onceProcessExit(managedOllama);
    }
  }
}

function onceProcessExit(child: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
    child.once("close", () => resolve());
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
