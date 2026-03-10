import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  convertToModelMessages,
} from "ai";
import type { TextStreamPart } from "ai";
import { model } from "@/lib/llm";
import { config } from "@/lib/config";
import { networkConfigSchema, DEFAULT_NETWORK_CONFIG } from "@/lib/ethereum";
import { getSystemPrompt } from "@/lib/system-prompt";
import { createTools } from "@/lib/tools";
import {
  AssistantUIMessage,
  createDebugLog,
} from "@/lib/chat-stream";
import {
  buildE2EChatMockSseBody,
  isE2EChatMockScenario,
} from "@/lib/testing/e2e-chat-mocks";

export const runtime = "nodejs";
export const maxDuration = 300;

function summarizeChunk(chunk: TextStreamPart<Record<string, never>>) {
  switch (chunk.type) {
    case "tool-call":
      return {
        stage: "tool" as const,
        message: `Model called ${chunk.toolName}`,
        detail: JSON.stringify(chunk.input),
      };
    case "tool-result":
      return {
        stage: "tool" as const,
        message: `Tool ${chunk.toolName} returned`,
      };
    case "reasoning-delta":
      return {
        stage: "step" as const,
        message: "Model emitted reasoning",
      };
    case "text-delta":
      return {
        stage: "response" as const,
        message: "Streaming assistant response",
      };
    case "tool-input-start":
      return {
        stage: "tool" as const,
        message: `Streaming input for ${chunk.toolName}`,
      };
    case "tool-input-delta":
      return {
        stage: "tool" as const,
        message: "Receiving tool arguments",
      };
    case "raw":
      return {
        stage: "step" as const,
        message: "Received raw provider chunk",
      };
  }
}

export async function POST(req: Request) {
  try {
    const mockScenario = req.headers.get("x-e2e-mock-scenario");
    if (
      process.env.NODE_ENV !== "production" &&
      mockScenario &&
      isE2EChatMockScenario(mockScenario)
    ) {
      return new Response(buildE2EChatMockSseBody(mockScenario), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const { messages, networkConfig, e2eMockScenario } = await req.json();

    if (
      process.env.NODE_ENV !== "production" &&
      typeof e2eMockScenario === "string" &&
      isE2EChatMockScenario(e2eMockScenario)
    ) {
      return new Response(buildE2EChatMockSseBody(e2eMockScenario), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    const parsedNetworkConfig = networkConfigSchema.safeParse(networkConfig);

    if (networkConfig != null && !parsedNetworkConfig.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid network config. Provide a valid RPC_URL and CHAIN_ID.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const selectedNetworkConfig = parsedNetworkConfig.success
      ? parsedNetworkConfig.data
      : DEFAULT_NETWORK_CONFIG;

    const stream = createUIMessageStream<AssistantUIMessage>({
      execute: async ({ writer }) => {
        let lastChunkSummary = "";

        const writeDebugLog = (
          entry: Parameters<typeof createDebugLog>[0],
          transient = true
        ) => {
          const nextEntry = createDebugLog(entry);
          const summaryKey = `${nextEntry.stage}:${nextEntry.message}:${nextEntry.detail ?? ""}`;
          if (summaryKey === lastChunkSummary) {
            return;
          }

          lastChunkSummary = summaryKey;
          writer.write({
            type: "data-debug",
            data: nextEntry,
            transient,
          });
        };

        writeDebugLog({
          level: "info",
          stage: "request",
          message: `Dispatching request to ${config.llm.model}`,
          detail: `timeout=${Math.round(config.llm.timeoutMs / 1000)}s`,
        });

        const result = streamText({
          model,
          system: getSystemPrompt(selectedNetworkConfig),
          messages: await convertToModelMessages(messages),
          tools: createTools(selectedNetworkConfig),
          stopWhen: stepCountIs(8),
          timeout: config.llm.timeoutMs,
          experimental_onStart: () => {
            writeDebugLog({
              level: "info",
              stage: "request",
              message: "Model request accepted",
            });
          },
          experimental_onStepStart: ({ stepNumber }) => {
            writeDebugLog({
              level: "info",
              stage: "step",
              message: `Starting step ${stepNumber + 1}`,
            });
          },
          experimental_onToolCallStart: ({ toolCall }) => {
            writeDebugLog({
              level: "info",
              stage: "tool",
              message: `Executing ${toolCall.toolName}`,
            });
          },
          experimental_onToolCallFinish: ({
            toolCall,
            success,
            durationMs,
            error,
          }) => {
            writeDebugLog({
              level: success ? "info" : "error",
              stage: "tool",
              message: success
                ? `${toolCall.toolName} finished`
                : `${toolCall.toolName} failed`,
              detail: success
                ? `${durationMs}ms`
                : error instanceof Error
                  ? error.message
                  : String(error),
            });
          },
          onChunk: ({ chunk }) => {
            const summary = summarizeChunk(
              chunk as TextStreamPart<Record<string, never>>
            );
            if (!summary) return;

            writeDebugLog({
              level: "info",
              ...summary,
            });
          },
          onStepFinish: ({ stepNumber, finishReason, toolCalls, toolResults, usage }) => {
            writeDebugLog({
              level: finishReason === "error" ? "error" : "info",
              stage: "step",
              message: `Finished step ${stepNumber + 1}`,
              detail: [
                `finish=${finishReason}`,
                `toolCalls=${toolCalls.length}`,
                `toolResults=${toolResults.length}`,
                usage.totalTokens != null ? `tokens=${usage.totalTokens}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            });
          },
          onFinish: ({ finishReason, totalUsage, steps }) => {
            writeDebugLog({
              level: finishReason === "error" ? "error" : "info",
              stage: "response",
              message: "Response complete",
              detail: [
                `finish=${finishReason}`,
                `steps=${steps.length}`,
                totalUsage.totalTokens != null
                  ? `tokens=${totalUsage.totalTokens}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
            });
          },
          onError: ({ error }) => {
            writeDebugLog({
              level: "error",
              stage: "error",
              message: "Streaming failed",
              detail:
                error instanceof Error ? error.message : "Unknown streaming error",
            });
          },
        });

        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
