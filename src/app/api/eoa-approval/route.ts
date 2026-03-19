import { z } from "zod";
import { getConfiguredEoaPrivateKey } from "@/lib/env-secrets";
import { createEthereumContext, DEFAULT_NETWORK_CONFIG } from "@/lib/ethereum";
import {
  approveAndSendPreparedEoaTransfer,
  rejectPreparedEoaTransfer,
} from "@/lib/tools/eoa-tx";
import {
  createForbiddenLocalRequestResponse,
  validateTrustedLocalRequest,
} from "@/lib/local-request-auth";

export const runtime = "nodejs";

const fallbackChain = createEthereumContext(DEFAULT_NETWORK_CONFIG).chainMetadata;

const approvalRequestSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    confirmationId: z.string().min(1, "confirmationId is required."),
  })
  .strict();

export async function POST(req: Request) {
  const trustedRequest = validateTrustedLocalRequest(req);
  if (!trustedRequest.ok) {
    return createForbiddenLocalRequestResponse(trustedRequest.error);
  }

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

  if (parsed.data.action === "reject") {
    return Response.json(rejectPreparedEoaTransfer(parsed.data.confirmationId));
  }

  const eoaPrivateKey = await getConfiguredEoaPrivateKey();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const update of approveAndSendPreparedEoaTransfer(
          parsed.data.confirmationId,
          eoaPrivateKey
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
              chain: fallbackChain,
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
