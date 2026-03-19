const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const WHITESPACE_RUNS = /\s+/g;

export function sanitizeUntrustedText(
  value: string | null | undefined,
  maxLength: number,
) {
  const normalized = String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(WHITESPACE_RUNS, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.slice(0, maxLength);
}

export function formatUntrustedDataLiteral(
  value: string | null | undefined,
  maxLength: number,
  fallback: string,
) {
  const sanitized = sanitizeUntrustedText(value, maxLength);
  const normalized = sanitized || fallback;
  return `data(${JSON.stringify(normalized)})`;
}
