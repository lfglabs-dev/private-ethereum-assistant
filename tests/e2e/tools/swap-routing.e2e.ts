import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createDefaultRuntimeConfig } from "@/lib/runtime-config";
import { createTools } from "@/lib/tools";
import {
  ARBITRUM_CONFIG,
  E2E_TEST_TIMEOUT_MS,
  executeTool,
} from "../helpers/config";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

function createSwapRuntimeConfig(actor: "safe" | "railgun") {
  const runtimeConfig = createDefaultRuntimeConfig();

  return {
    ...runtimeConfig,
    network: ARBITRUM_CONFIG,
    wallet: {
      ...runtimeConfig.wallet,
      eoaPrivateKey:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    actor: {
      type: actor,
    },
  };
}

const safeTools = createTools(ARBITRUM_CONFIG, createSwapRuntimeConfig("safe"));

const railgunTools = createTools(
  ARBITRUM_CONFIG,
  createSwapRuntimeConfig("railgun"),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("swap routing E2E", () => {
  test("Safe actor returns a manual continuation CoW swap plan", async () => {
    const result = await executeTool(safeTools.swap_tokens, {
      sellToken: "ETH",
      buyToken: "USDC",
      amount: "0.001",
    });

    if (!isRecord(result)) {
      throw new Error("Expected swap_tokens to return a result object.");
    }

    expect(result.kind).toBe("swap_result");
    expect(result.actor).toBe("safe");
    expect(result.status).toBe("manual_action_required");
    expect(isRecord(result.plan) ? result.plan.executionPath : undefined).toBe("safe_manual");
    expect(isRecord(result.execution) ? result.execution.safeUILink : undefined).toBeTruthy();
  });

  test("Railgun actor returns an unsupported private swap plan", async () => {
    const result = await executeTool(railgunTools.swap_tokens, {
      sellToken: "ETH",
      buyToken: "USDC",
      amount: "0.001",
    });

    if (!isRecord(result)) {
      throw new Error("Expected swap_tokens to return a result object.");
    }

    expect(result.kind).toBe("swap_result");
    expect(result.actor).toBe("railgun");
    expect(result.status).toBe("unsupported");
    expect(isRecord(result.plan) ? result.plan.executionPath : undefined).toBe(
      "railgun_unsupported",
    );
    expect(String(result.message ?? "").toLowerCase()).toContain("public cow route");
  });
});
