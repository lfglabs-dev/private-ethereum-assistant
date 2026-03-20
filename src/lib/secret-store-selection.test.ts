import { describe, expect, test } from "bun:test";
import { selectSecretBackend, type SecretBackend } from "./secret-store";

function createBackend(name: string, available: boolean): SecretBackend {
  return {
    name,
    isAvailable: () => available,
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
    loadAll: async () => ({}),
  };
}

describe("selectSecretBackend", () => {
  test("returns the first available backend", () => {
    expect(
      selectSecretBackend([
        createBackend("macOS Keychain", false),
        createBackend("Linux Secret Service", true),
        createBackend("Encrypted file", true),
      ]),
    )?.toMatchObject({ name: "Linux Secret Service" });
  });

  test("returns null when no backends are available", () => {
    expect(
      selectSecretBackend([
        createBackend("macOS Keychain", false),
        createBackend("Linux Secret Service", false),
      ]),
    ).toBeNull();
  });
});
