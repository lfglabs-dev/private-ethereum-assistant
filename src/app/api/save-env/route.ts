import { saveEnvSecrets } from "@/lib/env-secrets";
import {
  consumeSaveEnvConfirmationToken,
  createForbiddenLocalRequestResponse,
  validateTrustedLocalRequest,
} from "@/lib/local-request-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const trustedRequest = validateTrustedLocalRequest(req);
  if (!trustedRequest.ok) {
    return createForbiddenLocalRequestResponse(trustedRequest.error);
  }

  try {
    const payload = await req.json();
    const confirmationToken =
      typeof payload?.saveEnvConfirmationToken === "string"
        ? payload.saveEnvConfirmationToken
        : "";

    if (!consumeSaveEnvConfirmationToken(confirmationToken)) {
      return new Response(
        JSON.stringify({
          error: "Missing or expired save confirmation token. Refresh Settings and try again.",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const result = await saveEnvSecrets(payload);
    return Response.json(result);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to save secrets.",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
