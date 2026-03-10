import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config } from "./config";

const llm = createOpenAICompatible({
  baseURL: config.llm.baseURL,
  name: "ollama",
  fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
    const timeout = AbortSignal.timeout(config.llm.timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    return fetch(url, { ...init, signal });
  }) as typeof fetch,
});

export const model = llm.chatModel(config.llm.model);
