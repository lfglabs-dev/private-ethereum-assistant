import { z } from "zod";
import {
  getSecret,
  getSecretBackend,
  listStoredSecretKeys,
  rememberStoredSecret,
  type SecretStoreKey,
} from "./secret-store";
import { isMacKeychainAccessDeniedError } from "./backends/macos-keychain";
import {
  createDeveloperDisplayRuntimeConfig,
  mergeRuntimeConfigOverrides,
  type RuntimeConfig,
} from "./runtime-config";
import type { NetworkConfig } from "./ethereum";
import { seedPhraseToPrivateKey, validateSeedPhrase } from "./seed-phrase";

const envPrivateKeySchema = z
  .string()
  .trim()
  .transform((value) => (value.startsWith("0x") ? value : `0x${value}`))
  .refine(
    (value) => /^0x[0-9a-fA-F]{64}$/.test(value),
    "Enter a valid 32-byte private key.",
  );

const envApiKeySchema = z.string().trim().min(1, "Enter a Safe API key.");

const envSeedPhraseSchema = z
  .string()
  .trim()
  .min(1, "Enter a seed phrase.")
  .refine(
    (value) => validateSeedPhrase(value),
    "Enter a valid BIP39 seed phrase (12 or 24 words).",
  );

export const envSecretsPayloadSchema = z
  .object({
    seedPhrase: envSeedPhraseSchema.optional(),
    safeSignerPrivateKey: envPrivateKeySchema.optional(),
    safeApiKey: envApiKeySchema.optional(),
  })
  .refine(
    (value) =>
      value.seedPhrase !== undefined ||
      value.safeSignerPrivateKey !== undefined ||
      value.safeApiKey !== undefined,
    "Provide at least one key to save.",
  );

export type EnvSecretStatus = {
  seedPhrase: boolean;
  safeSignerPrivateKey: boolean;
  safeApiKey: boolean;
  accessDenied: boolean;
};

type SavedEnvVariable =
  | "seedPhrase"
  | "safeSignerPrivateKey"
  | "safeApiKey";

const ENV_SECRET_VARIABLES: Record<SavedEnvVariable, SecretStoreKey> = {
  seedPhrase: "SEED_PHRASE",
  safeSignerPrivateKey: "SAFE_SIGNER_PRIVATE_KEY",
  safeApiKey: "SAFE_API_KEY",
};

function normalizePrivateKey(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value.startsWith("0x") ? value : `0x${value}`;
}

export async function getEnvSecretStatus(): Promise<EnvSecretStatus> {
  try {
    const configuredKeys = new Set((await listStoredSecretKeys()) ?? []);

    return {
      seedPhrase: configuredKeys.has("SEED_PHRASE"),
      safeSignerPrivateKey: configuredKeys.has("SAFE_SIGNER_PRIVATE_KEY"),
      safeApiKey: configuredKeys.has("SAFE_API_KEY"),
      accessDenied: false,
    };
  } catch (error) {
    if (isMacKeychainAccessDeniedError(error)) {
      return {
        seedPhrase: false,
        safeSignerPrivateKey: false,
        safeApiKey: false,
        accessDenied: true,
      };
    }

    throw error;
  }
}

export async function mergeRuntimeConfigWithEnvSecrets(
  runtimeConfig: RuntimeConfig,
): Promise<RuntimeConfig> {
  const [signerKey, seedPhrase] = await Promise.all([
    getSecret("SAFE_SIGNER_PRIVATE_KEY"),
    getSecret("SEED_PHRASE"),
  ]);

  const trimmedSeedPhrase = seedPhrase?.trim() || "";
  const derivedEoaPrivateKey = trimmedSeedPhrase
    ? seedPhraseToPrivateKey(trimmedSeedPhrase)
    : "";

  return {
    ...runtimeConfig,
    safe: {
      ...runtimeConfig.safe,
      signerPrivateKey: normalizePrivateKey(signerKey?.trim()),
    },
    wallet: {
      ...runtimeConfig.wallet,
      eoaPrivateKey: derivedEoaPrivateKey,
    },
    railgun: {
      ...runtimeConfig.railgun,
      mnemonic: trimmedSeedPhrase,
    },
  };
}

async function getDeveloperSeedPhrase() {
  const value = await getSecret("SEED_PHRASE");
  if (!value) {
    throw new Error(
      "Developer mode requires SEED_PHRASE in .env.tianjin.",
    );
  }

  const trimmed = value.trim();
  if (!validateSeedPhrase(trimmed)) {
    throw new Error("Developer mode SEED_PHRASE is not a valid BIP39 mnemonic.");
  }

  return trimmed;
}

export async function getConfiguredEoaPrivateKey() {
  const seedPhrase = await getDeveloperSeedPhrase();
  return seedPhraseToPrivateKey(seedPhrase);
}

export async function createDeveloperRuntimeConfig(): Promise<RuntimeConfig> {
  const displayRuntimeConfig = createDeveloperDisplayRuntimeConfig();
  const seedPhrase = await getDeveloperSeedPhrase();
  const derivedPrivateKey = seedPhraseToPrivateKey(seedPhrase);

  return {
    ...displayRuntimeConfig,
    safe: {
      ...displayRuntimeConfig.safe,
      signerPrivateKey: derivedPrivateKey,
    },
    wallet: {
      ...displayRuntimeConfig.wallet,
      eoaPrivateKey: derivedPrivateKey,
    },
    railgun: {
      ...displayRuntimeConfig.railgun,
      mnemonic: seedPhrase,
    },
  };
}

export async function mergeDeveloperRuntimeConfig(
  overrides?: RuntimeConfig | null,
  networkConfig?: NetworkConfig,
) {
  return mergeRuntimeConfigOverrides(await createDeveloperRuntimeConfig(), overrides, networkConfig);
}

export async function saveEnvSecrets(
  payload: z.input<typeof envSecretsPayloadSchema>,
) {
  const parsed = envSecretsPayloadSchema.parse(payload);
  const updates: Partial<Record<SavedEnvVariable, string>> = {};
  const saved: SavedEnvVariable[] = [];

  for (const [fieldName] of Object.entries(
    ENV_SECRET_VARIABLES,
  ) as Array<[SavedEnvVariable, string]>) {
    const nextValue = parsed[fieldName];
    if (typeof nextValue !== "string") {
      continue;
    }

    updates[fieldName] = nextValue;
    saved.push(fieldName);
  }

  const backend = getSecretBackend();
  if (!backend) {
    throw new Error("No secret backend is available.");
  }

  for (const [fieldName, value] of Object.entries(updates) as Array<
    [SavedEnvVariable, string]
  >) {
    await backend.set(ENV_SECRET_VARIABLES[fieldName], value);
    rememberStoredSecret(ENV_SECRET_VARIABLES[fieldName], value);
  }
  return {
    success: true as const,
    saved,
  };
}
