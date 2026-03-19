const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const SAVE_ENV_CONFIRMATION_TOKEN_TTL_MS = 10 * 60 * 1000;

type SaveEnvConfirmationTokenRecord = {
  expiresAt: number;
};

const saveEnvConfirmationTokens = new Map<string, SaveEnvConfirmationTokenRecord>();

function isLoopbackHostname(hostname: string) {
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

function parseHeaderUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function cleanupSaveEnvConfirmationTokens(now = Date.now()) {
  for (const [token, record] of saveEnvConfirmationTokens.entries()) {
    if (record.expiresAt <= now) {
      saveEnvConfirmationTokens.delete(token);
    }
  }
}

export function validateTrustedLocalRequest(req: Request) {
  let requestUrl: URL;
  try {
    requestUrl = new URL(req.url);
  } catch {
    return {
      ok: false as const,
      error: "Invalid request URL.",
    };
  }

  if (!isLoopbackHostname(requestUrl.hostname)) {
    return {
      ok: false as const,
      error: "This endpoint is only available from localhost.",
    };
  }

  const originUrl = parseHeaderUrl(req.headers.get("origin"));
  const refererUrl = parseHeaderUrl(req.headers.get("referer"));
  const sourceUrl = originUrl ?? refererUrl;

  if (!sourceUrl) {
    return {
      ok: false as const,
      error: "Missing Origin or Referer header.",
    };
  }

  if (!isLoopbackHostname(sourceUrl.hostname)) {
    return {
      ok: false as const,
      error: "Only localhost origins may call this endpoint.",
    };
  }

  if (sourceUrl.origin !== requestUrl.origin) {
    return {
      ok: false as const,
      error: "Origin mismatch.",
    };
  }

  return {
    ok: true as const,
    origin: sourceUrl.origin,
  };
}

export function createForbiddenLocalRequestResponse(error: string) {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function createSaveEnvConfirmationToken() {
  cleanupSaveEnvConfirmationTokens();
  const token = crypto.randomUUID();
  saveEnvConfirmationTokens.set(token, {
    expiresAt: Date.now() + SAVE_ENV_CONFIRMATION_TOKEN_TTL_MS,
  });
  return token;
}

export function consumeSaveEnvConfirmationToken(token: string) {
  cleanupSaveEnvConfirmationTokens();
  const record = saveEnvConfirmationTokens.get(token);
  if (!record || record.expiresAt <= Date.now()) {
    saveEnvConfirmationTokens.delete(token);
    return false;
  }

  saveEnvConfirmationTokens.delete(token);
  return true;
}
