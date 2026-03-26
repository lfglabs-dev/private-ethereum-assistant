import {
  cleanupChatServer,
  createOpenRouterRuntimeConfig,
  ensureChatServer,
  sendChatPrompt,
  type ChatExchange,
} from "../helpers/chat-client"
import { ARBITRUM_CONFIG } from "../helpers/config"
import type { RuntimeConfig } from "@/lib/runtime-config"

const MODELS = [
  "qwen/qwen3-32b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.5-27b",
]

type TestPrompt = {
  mode: "EOA" | "Safe" | "Railgun"
  label: string
  prompt: string
  expectedTools: string[]
}

const TEST_PROMPTS: TestPrompt[] = [
  // EOA
  {
    mode: "EOA",
    label: "Swap",
    prompt: "Swap 0.0001 ETH for USDC",
    expectedTools: ["prepare_swap"],
  },
  {
    mode: "EOA",
    label: "Send ETH",
    prompt: "Send 0.001 ETH to prendrelelead.eth",
    expectedTools: ["resolve_ens", "send_token"],
  },
  {
    mode: "EOA",
    label: "Send ERC-20",
    prompt: "Send 0.5 USDC to prendrelelead.eth",
    expectedTools: ["resolve_ens", "send_token"],
  },
  {
    mode: "EOA",
    label: "Balance",
    prompt: "What is the ETH balance of my wallet?",
    expectedTools: ["get_balance"],
  },
  // Safe
  {
    mode: "Safe",
    label: "Swap",
    prompt: "Swap 0.0001 ETH for USDC from the Safe",
    expectedTools: ["swap_tokens"],
  },
  {
    mode: "Safe",
    label: "Send ETH",
    prompt: "Send 0.001 ETH from the Safe to prendrelelead.eth",
    expectedTools: ["resolve_ens", "propose_transaction"],
  },
  {
    mode: "Safe",
    label: "Send ERC-20",
    prompt: "Send 0.5 USDC from the Safe to prendrelelead.eth",
    expectedTools: ["resolve_ens", "propose_transaction"],
  },
  {
    mode: "Safe",
    label: "Balance",
    prompt: "What is the ETH balance of the Safe?",
    expectedTools: ["get_balance"],
  },
  // Railgun
  {
    mode: "Railgun",
    label: "Shield",
    prompt: "Shield 0.001 ETH into Railgun",
    expectedTools: ["railgun_shield"],
  },
  {
    mode: "Railgun",
    label: "Send private",
    prompt: "Send 0.0005 private ETH to myself",
    expectedTools: ["railgun_transfer"],
  },
  {
    mode: "Railgun",
    label: "Unshield",
    prompt: "Unshield the remaining ETH from Railgun",
    expectedTools: ["railgun_unshield"],
  },
]

type PromptResult = {
  test: TestPrompt
  model: string
  timeMs: number
  toolCalls: string[]
  correctTool: boolean
  textQuality: boolean
  error: string
  responseSummary: string
}

function actorForMode(mode: "EOA" | "Safe" | "Railgun"): "eoa" | "safe" | "railgun" {
  if (mode === "Safe") return "safe"
  if (mode === "Railgun") return "railgun"
  return "eoa"
}

function checkToolAccuracy(
  result: ChatExchange,
  expected: string[],
): boolean {
  const calledTools = result.toolCalls.map((tc) => tc.toolName)
  return expected.every((tool) => calledTools.includes(tool))
}

function checkTextQuality(
  result: ChatExchange,
  test: TestPrompt,
): boolean {
  const text = result.text.toLowerCase()
  if (result.toolCalls.some((tc) => tc.errorText)) return false
  if (text.length < 10) return false

  // Mode-specific quality checks
  if (test.mode === "EOA") {
    if (test.label === "Balance") return text.includes("eth")
    if (test.label === "Swap") return text.includes("swap") || text.includes("usdc")
    if (test.label.startsWith("Send")) return text.includes("eth") || text.includes("prendrelelead")
  }
  if (test.mode === "Safe") {
    if (test.label === "Balance") return text.includes("eth")
    if (test.label === "Swap") return text.includes("swap") || text.includes("usdc")
    if (test.label.startsWith("Send")) return text.includes("safe") || text.includes("prendrelelead")
  }
  if (test.mode === "Railgun") {
    if (test.label === "Shield") return text.includes("shield") || text.includes("railgun")
    if (test.label === "Send private") return text.includes("private") || text.includes("transfer")
    if (test.label === "Unshield") return text.includes("unshield") || text.includes("railgun")
  }

  return true
}

function truncate(text: string, maxLength = 200): string {
  const oneLine = text.replace(/\n/g, " ").trim()
  return oneLine.length > maxLength
    ? `${oneLine.slice(0, maxLength)}…`
    : oneLine
}

