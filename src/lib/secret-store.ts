import { EncryptedFileBackend } from "./backends/encrypted-file";
import { LinuxSecretServiceBackend } from "./backends/linux-secret-service";
import { MacKeychainBackend } from "./backends/macos-keychain";
import { SECRET_STORE_SERVICE } from "./backends/constants";
import { WindowsCredentialBackend } from "./backends/windows-credential";

export interface SecretBackend {
  readonly name: string;
  isAvailable(): boolean;
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
  list(): Promise<string[]>;
  loadAll(): Promise<Record<string, string>>;
}

export const SECRET_STORE_KEYS = [
  "SEED_PHRASE",
  "SAFE_SIGNER_PRIVATE_KEY",
  "SAFE_API_KEY",
] as const;

export type SecretStoreKey = (typeof SECRET_STORE_KEYS)[number];

const SECRET_STORE_KEY_SET = new Set<string>(SECRET_STORE_KEYS);
const loadedSecretValues: Partial<Record<SecretStoreKey, string | null>> = {};
const loadedSecretKeys = new Set<SecretStoreKey>();
const loadedSecretPromises: Partial<Record<SecretStoreKey, Promise<string | null>>> = {};
let listedSecretKeys: SecretStoreKey[] | null = null;
let listedSecretKeysReady = false;
let listedSecretKeysPromise: Promise<SecretStoreKey[] | null> | null = null;

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
  return selectSecretBackend(createSecretBackends());
}

export function createSecretBackends(): SecretBackend[] {
  return [
    new MacKeychainBackend(SECRET_STORE_SERVICE),
    new WindowsCredentialBackend(SECRET_STORE_SERVICE),
    new LinuxSecretServiceBackend(SECRET_STORE_KEYS, SECRET_STORE_SERVICE),
    new EncryptedFileBackend(SECRET_STORE_SERVICE),
  ];
}

export function selectSecretBackend(backends: readonly SecretBackend[]) {
  const candidates = [...backends];

  for (const backend of candidates) {
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

  if (loadedSecretKeys.has(key)) {
    return loadedSecretValues[key] ?? null;
  }

  if (loadedSecretPromises[key]) {
    return loadedSecretPromises[key];
  }

  const backend = getSecretBackend();
  if (!backend) {
    return null;
  }

  loadedSecretPromises[key] = (async () => {
    const value = await backend.get(key);
    loadedSecretValues[key] = value;
    loadedSecretKeys.add(key);

    if (listedSecretKeysReady) {
      syncListedSecretKey(key, value);
    }

    return value;
  })();

  try {
    return await loadedSecretPromises[key];
  } finally {
    delete loadedSecretPromises[key];
  }
}

export async function hasSecret(key: SecretStoreKey): Promise<boolean> {
  const value = await getSecret(key);
  return value !== null && value.trim().length > 0;
}

export async function listStoredSecretKeys(): Promise<SecretStoreKey[] | null> {
  if (isDeveloperMode()) {
    return SECRET_STORE_KEYS.filter((key) => getDeveloperModeEnvSecret(key) !== null);
  }

  if (listedSecretKeysReady) {
    return [...(listedSecretKeys ?? [])];
  }

  if (listedSecretKeysPromise) {
    return listedSecretKeysPromise;
  }

  const backend = getSecretBackend();
  if (!backend) {
    return null;
  }

  listedSecretKeysPromise = (async () => {
    const storedKeys = (await backend.list()).filter(
      (key): key is SecretStoreKey => SECRET_STORE_KEY_SET.has(key),
    );
    listedSecretKeys = storedKeys;
    listedSecretKeysReady = true;
    return [...storedKeys];
  })();

  try {
    return await listedSecretKeysPromise;
  } finally {
    listedSecretKeysPromise = null;
  }
}

export function invalidateSecretCache() {
  for (const key of SECRET_STORE_KEYS) {
    delete loadedSecretValues[key];
    delete loadedSecretPromises[key];
  }

  loadedSecretKeys.clear();
  listedSecretKeys = null;
  listedSecretKeysReady = false;
  listedSecretKeysPromise = null;
}

export function rememberStoredSecret(key: SecretStoreKey, value: string) {
  loadedSecretValues[key] = value;
  loadedSecretKeys.add(key);

  if (listedSecretKeysReady) {
    syncListedSecretKey(key, value);
  }
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

  const exported = await backend.loadAll();
  const filteredEntries = Object.entries(exported).filter(([key]) => SECRET_STORE_KEY_SET.has(key));
  const filteredSecrets = Object.fromEntries(filteredEntries) as Record<SecretStoreKey, string>;

  listedSecretKeys = [];
  listedSecretKeysReady = true;

  for (const key of SECRET_STORE_KEYS) {
    const value = filteredSecrets[key] ?? null;
    loadedSecretValues[key] = value;
    loadedSecretKeys.add(key);
    if (value && value.trim().length > 0) {
      listedSecretKeys.push(key);
    }
  }

  return { ...filteredSecrets };
}

function syncListedSecretKey(key: SecretStoreKey, value: string | null) {
  if (!listedSecretKeys) {
    listedSecretKeys = [];
  }

  const nextListedSecretKeys = new Set(listedSecretKeys);
  if (value && value.trim().length > 0) {
    nextListedSecretKeys.add(key);
  } else {
    nextListedSecretKeys.delete(key);
  }

  listedSecretKeys = SECRET_STORE_KEYS.filter((candidate) => nextListedSecretKeys.has(candidate));
}
