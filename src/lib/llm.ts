import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type RuntimeConfig, getActiveModel, OPENROUTER_BASE_URL } from "./runtime-config";

type CreateRuntimeModelOptions = {
  origin: string;
};

function createTimeoutFetch(timeoutMs: number) {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(url, { ...init, signal });
  }) as typeof fetch;
}

export function createRuntimeModel(
  runtimeConfig: RuntimeConfig,
  options: CreateRuntimeModelOptions,
) {
  const activeModel = getActiveModel(runtimeConfig);

  if (runtimeConfig.llm.provider === "openrouter") {
    const apiKey = process.env.OPEN_ROUTER_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenRouter is selected, but OPEN_ROUTER_KEY is missing. Start the app with dotenvx and .env.tianjin.",
      );
    }

    const provider = createOpenAICompatible({
      baseURL: OPENROUTER_BASE_URL,
      name: "openrouter",
      apiKey,
      headers: {
        "HTTP-Referer": options.origin,
        "X-Title": "Private Ethereum Assistant",
      },
      fetch: createTimeoutFetch(runtimeConfig.llm.timeoutMs),
    });

    return provider.chatModel(activeModel);
  }

  const provider = createOpenAICompatible({
    baseURL: runtimeConfig.llm.localBaseUrl,
    name: "local",
    fetch: createTimeoutFetch(runtimeConfig.llm.timeoutMs),
  });

  return provider.chatModel(activeModel);
}
