import { describe, expect, test } from "bun:test";
import {
  createDefaultRuntimeConfig,
  createRuntimeConfigDraft,
  getActiveModel,
  parseRuntimeConfigDraft,
} from "./runtime-config";

describe("runtime-config helpers", () => {
  test("keeps onboarding defaults unvalidated until save time", () => {
    const defaults = createDefaultRuntimeConfig();

    expect(defaults.llm.provider).toBe("openrouter");
    expect(defaults.wallet.eoaPrivateKey).toBe("");
    expect(defaults.safe.signerPrivateKey).toBe("");
  });

  test("parses and normalizes a draft into a validated runtime config", () => {
    const draft = createRuntimeConfigDraft(createDefaultRuntimeConfig());
    draft.wallet.eoaPrivateKey =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    draft.safe.signerPrivateKey =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    draft.llm.provider = "openrouter";
    draft.llm.openRouterModel = "qwen/qwen3.5-27b";

    const runtimeConfig = parseRuntimeConfigDraft(draft);

    expect(runtimeConfig.wallet.eoaPrivateKey).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(runtimeConfig.safe.signerPrivateKey).toBe(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(runtimeConfig.railgun.poiNodeUrls.length).toBeGreaterThan(0);
    expect(getActiveModel(runtimeConfig)).toBe("qwen/qwen3.5-27b");
  });

  test("preserves provider-specific models when switching", () => {
    const draft = createRuntimeConfigDraft(createDefaultRuntimeConfig());
    draft.wallet.eoaPrivateKey =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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
});

