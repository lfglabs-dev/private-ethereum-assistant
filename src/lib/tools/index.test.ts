import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import { createDefaultRuntimeConfig } from "../runtime-config";
import { detectModeSwitchRequired } from "../mode";
import { getTools } from "./index";
import { guardToolExecution } from "./access-control";

function createRuntimeConfig(mode: "eoa" | "safe" | "railgun") {
  const runtimeConfig = createDefaultRuntimeConfig();

  return {
    ...runtimeConfig,
    actor: {
      type: mode,
    },
  };
}

describe("mode-scoped tool registry", () => {
  test("EOA mode exposes only EOA execution tools plus universal reads", () => {
    const tools = getTools(createRuntimeConfig("eoa").network, createRuntimeConfig("eoa"));

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "send_token",
        "send_eoa_transfer",
        "prepare_swap",
        "execute_swap",
        "get_balance",
        "resolve_ens",
      ]),
    );
    expect(Object.keys(tools)).not.toContain("swap_tokens");
    expect(Object.keys(tools)).not.toContain("get_safe_info");
    expect(Object.keys(tools)).not.toContain("railgun_balance");
  });

  test("Safe mode exposes only Safe execution tools plus universal reads", () => {
    const tools = getTools(createRuntimeConfig("safe").network, createRuntimeConfig("safe"));

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "get_safe_info",
        "get_pending_transactions",
        "propose_transaction",
        "swap_tokens",
        "get_balance",
      ]),
    );
    expect(Object.keys(tools)).not.toContain("send_token");
    expect(Object.keys(tools)).not.toContain("railgun_balance");
  });

  test("Private mode exposes only Railgun execution tools plus universal reads", () => {
    const tools = getTools(
      createRuntimeConfig("railgun").network,
      createRuntimeConfig("railgun"),
    );

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "railgun_balance",
        "railgun_shield",
        "railgun_transfer",
        "railgun_unshield",
        "get_balance",
      ]),
    );
    expect(Object.keys(tools)).not.toContain("send_token");
    expect(Object.keys(tools)).not.toContain("get_safe_info");
    expect(Object.keys(tools)).not.toContain("swap_tokens");
  });

  test("clear out-of-mode requests return a structured mode-switch result", () => {
    expect(
      detectModeSwitchRequired(
        "Send 0.001 ETH from my Safe to vitalik.eth.",
        "eoa",
      ),
    ).toEqual({
      kind: "mode_switch_required",
      currentMode: "eoa",
      requestedMode: "safe",
      originalRequest: "Send 0.001 ETH from my Safe to vitalik.eth.",
      reason: "This request targets your configured Safe.",
      summary: "Switch to Safe mode to continue",
      message:
        "This request needs Safe mode. Confirm the mode change and I'll replay it with the Safe toolset.",
    });
  });

  test("server-side execution guard rejects out-of-mode tool calls", async () => {
    const guardedTool = guardToolExecution(
      "send_eoa_transfer",
      "safe",
      tool({
        description: "Send an EOA transfer.",
        inputSchema: z.object({
          confirmationId: z.string(),
        }),
        execute: async () => ({ ok: true }),
      }),
    );
    if (!guardedTool.execute) {
      throw new Error("Expected guarded tool execution handler.");
    }

    await expect(
      Promise.resolve().then(() =>
        guardedTool.execute(
          {
            confirmationId: "confirmation-id",
          },
          {
            toolCallId: "tool-call-id",
            messages: [],
          } as never,
        ),
      ),
    ).rejects.toThrow('Tool "send_eoa_transfer" is not allowed in safe mode.');
  });
});
