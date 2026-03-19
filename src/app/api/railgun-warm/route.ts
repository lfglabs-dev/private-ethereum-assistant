import {
  getAppMode,
} from "@/lib/runtime-config";
import { createDeveloperRuntimeConfig } from "@/lib/env-secrets";
import {
  createForbiddenLocalRequestResponse,
  validateTrustedLocalRequest,
} from "@/lib/local-request-auth";
import { createStandardRuntimeConfig } from "@/lib/server-runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const trustedRequest = validateTrustedLocalRequest(req);
  if (!trustedRequest.ok) {
    return createForbiddenLocalRequestResponse(trustedRequest.error);
  }

  try {
    const { warmRailgun } = await import("@/lib/railgun");
    let selectedRuntimeConfig;
    const appMode = getAppMode();

    if (appMode === "developer") {
      selectedRuntimeConfig = await createDeveloperRuntimeConfig();
    } else {
      selectedRuntimeConfig = (
        await createStandardRuntimeConfig({
          requestedRuntimeConfig: undefined,
          requestedNetworkConfig: undefined,
        })
      ).selectedRuntimeConfig;
    }

    const result = await warmRailgun({
      ...selectedRuntimeConfig.railgun,
      signerPrivateKey: selectedRuntimeConfig.wallet.eoaPrivateKey,
    });

    return Response.json(result);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to warm Railgun.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
