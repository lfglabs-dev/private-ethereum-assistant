import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStandardRuntimeConfig } from "./server-runtime-config";
import { invalidateSecretCache } from "./secret-store";

function createSpawnResult(exitCode: number, stdout = "", stderr = "") {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
  } as Bun.Subprocess<Blob | "ignore", "pipe", "pipe">;
}

describe("standard runtime config", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    invalidateSecretCache();
    mock.restore();
  });

  test("uses the local LLM provider in standard mode", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "pea-standard-runtime-"));

    try {
      process.chdir(tempDir);

      const helperPath = path.join(
        tempDir,
        "native",
        "keychain-helper",
        ".build",
        "release",
        "keychain-helper",
      );
      mkdirSync(path.dirname(helperPath), { recursive: true });
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(helperPath, 0o755);

      spyOn(Bun, "spawn").mockImplementation(() =>
        createSpawnResult(0, "{}"),
      );

      invalidateSecretCache();
      const result = await createStandardRuntimeConfig({});

      expect(result.selectedRuntimeConfig.llm.provider).toBe("local");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