async function runPrompt(
  test: TestPrompt,
  model: string,
  baseRuntimeConfig: RuntimeConfig,
): Promise<PromptResult> {
  const runtimeConfig: RuntimeConfig = {
    ...baseRuntimeConfig,
    llm: {
      ...baseRuntimeConfig.llm,
      provider: "openrouter",
      openRouterModel: model,
    },
    actor: {
      type: actorForMode(test.mode),
    },
  }

  const start = Date.now()
  try {
    const result = await sendChatPrompt({
      prompt: test.prompt,
      runtimeConfig,
    })
    const timeMs = Date.now() - start
    const toolCalls = result.toolCalls.map((tc) => tc.toolName)
    const errors = result.toolCalls
      .filter((tc) => tc.errorText)
      .map((tc) => tc.errorText!)

    return {
      test,
      model,
      timeMs,
      toolCalls,
      correctTool: checkToolAccuracy(result, test.expectedTools),
      textQuality: checkTextQuality(result, test),
      error: errors.join("; ") || "none",
      responseSummary: truncate(result.text),
    }
  } catch (error) {
    return {
      test,
      model,
      timeMs: Date.now() - start,
      toolCalls: [],
      correctTool: false,
      textQuality: false,
      error: error instanceof Error ? error.message : String(error),
      responseSummary: "",
    }
  }
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

function generateMarkdown(
  results: PromptResult[],
  models: string[],
): string {
  const date = new Date().toISOString().split("T")[0]
  const lines: string[] = []

  lines.push("# OpenRouter Cloud Model Benchmark")
  lines.push(`Date: ${date} | OpenRouter | Private Ethereum Assistant`)
  lines.push("")

  // Summary table
  lines.push("## Summary Table")
  lines.push("| Model | Avg Response (s) | Tool Accuracy | Text Quality | Viable? |")
  lines.push("|-------|------------------|---------------|--------------|---------|")

  for (const model of models) {
    const modelResults = results.filter((r) => r.model === model)
    const total = modelResults.length
    const avgTime = modelResults.reduce((sum, r) => sum + r.timeMs, 0) / total
    const toolHits = modelResults.filter((r) => r.correctTool).length
    const textHits = modelResults.filter((r) => r.textQuality).length
    const viable = toolHits >= Math.ceil(total * 0.75) && textHits >= Math.ceil(total * 0.75)
      ? "Yes"
      : "No"

    lines.push(
      `| ${model} | ${formatTime(avgTime)} | ${toolHits}/${total} | ${textHits}/${total} | ${viable} |`,
    )
  }

  lines.push("")

  // Detailed results per model
  lines.push("## Detailed Results")

  for (const model of models) {
    const modelResults = results.filter((r) => r.model === model)

    lines.push(`### ${model}`)
    lines.push("")
    lines.push(
      "| # | Mode | Test | Prompt | Time | Tool calls made | Correct tool? | Response quality | Error | Response summary |",
    )
    lines.push(
      "|---|------|------|--------|------|-----------------|---------------|------------------|-------|------------------|",
    )

    modelResults.forEach((r, i) => {
      lines.push(
        `| ${i + 1} | ${r.test.mode} | ${r.test.label} | ${r.test.prompt} | ${formatTime(r.timeMs)} | ${r.toolCalls.join(", ") || "none"} | ${r.correctTool ? "Yes" : "No"} | ${r.textQuality ? "Yes" : "No"} | ${r.error} | ${r.responseSummary} |`,
      )
    })

    lines.push("")
  }

  // Conclusions
  lines.push("## Conclusions")

  const modelScores = models.map((model) => {
    const modelResults = results.filter((r) => r.model === model)
    const toolHits = modelResults.filter((r) => r.correctTool).length
    const textHits = modelResults.filter((r) => r.textQuality).length
    return { model, score: toolHits + textHits }
  })
  modelScores.sort((a, b) => b.score - a.score)

  lines.push(`- Best overall model in this run: ${modelScores[0].model}.`)
  lines.push(
    "- Tool-use score favored exact matches to the plan's expected tool sequence for each prompt.",
  )
  lines.push(
    "- Viability here means at least 75% tool-routing wins and 75% text-quality wins across all 11 prompts.",
  )

  return lines.join("\n")
}

async function main() {
  const selectedModels = process.env.BENCHMARK_MODELS
    ? process.env.BENCHMARK_MODELS.split(",").map((m) => m.trim())
    : MODELS

  console.log(`Benchmarking ${selectedModels.length} model(s): ${selectedModels.join(", ")}`)
  console.log(`Running ${TEST_PROMPTS.length} prompts per model (${TEST_PROMPTS.length * selectedModels.length} total)`)
  console.log()

  await ensureChatServer()

  const baseRuntimeConfig = await createOpenRouterRuntimeConfig(ARBITRUM_CONFIG)
  const allResults: PromptResult[] = []

  for (const model of selectedModels) {
    console.log(`\n--- ${model} ---`)

    for (const test of TEST_PROMPTS) {
      const tag = `[${test.mode}] ${test.label}`
      process.stdout.write(`  ${tag}: `)

      const result = await runPrompt(test, model, baseRuntimeConfig)
      allResults.push(result)

      const status = result.correctTool && result.textQuality ? "✓" : "✗"
      console.log(
        `${status} ${formatTime(result.timeMs)} | tools: ${result.toolCalls.join(", ") || "none"}${result.error !== "none" ? ` | error: ${result.error}` : ""}`,
      )
    }
  }

  const markdown = generateMarkdown(allResults, selectedModels)
  const outputPath = `${process.cwd()}/OpenRouter_Benchmark.md`
  await Bun.write(outputPath, markdown)
  console.log(`\nBenchmark report written to ${outputPath}`)

  await cleanupChatServer()
}

await main()
