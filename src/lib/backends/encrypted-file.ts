import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { SecretBackend } from "../secret-store";
import {
  ENCRYPTED_SECRET_STORE_FILE_ENV,
  ENCRYPTED_SECRET_STORE_PASSPHRASE_ENV,
  SECRET_STORE_SERVICE,
} from "./constants";

type EncryptedSecretsPayload = {
  ciphertext: string;
  iv: string;
  salt: string;
  service: string;
  tag: string;
  version: 1;
};

const ENCRYPTED_SECRET_STORE_VERSION = 1;
const ENCRYPTED_SECRET_STORE_DIRNAME = "private-ethereum-assistant";

function sanitizeFilenameSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function getEncryptedSecretFilePath(
  serviceName = SECRET_STORE_SERVICE,
  env = process.env,
  homeDir = homedir(),
) {
  const configuredPath = env[ENCRYPTED_SECRET_STORE_FILE_ENV]?.trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config");
  const filename = `${sanitizeFilenameSegment(serviceName)}.secrets.enc.json`;
  return path.join(configHome, ENCRYPTED_SECRET_STORE_DIRNAME, filename);
}

export class EncryptedFileBackend implements SecretBackend {
  readonly name = "Encrypted file";

  constructor(
    private readonly serviceName = SECRET_STORE_SERVICE,
    private readonly filePath = getEncryptedSecretFilePath(serviceName),
    private readonly env = process.env,
  ) {}

  isAvailable() {
    return process.platform === "linux" && this.getPassphrase().length > 0;
  }

  async get(account: string) {
    const secrets = this.readSecrets();
    return secrets[account] ?? null;
  }

  async set(account: string, value: string) {
    const secrets = this.readSecrets();
    secrets[account] = value;
    this.writeSecrets(secrets);
  }

  async delete(account: string) {
    const secrets = this.readSecrets();
    if (!(account in secrets)) {
      return;
    }

    delete secrets[account];
    if (Object.keys(secrets).length === 0) {
      rmSync(this.filePath, { force: true });
      return;
    }

    this.writeSecrets(secrets);
  }

  async list() {
    return Object.keys(this.readSecrets());
  }

  async loadAll() {
    return this.readSecrets();
  }

  private getPassphrase() {
    return this.env[ENCRYPTED_SECRET_STORE_PASSPHRASE_ENV]?.trim() ?? "";
  }

  private readSecrets() {
    if (!existsSync(this.filePath)) {
      return {} as Record<string, string>;
    }

    const payload = this.parsePayload(readFileSync(this.filePath, "utf8"));
    const key = scryptSync(this.getPassphraseOrThrow(), Buffer.from(payload.salt, "base64url"), 32);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(payload.service, "utf8"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(plaintext);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(
        ([key, value]) => typeof key !== "string" || typeof value !== "string",
      )
    ) {
      throw new Error(`${this.name} contains invalid secret data.`);
    }

    return parsed as Record<string, string>;
  }

  private writeSecrets(secrets: Record<string, string>) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.getPassphraseOrThrow(), salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(this.serviceName, "utf8"));

    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secrets), "utf8"),
      cipher.final(),
    ]);
    const payload: EncryptedSecretsPayload = {
      version: ENCRYPTED_SECRET_STORE_VERSION,
      service: this.serviceName,
      salt: salt.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };

    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, this.filePath);
    chmodSync(this.filePath, 0o600);
  }

  private getPassphraseOrThrow() {
    const passphrase = this.getPassphrase();
    if (!passphrase) {
      throw new Error(
        `${this.name} requires ${ENCRYPTED_SECRET_STORE_PASSPHRASE_ENV} to be set.`,
      );
    }

    return passphrase;
  }

  private parsePayload(raw: string) {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      parsed.version !== ENCRYPTED_SECRET_STORE_VERSION ||
      parsed.service !== this.serviceName ||
      typeof parsed.salt !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.tag !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      throw new Error(`${this.name} contains an invalid encrypted payload.`);
    }

    return parsed as EncryptedSecretsPayload;
  }
}
