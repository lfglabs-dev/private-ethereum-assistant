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
    const appMode = getAppMode();
    console.log("[railgun-warm] starting, mode=%s", appMode);

    const { warmRailgun } = await import("@/lib/railgun");
    let selectedRuntimeConfig;

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

    const hasEoaKey = !!selectedRuntimeConfig.wallet.eoaPrivateKey?.trim();
    const hasMnemonic = !!selectedRuntimeConfig.railgun.mnemonic?.trim();
    console.log("[railgun-warm] config: hasEoaKey=%s hasMnemonic=%s chainId=%s",
      hasEoaKey, hasMnemonic, selectedRuntimeConfig.railgun.chainId);

    const result = await warmRailgun({
      ...selectedRuntimeConfig.railgun,
      signerPrivateKey: selectedRuntimeConfig.wallet.eoaPrivateKey,
    });

    console.log("[railgun-warm] success:", JSON.stringify(result).slice(0, 200));
    return Response.json(result);
  } catch (error) {
    console.error("[railgun-warm] failed:", error);
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
