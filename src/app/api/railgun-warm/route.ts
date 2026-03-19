import { mergeRuntimeConfigWithEnvSecrets, createDeveloperRuntimeConfig } from "@/lib/env-secrets";
import {
  getAppMode,
  runtimeConfigSchema,
} from "@/lib/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { warmRailgun } = await import("@/lib/railgun");
    let selectedRuntimeConfig;
    const appMode = getAppMode();

    if (appMode === "developer") {
      selectedRuntimeConfig = await createDeveloperRuntimeConfig();
    } else {
      const { runtimeConfig } = await req.json();
      const parsedRuntimeConfig = runtimeConfigSchema.safeParse(runtimeConfig);

      if (!parsedRuntimeConfig.success) {
        return new Response(
          JSON.stringify({
            error:
              parsedRuntimeConfig.error.issues[0]?.message ??
              "Invalid runtime config.",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      selectedRuntimeConfig = await mergeRuntimeConfigWithEnvSecrets(parsedRuntimeConfig.data);
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
