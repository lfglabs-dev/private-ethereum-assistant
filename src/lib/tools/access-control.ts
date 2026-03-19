import { tool, type Tool } from "ai";
import type { ExecutionMode } from "../mode";

const TOOL_MODE_ALLOWLIST = {
  get_balance: ["eoa", "safe", "railgun"],
  get_portfolio: ["eoa", "safe", "railgun"],
  get_transaction: ["eoa", "safe", "railgun"],
  resolve_ens: ["eoa", "safe", "railgun"],
  reverse_resolve_ens: ["eoa", "safe", "railgun"],
  prepare_eoa_transfer: ["eoa"],
  send_eoa_transfer: ["eoa"],
  prepare_swap: ["eoa"],
  execute_swap: ["eoa"],
  get_safe_info: ["safe"],
  get_pending_transactions: ["safe"],
  propose_transaction: ["safe"],
  railgun_balance: ["railgun"],
  railgun_balance_route: ["railgun"],
  railgun_shield: ["railgun"],
  railgun_transfer: ["railgun"],
  railgun_unshield: ["railgun"],
  swap_tokens: ["safe"],
} as const satisfies Record<string, readonly ExecutionMode[]>;

type ToolName = keyof typeof TOOL_MODE_ALLOWLIST;
type AnyTool = Tool<unknown, unknown>;

export function getAllowedModesForTool(toolName: ToolName) {
  return [...TOOL_MODE_ALLOWLIST[toolName]];
}

export function assertToolAllowedForMode(
  toolName: ToolName,
  activeMode: ExecutionMode,
) {
  const allowedModes = TOOL_MODE_ALLOWLIST[toolName] as readonly ExecutionMode[];
  if (allowedModes.includes(activeMode)) {
    return;
  }

  throw new Error(`Tool "${toolName}" is not allowed in ${activeMode} mode.`);
}

export function guardToolExecution<TTool extends AnyTool>(
  toolName: ToolName,
  activeMode: ExecutionMode,
  targetTool: TTool,
): TTool {
  if (!targetTool.execute) {
    return targetTool;
  }

  return tool({
    description: targetTool.description,
    inputSchema: targetTool.inputSchema,
    execute: (input, options) => {
      assertToolAllowedForMode(toolName, activeMode);
      return targetTool.execute!(input, options);
    },
  }) as TTool;
}

export function guardToolRegistryForMode<TRegistry extends Record<string, AnyTool>>(
  activeMode: ExecutionMode,
  registry: TRegistry,
) {
  return Object.fromEntries(
    Object.entries(registry).map(([toolName, targetTool]) => [
      toolName,
      guardToolExecution(toolName as ToolName, activeMode, targetTool),
    ]),
  ) as TRegistry;
}
