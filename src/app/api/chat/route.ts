import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { model } from "@/lib/llm";
import { systemPrompt } from "@/lib/system-prompt";
import { tools } from "@/lib/tools";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(5),
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
