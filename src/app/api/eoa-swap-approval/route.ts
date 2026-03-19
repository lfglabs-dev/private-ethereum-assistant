import { z } from "zod";
import { getConfiguredEoaPrivateKey } from "@/lib/env-secrets";
import {
  createForbiddenLocalRequestResponse,
  validateTrustedLocalRequest,
} from "@/lib/local-request-auth";
import {
  approveAndExecutePreparedEoaSwap,
  rejectPreparedEoaSwap,
} from "@/lib/tools/swap";

export const runtime = "nodejs";

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
      },
    );
  }

  if (parsed.data.action === "reject") {
    return Response.json(rejectPreparedEoaSwap(parsed.data.confirmationId));
  }

  const eoaPrivateKey = await getConfiguredEoaPrivateKey();
  return Response.json(
    await approveAndExecutePreparedEoaSwap(
      parsed.data.confirmationId,
      eoaPrivateKey,
    ),
  );
}
