import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { config } from "./config";

const llm = createOpenAICompatible({
  baseURL: config.llm.baseURL,
  name: "ollama",
});

export const model = llm.chatModel(config.llm.model);
