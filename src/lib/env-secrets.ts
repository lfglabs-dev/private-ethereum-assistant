import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import type { RuntimeConfig } from "./runtime-config";

const envPrivateKeySchema = z
  .string()
  .trim()
  .transform((value) => (value.startsWith("0x") ? value : `0x${value}`))
  .refine(
    (value) => /^0x[0-9a-fA-F]{64}$/.test(value),
    "Enter a valid 32-byte private key.",
  );

const envApiKeySchema = z.string().trim().min(1, "Enter a Safe API key.");

export const envSecretsPayloadSchema = z
  .object({
    eoaPrivateKey: envPrivateKeySchema.optional(),
    safeSignerPrivateKey: envPrivateKeySchema.optional(),
    safeApiKey: envApiKeySchema.optional(),
  })
  .refine(
    (value) =>
      value.eoaPrivateKey !== undefined ||
      value.safeSignerPrivateKey !== undefined ||
      value.safeApiKey !== undefined,
    "Provide at least one key to save.",
  );

export type EnvSecretStatus = {
  eoaPrivateKey: boolean;
  safeSignerPrivateKey: boolean;
  safeApiKey: boolean;
};

type SavedEnvVariable = "eoaPrivateKey" | "safeSignerPrivateKey" | "safeApiKey";

const ENV_SECRET_VARIABLES: Record<SavedEnvVariable, string> = {
  eoaPrivateKey: "EOA_PRIVATE_KEY",
  safeSignerPrivateKey: "SAFE_SIGNER_PRIVATE_KEY",
  safeApiKey: "SAFE_API_KEY",
};

const SIMPLE_ENV_VALUE_PATTERN = /^[A-Za-z0-9_./:@%+-]+$/;
const ENV_LINE_PATTERN = /^(\s*export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function normalizePrivateKey(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value.startsWith("0x") ? value : `0x${value}`;
}

function serializeEnvValue(value: string) {
  if (SIMPLE_ENV_VALUE_PATTERN.test(value)) {
    return value;
  }

  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n")}"`;
}

export function getEnvLocalPath() {
  return path.resolve(process.cwd(), ".env.local");
}

export function getEnvSecretStatus(): EnvSecretStatus {
  return {
    eoaPrivateKey: Boolean(process.env.EOA_PRIVATE_KEY?.trim()),
    safeSignerPrivateKey: Boolean(process.env.SAFE_SIGNER_PRIVATE_KEY?.trim()),
    safeApiKey: Boolean(process.env.SAFE_API_KEY?.trim()),
  };
}

export function mergeRuntimeConfigWithEnvSecrets(
  runtimeConfig: RuntimeConfig,
): RuntimeConfig {
  return {
    ...runtimeConfig,
    safe: {
      ...runtimeConfig.safe,
      signerPrivateKey: normalizePrivateKey(process.env.SAFE_SIGNER_PRIVATE_KEY?.trim()),
    },
    wallet: {
      ...runtimeConfig.wallet,
      eoaPrivateKey: normalizePrivateKey(process.env.EOA_PRIVATE_KEY?.trim()),
    },
  };
}

export function upsertEnvFileContent(
  content: string,
  updates: Partial<Record<SavedEnvVariable, string>>,
) {
  const entries = Object.entries(updates).filter(
    (entry): entry is [SavedEnvVariable, string] => typeof entry[1] === "string",
  );
  if (entries.length === 0) {
    return content;
  }

  const nextLines = (content ? content.split(/\r?\n/) : []).map((line) => {
    const match = ENV_LINE_PATTERN.exec(line);
    if (!match) {
      return line;
    }

    const variable = Object.entries(ENV_SECRET_VARIABLES).find(
      ([, envName]) => envName === match[2],
    );
    if (!variable) {
      return line;
    }

    const [fieldName] = variable as [SavedEnvVariable, string];
    const nextValue = updates[fieldName];
    return typeof nextValue === "string"
      ? `${match[1] ?? ""}${match[2]}=${serializeEnvValue(nextValue)}`
      : line;
  });

  const existingEnvNames = new Set(
    nextLines
      .map((line) => ENV_LINE_PATTERN.exec(line)?.[2])
      .filter((value): value is string => Boolean(value)),
  );

  const missingEntries = entries.filter(
    ([fieldName]) => !existingEnvNames.has(ENV_SECRET_VARIABLES[fieldName]),
  );

  if (missingEntries.length === 0) {
    return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
  }

  const prefix = nextLines.length > 0 && nextLines.at(-1) !== "" ? "\n" : "";
  const appendedLines = missingEntries.map(
    ([fieldName, value]) =>
      `${ENV_SECRET_VARIABLES[fieldName]}=${serializeEnvValue(value)}`,
  );

  return `${nextLines.join("\n")}${prefix}${appendedLines.join("\n")}\n`;
}

export async function saveEnvSecrets(
  payload: z.input<typeof envSecretsPayloadSchema>,
) {
  const parsed = envSecretsPayloadSchema.parse(payload);
  const envFilePath = getEnvLocalPath();
  const currentContent = await fs.readFile(envFilePath, "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return "";
    }

    throw error;
  });

  const updates: Partial<Record<SavedEnvVariable, string>> = {};
  const saved: SavedEnvVariable[] = [];

  for (const [fieldName, envName] of Object.entries(
    ENV_SECRET_VARIABLES,
  ) as Array<[SavedEnvVariable, string]>) {
    const nextValue = parsed[fieldName];
    if (typeof nextValue !== "string") {
      continue;
    }

    updates[fieldName] = nextValue;
    process.env[envName] = nextValue;
    saved.push(fieldName);
  }

  const nextContent = upsertEnvFileContent(currentContent, updates);
  await fs.writeFile(envFilePath, nextContent, "utf8");

  return {
    success: true as const,
    saved,
  };
}
