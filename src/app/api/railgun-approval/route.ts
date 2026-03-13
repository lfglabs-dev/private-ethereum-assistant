import { z } from "zod";
import {
  approveRailgunAction,
  rejectRailgunAction,
} from "@/lib/railgun";

export const runtime = "nodejs";

const approvalRequestSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
});

export async function POST(req: Request) {
  try {
    const { approvalId, decision } = approvalRequestSchema.parse(await req.json());
    const result =
      decision === "approve"
        ? await approveRailgunAction(approvalId)
        : rejectRailgunAction(approvalId);

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not resolve the Railgun approval request.";

    return Response.json({ error: message }, { status: 400 });
  }
}
