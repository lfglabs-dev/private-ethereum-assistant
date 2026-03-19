import { getEnvSecretStatus } from "@/lib/env-secrets";
import { createSaveEnvConfirmationToken } from "@/lib/local-request-auth";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    ...(await getEnvSecretStatus()),
    saveEnvConfirmationToken: createSaveEnvConfirmationToken(),
  });
}
