import { describe, expect, test } from "bun:test";
import { POST } from "./route";

describe("POST /api/eoa-approval", () => {
  test("rejects browser-supplied runtimeConfig payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/eoa-approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({
          action: "approve",
          confirmationId: "confirmation-id",
          runtimeConfig: {
            network: {
              chainId: 1,
              rpcUrl: "https://attacker.example",
            },
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/unrecognized/i),
    });
  });

  test("rejects non-local origins", async () => {
    const response = await POST(
      new Request("http://localhost/api/eoa-approval", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({
          action: "reject",
          confirmationId: "confirmation-id",
        }),
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/localhost|origin/i),
    });
  });
});
