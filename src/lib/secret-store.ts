import { MacKeychainBackend } from "./backends/macos-keychain";

export interface SecretBackend {
  readonly name: string;
  isAvailable(): boolean;
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
  list(): Promise<string[]>;
}

export const SECRET_STORE_KEYS = [
  "EOA_PRIVATE_KEY",
  "SAFE_SIGNER_PRIVATE_KEY",
  "SAFE_API_KEY",
] as const;

export type SecretStoreKey = (typeof SECRET_STORE_KEYS)[number];

const SECRET_STORE_KEY_SET = new Set<string>(SECRET_STORE_KEYS);

const CACHE_TTL_MS = 30_000;
const secretCache = new Map<string, { value: string; expiresAt: number }>();

function isDeveloperMode() {
  return process.env.APP_MODE === "developer" ||
    process.env.NEXT_PUBLIC_APP_MODE === "developer";
}

function getDeveloperModeEnvSecret(key: SecretStoreKey): string | null {
  if (!isDeveloperMode()) {
    return null;
  }

  const value = process.env[key]?.trim();
  return value ? value : null;
}

export function getSecretBackend(): SecretBackend | null {
  const backends: SecretBackend[] = [new MacKeychainBackend()];

  for (const backend of backends) {
    if (backend.isAvailable()) {
      return backend;
    }
  }

  return null;
}

export async function getSecret(key: SecretStoreKey): Promise<string | null> {
  const envValue = getDeveloperModeEnvSecret(key);
  if (envValue !== null) {
    return envValue;
  }

  const cached = secretCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  const backend = getSecretBackend();
  if (!backend) {
    return null;
  }

  const value = await backend.get(key);

  if (value !== null) {
    secretCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  } else {
    secretCache.delete(key);
  }

  return value;
}

export async function hasSecret(key: SecretStoreKey): Promise<boolean> {
  const value = await getSecret(key);
  return value !== null && value.trim().length > 0;
}

export function invalidateSecretCache() {
  secretCache.clear();
}

export async function loadAllSecrets(): Promise<Record<string, string> | null> {
  if (isDeveloperMode()) {
    const envSecrets = Object.fromEntries(
      SECRET_STORE_KEYS.flatMap((key) => {
        const value = getDeveloperModeEnvSecret(key);
        return value === null ? [] : [[key, value]];
      }),
    );

    return envSecrets;
  }

  const backend = getSecretBackend();
  if (!backend) {
    return null;
  }

  const accounts = await backend.list();
  const secrets: Record<string, string> = {};

  for (const account of accounts) {
    if (!SECRET_STORE_KEY_SET.has(account)) {
      continue;
    }

    const value = await backend.get(account);
    if (value !== null) {
      secrets[account] = value;
    }
  }

  return secrets;
}
