import type { UIMessage } from "ai";
import { z } from "zod";

export const debugLogSchema = z.object({
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error"]),
  stage: z.enum(["request", "step", "tool", "response", "error"]),
  message: z.string(),
  detail: z.string().optional(),
});

export type DebugLogEntry = z.infer<typeof debugLogSchema>;

export type AssistantUIMessage = UIMessage<
  never,
  {
    debug: DebugLogEntry;
  }
>;

export const assistantDataPartSchemas = {
  debug: debugLogSchema,
} as const;

export function createDebugLog(
  entry: Omit<DebugLogEntry, "timestamp">
): DebugLogEntry {
  return {
    timestamp: new Date().toISOString(),
    ...entry,
  };
}
