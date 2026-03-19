import { getEnvSecretStatus } from "@/lib/env-secrets";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await getEnvSecretStatus());
}
