import { warmRailgun } from "@/lib/railgun";
import { mergeRuntimeConfigWithEnvSecrets } from "@/lib/env-secrets";
import {
  createDeveloperRuntimeConfig,
  getAppMode,
  runtimeConfigSchema,
} from "@/lib/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    let selectedRuntimeConfig;
    const appMode = getAppMode();

    if (appMode === "developer") {
      selectedRuntimeConfig = createDeveloperRuntimeConfig();
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

      selectedRuntimeConfig = mergeRuntimeConfigWithEnvSecrets(parsedRuntimeConfig.data);
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
