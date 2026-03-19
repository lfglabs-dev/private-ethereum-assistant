import { describe, expect, mock, test } from "bun:test";
import {
  applyLegacyRuntimeConfigDefaults,
  createDefaultRuntimeConfig,
  createRuntimeConfigDraft,
  getActiveModel,
  parseRuntimeConfigDraft,
  stripRuntimeConfigSecrets,
  validateRuntimeConfigDraftForAppMode,
} from "./runtime-config";
import { createDeveloperRuntimeConfig } from "./env-secrets";

const mockGetSecret = mock();

mock.module("./secret-store", () => ({
  getSecret: mockGetSecret,
  hasSecret: async (key: string) => {
    const value = await mockGetSecret(key);
    return value !== null && value !== undefined && value.trim().length > 0;
  },
  invalidateSecretCache: () => {},
  getSecretBackend: () => null,
  SECRET_STORE_KEYS: ["EOA_PRIVATE_KEY", "SAFE_SIGNER_PRIVATE_KEY", "SAFE_API_KEY"],
}));

describe("runtime-config helpers", () => {
  test("keeps onboarding defaults unvalidated until save time", () => {
    const defaults = createDefaultRuntimeConfig();

    expect(defaults.llm.provider).toBe("openrouter");
    expect(defaults.wallet.eoaPrivateKey).toBe("");
    expect(defaults.safe.signerPrivateKey).toBe("");
    expect(defaults.actor.type).toBe("eoa");
  });

  test("parses and normalizes a draft into a validated runtime config", () => {
    const draft = createRuntimeConfigDraft(createDefaultRuntimeConfig());
    draft.llm.provider = "openrouter";
    draft.llm.openRouterModel = "qwen/qwen3.5-27b";

    const runtimeConfig = parseRuntimeConfigDraft(draft);

    expect(runtimeConfig.wallet.eoaPrivateKey).toBe("");
    expect(runtimeConfig.safe.signerPrivateKey).toBe("");
    expect(runtimeConfig.railgun.poiNodeUrls.length).toBeGreaterThan(0);
    expect(runtimeConfig.railgun.shieldApprovalThreshold).toBe("1");
    expect(runtimeConfig.railgun.transferApprovalThreshold).toBe("1");
    expect(runtimeConfig.railgun.unshieldApprovalThreshold).toBe("1");
    expect(runtimeConfig.railgun.privacyGuidanceText.length).toBeGreaterThan(0);
    expect(runtimeConfig.actor.type).toBe("eoa");
    expect(getActiveModel(runtimeConfig)).toBe("qwen/qwen3.5-27b");
  });

  test("standard mode requires an explicit Railgun mnemonic", () => {
    const draft = createRuntimeConfigDraft(createDefaultRuntimeConfig());
    draft.railgun.mnemonic = "";

    expect(() => validateRuntimeConfigDraftForAppMode(draft, "standard")).toThrow(
      "Generate or import a Railgun mnemonic before continuing. If you lose it, you can lose access to shielded Railgun funds.",
    );
  });

  test("developer mode ignores any Railgun mnemonic draft value", () => {
    const draft = createRuntimeConfigDraft(createDefaultRuntimeConfig());
    draft.railgun.mnemonic = "test test test test test test test test test test test junk";

    const runtimeConfig = validateRuntimeConfigDraftForAppMode(draft, "developer");

    expect(runtimeConfig.railgun.mnemonic).toBe("");
  });

  test("preserves provider-specific models when switching", () => {
    const draft = createRuntimeConfigDraft(createDefaultRuntimeConfig());
    draft.llm.localModel = "qwen3:8b";
    draft.llm.openRouterModel = "qwen/qwen3.5-27b";

    const openRouterConfig = parseRuntimeConfigDraft({
      ...draft,
      llm: {
        ...draft.llm,
        provider: "openrouter",
      },
    });
    const localConfig = parseRuntimeConfigDraft({
      ...draft,
      llm: {
        ...draft.llm,
        provider: "local",
      },
    });

    expect(getActiveModel(openRouterConfig)).toBe("qwen/qwen3.5-27b");
    expect(getActiveModel(localConfig)).toBe("qwen3:8b");
  });

  test("developer mode reuses the EOA key as the Safe signer key", async () => {
    mockGetSecret.mockImplementation(async (key: string) => {
      if (key === "EOA_PRIVATE_KEY") {
        return "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      }
      return null;
    });

    const runtimeConfig = await createDeveloperRuntimeConfig();

    expect(runtimeConfig.wallet.eoaPrivateKey).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(runtimeConfig.safe.signerPrivateKey).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(runtimeConfig.railgun.mnemonic).toBe("");

    mockGetSecret.mockReset();
  });

  test("fills legacy Railgun privacy guidance defaults for stored configs", () => {
    const runtimeConfig = createDefaultRuntimeConfig();
    const legacyConfig = {
      ...runtimeConfig,
      railgun: {
        ...runtimeConfig.railgun,
      },
    } as Record<string, unknown>;

    delete (legacyConfig.railgun as Record<string, unknown>).privacyGuidanceText;

    const normalized = applyLegacyRuntimeConfigDefaults(legacyConfig) as typeof runtimeConfig;
    expect(normalized.railgun.privacyGuidanceText).toBe(
      runtimeConfig.railgun.privacyGuidanceText,
    );
    expect(normalized.actor.type).toBe("eoa");
  });

  test("strips secret fields before browser persistence", () => {
    const runtimeConfig = {
      ...createDefaultRuntimeConfig(),
      wallet: {
        ...createDefaultRuntimeConfig().wallet,
        eoaPrivateKey:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      safe: {
        ...createDefaultRuntimeConfig().safe,
        signerPrivateKey:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    };
    const stripped = stripRuntimeConfigSecrets(runtimeConfig);

    expect(stripped.wallet.eoaPrivateKey).toBe("");
    expect(stripped.safe.signerPrivateKey).toBe("");
    expect(stripped.wallet.approvalPolicy).toEqual(runtimeConfig.wallet.approvalPolicy);
  });
});
