import { z } from "zod";
import {
  createForbiddenLocalRequestResponse,
  validateTrustedLocalRequest,
} from "@/lib/local-request-auth";

export const runtime = "nodejs";

const approvalRequestSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: Request) {
  const trustedRequest = validateTrustedLocalRequest(req);
  if (!trustedRequest.ok) {
    return createForbiddenLocalRequestResponse(trustedRequest.error);
  }

  const startedAt = Date.now();
  try {
    const {
      approveRailgunAction,
      rejectRailgunAction,
    } = await import("@/lib/railgun");
    const { approvalId, decision } = approvalRequestSchema.parse(await req.json());
    console.info(
      `[railgun-approval] ${JSON.stringify({
        decision,
        event: "request",
        timestamp: new Date().toISOString(),
      })}`,
    );
    const result =
      decision === "approve"
        ? await approveRailgunAction(approvalId)
        : rejectRailgunAction(approvalId);
    console.info(
      `[railgun-approval] ${JSON.stringify({
        decision,
        durationMs: Date.now() - startedAt,
        event: "success",
        status: typeof result === "object" && result !== null && "status" in result
          ? result.status
          : "unknown",
        timestamp: new Date().toISOString(),
      })}`,
    );

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not resolve the Railgun approval request.";
    console.error(
      `[railgun-approval] ${JSON.stringify({
        durationMs: Date.now() - startedAt,
        error: message,
        event: "error",
        timestamp: new Date().toISOString(),
      })}`,
    );

    return Response.json({ error: message }, { status: 400 });
  }
}
