import { type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  validateTrustedLocalRequest,
  createForbiddenLocalRequestResponse,
} from "@/lib/local-request-auth";
import { runtimeConfigSchema, getAppMode } from "@/lib/runtime-config";
import { mergeRuntimeConfigWithEnvSecrets } from "@/lib/env-secrets";
import { createStandardRuntimeConfig } from "@/lib/server-runtime-config";
import { DEFAULT_NETWORK_CONFIG } from "@/lib/ethereum";
import { fetchPortfolio } from "@/lib/portfolio/portfolio-service";

export const runtime = "nodejs";

function deriveWalletAddress(runtimeConfig: {
  actor: { type: string };
  wallet: { eoaPrivateKey: string };
  safe: { address: string };
}): Address | null {
  if (runtimeConfig.actor.type === "safe") {
    const addr = runtimeConfig.safe.address?.trim();
    if (addr) return addr as Address;
    return null;
  }

  const pk = runtimeConfig.wallet.eoaPrivateKey?.trim();
  if (pk && /^0x[0-9a-fA-F]{64}$/.test(pk)) {
    return privateKeyToAccount(pk as `0x${string}`).address;
  }

  return null;
}

export async function POST(req: Request) {
  const trustedRequest = validateTrustedLocalRequest(req);
  if (!trustedRequest.ok) {
    return createForbiddenLocalRequestResponse(trustedRequest.error);
  }

  try {
    const appMode = getAppMode();
    const body = await req.json();
    const { runtimeConfig: rawConfig } = body;

    let resolvedConfig;
    let networkConfig = DEFAULT_NETWORK_CONFIG;

    if (appMode === "developer") {
      const parsed = runtimeConfigSchema.safeParse(rawConfig);
      if (parsed.success) {
        resolvedConfig = await mergeRuntimeConfigWithEnvSecrets(parsed.data);
        networkConfig = parsed.data.network;
      } else {
        return new Response(
          JSON.stringify({ error: "Invalid runtime config." }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    } else {
      try {
        const resolved = await createStandardRuntimeConfig({
          requestedNetworkConfig: rawConfig?.network,
          requestedRuntimeConfig: rawConfig,
        });
        resolvedConfig = resolved.selectedRuntimeConfig;
        networkConfig = resolved.selectedNetworkConfig;
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Config resolution failed.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // Railgun mode: fetch shielded balances and use 0zk address.
    if (resolvedConfig.actor.type === "railgun") {
      const { fetchRailgunPortfolio } = await import("@/lib/portfolio/portfolio-service");
      const portfolio = await fetchRailgunPortfolio(networkConfig);
      return Response.json(portfolio);
    }

    const walletAddress = deriveWalletAddress(resolvedConfig);
    if (!walletAddress) {
      return Response.json(
        { error: "no_wallet", message: "No wallet address configured." },
        { status: 200 },
      );
    }

    const portfolio = await fetchPortfolio(walletAddress, networkConfig);

    return Response.json(portfolio);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Portfolio fetch failed.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
