import { z } from "zod";
import { mergeRuntimeConfigWithEnvSecrets, createDeveloperRuntimeConfig } from "@/lib/env-secrets";
import {
  approveAndSendPreparedEoaTransfer,
  rejectPreparedEoaTransfer,
} from "@/lib/tools/eoa-tx";
import {
  getAppMode,
  runtimeConfigSchema,
} from "@/lib/runtime-config";

export const runtime = "nodejs";

const approvalRequestSchema = z.object({
  action: z.enum(["approve", "reject"]),
  confirmationId: z.string().min(1, "confirmationId is required."),
  runtimeConfig: runtimeConfigSchema.optional(),
});

export async function POST(req: Request) {
  const parsed = approvalRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error:
          parsed.error.issues[0]?.message ?? "Invalid local approval request.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const appMode = getAppMode();
  const runtimeConfig =
    appMode === "developer"
      ? await createDeveloperRuntimeConfig()
      : parsed.data.runtimeConfig
        ? await mergeRuntimeConfigWithEnvSecrets(parsed.data.runtimeConfig)
        : undefined;

  if (!runtimeConfig) {
    return new Response(
      JSON.stringify({
        error: "A valid runtime config is required for local approval.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (parsed.data.action === "reject") {
    return Response.json(rejectPreparedEoaTransfer(parsed.data.confirmationId));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const update of approveAndSendPreparedEoaTransfer(
          parsed.data.confirmationId,
          runtimeConfig.wallet.eoaPrivateKey
        )) {
          controller.enqueue(encoder.encode(`${JSON.stringify(update)}\n`));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              kind: "transaction_error",
              status: "error",
              summary: "Local approval failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown local approval error.",
              chain: {
                id: runtimeConfig.network.chainId,
                name: "Selected network",
                nativeSymbol: "ETH",
              },
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown local approval error.",
            })}\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
