import type { UIMessage } from "ai";
import { z } from "zod";
import { type ModeSwitchRequiredResult } from "./mode";

export const debugLogSchema = z.object({
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error"]),
  stage: z.enum(["request", "step", "tool", "response", "error"]),
  message: z.string(),
  detail: z.string().optional(),
});

export type DebugLogEntry = z.infer<typeof debugLogSchema>;

export const modeSwitchRequiredSchema = z.object({
  kind: z.literal("mode_switch_required"),
  currentMode: z.enum(["eoa", "safe", "railgun"]),
  requestedMode: z.enum(["eoa", "safe", "railgun"]),
  summary: z.string(),
  message: z.string(),
  reason: z.string(),
  originalRequest: z.string(),
});

export type AssistantUIMessage = UIMessage<
  never,
  {
    debug: DebugLogEntry;
    modeSwitchRequired: ModeSwitchRequiredResult;
  }
>;

export const assistantDataPartSchemas = {
  debug: debugLogSchema,
  modeSwitchRequired: modeSwitchRequiredSchema,
} as const;

export function createDebugLog(
  entry: Omit<DebugLogEntry, "timestamp">
): DebugLogEntry {
  return {
    timestamp: new Date().toISOString(),
    ...entry,
  };
}
