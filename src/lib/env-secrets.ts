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
  normalizeDeveloperRuntimeConfig,
  type RuntimeConfig,
} from "./runtime-config";
import type { NetworkConfig } from "./ethereum";

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
    railgunMnemonic: z.string().trim().min(1, "Enter a Railgun mnemonic.").optional(),
  })
  .refine(
    (value) =>
      value.eoaPrivateKey !== undefined ||
      value.safeSignerPrivateKey !== undefined ||
      value.safeApiKey !== undefined ||
      value.railgunMnemonic !== undefined,
    "Provide at least one key to save.",
  );

export type EnvSecretStatus = {
  eoaPrivateKey: boolean;
  safeSignerPrivateKey: boolean;
  safeApiKey: boolean;
  railgunMnemonic: boolean;
  accessDenied: boolean;
};

type SavedEnvVariable =
  | "eoaPrivateKey"
  | "safeSignerPrivateKey"
  | "safeApiKey"
  | "railgunMnemonic";

const ENV_SECRET_VARIABLES: Record<SavedEnvVariable, SecretStoreKey> = {
  eoaPrivateKey: "EOA_PRIVATE_KEY",
  safeSignerPrivateKey: "SAFE_SIGNER_PRIVATE_KEY",
  safeApiKey: "SAFE_API_KEY",
  railgunMnemonic: "RAILGUN_MNEMONIC",
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
      eoaPrivateKey: configuredKeys.has("EOA_PRIVATE_KEY"),
      safeSignerPrivateKey: configuredKeys.has("SAFE_SIGNER_PRIVATE_KEY"),
      safeApiKey: configuredKeys.has("SAFE_API_KEY"),
      railgunMnemonic: configuredKeys.has("RAILGUN_MNEMONIC"),
      accessDenied: false,
    };
  } catch (error) {
    if (isMacKeychainAccessDeniedError(error)) {
      return {
        eoaPrivateKey: false,
        safeSignerPrivateKey: false,
        safeApiKey: false,
        railgunMnemonic: false,
        accessDenied: true,
      };
    }

    throw error;
  }
}

export async function mergeRuntimeConfigWithEnvSecrets(
  runtimeConfig: RuntimeConfig,
): Promise<RuntimeConfig> {
  const [signerKey, eoaKey, railgunMnemonic] = await Promise.all([
    getSecret("SAFE_SIGNER_PRIVATE_KEY"),
    getSecret("EOA_PRIVATE_KEY"),
    getSecret("RAILGUN_MNEMONIC"),
  ]);

  return {
    ...runtimeConfig,
    safe: {
      ...runtimeConfig.safe,
      signerPrivateKey: normalizePrivateKey(signerKey?.trim()),
    },
    wallet: {
      ...runtimeConfig.wallet,
      eoaPrivateKey: normalizePrivateKey(eoaKey?.trim()),
    },
    railgun: {
      ...runtimeConfig.railgun,
      mnemonic: railgunMnemonic?.trim() || "",
    },
  };
}

async function getDeveloperWalletPrivateKey() {
  const value = await getSecret("EOA_PRIVATE_KEY");
  if (!value) {
    throw new Error(
      "Developer mode requires EOA_PRIVATE_KEY in .env.tianjin.",
    );
  }

  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Developer mode wallet private key is not a valid 32-byte hex value.");
  }

  return normalized;
}

export async function getConfiguredEoaPrivateKey() {
  return getDeveloperWalletPrivateKey();
}

export async function createDeveloperRuntimeConfig(): Promise<RuntimeConfig> {
  const displayRuntimeConfig = createDeveloperDisplayRuntimeConfig();
  const developerWalletPrivateKey = await getDeveloperWalletPrivateKey();

  return {
    ...displayRuntimeConfig,
    safe: {
      ...displayRuntimeConfig.safe,
      signerPrivateKey: developerWalletPrivateKey,
    },
    wallet: {
      ...displayRuntimeConfig.wallet,
      eoaPrivateKey: developerWalletPrivateKey,
    },
    railgun: {
      ...displayRuntimeConfig.railgun,
      mnemonic: "",
    },
  };
}

export async function mergeDeveloperRuntimeConfig(
  overrides?: RuntimeConfig | null,
  networkConfig?: NetworkConfig,
) {
  return normalizeDeveloperRuntimeConfig(
    mergeRuntimeConfigOverrides(await createDeveloperRuntimeConfig(), overrides, networkConfig),
  );
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
    throw new Error("No secret backend is available. macOS Keychain is required.");
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
