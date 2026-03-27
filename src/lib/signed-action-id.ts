import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Cache in globalThis so the secret survives HMR / module reloads in Next.js dev.
const GLOBAL_KEY = "__local_action_signing_secret__";
function getSigningSecret(): string {
  const env = process.env.LOCAL_ACTION_SIGNING_SECRET?.trim();
  if (env) return env;
  const g = globalThis as Record<string, unknown>;
  if (typeof g[GLOBAL_KEY] === "string") return g[GLOBAL_KEY] as string;
  const secret = randomBytes(32).toString("hex");
  g[GLOBAL_KEY] = secret;
  return secret;
}
const SIGNING_SECRET = getSigningSecret();

function signValue(value: string) {
  return createHmac("sha256", SIGNING_SECRET).update(value).digest("base64url");
}

export function signLocalActionId(id: string, purpose: string) {
  const signature = signValue(`${purpose}:${id}`);
  return `${purpose}:${id}.${signature}`;
}

export function verifyLocalActionId(token: string, purpose: string) {
  const delimiterIndex = token.lastIndexOf(".");
  const separatorIndex = token.indexOf(":");
  if (
    delimiterIndex <= 0 ||
    delimiterIndex === token.length - 1 ||
    separatorIndex <= 0 ||
    separatorIndex >= delimiterIndex
  ) {
    return null;
  }

  const tokenPurpose = token.slice(0, separatorIndex);
  if (tokenPurpose !== purpose) {
    return null;
  }

  const id = token.slice(separatorIndex + 1, delimiterIndex);
  const signature = token.slice(delimiterIndex + 1);
  const expectedSignature = signValue(`${purpose}:${id}`);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  return id;
}
