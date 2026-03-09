import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { model } from "@/lib/llm";
import { systemPrompt } from "@/lib/system-prompt";
import { createTools } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: createTools(),
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
