import { describe, expect, test } from "bun:test";
import {
  applyLegacyRuntimeConfigDefaults,
  createDefaultRuntimeConfig,
  createDeveloperRuntimeConfig,
  createRuntimeConfigDraft,
  getActiveModel,
  parseRuntimeConfigDraft,
  stripRuntimeConfigSecrets,
} from "./runtime-config";

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

  test("developer mode reuses the EOA key as the Safe signer key", () => {
    const originalEoaPrivateKey = process.env.EOA_PRIVATE_KEY;

    process.env.EOA_PRIVATE_KEY =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    try {
      const runtimeConfig = createDeveloperRuntimeConfig();

      expect(runtimeConfig.wallet.eoaPrivateKey).toBe(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      expect(runtimeConfig.safe.signerPrivateKey).toBe(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
    } finally {
      if (originalEoaPrivateKey === undefined) {
        delete process.env.EOA_PRIVATE_KEY;
      } else {
        process.env.EOA_PRIVATE_KEY = originalEoaPrivateKey;
      }
    }
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
