import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { model } from "@/lib/llm";
import { networkConfigSchema, DEFAULT_NETWORK_CONFIG } from "@/lib/ethereum";
import { getSystemPrompt } from "@/lib/system-prompt";
import { createTools } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { messages, networkConfig } = await req.json();
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

    const result = streamText({
      model,
      system: getSystemPrompt(selectedNetworkConfig),
      messages: await convertToModelMessages(messages),
      tools: createTools(selectedNetworkConfig),
      stopWhen: stepCountIs(8),
    });

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
