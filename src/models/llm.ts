import OpenAI from "openai";
import type { Config } from "../config/index.js";

let client: OpenAI | null = null;
let configuredModel: string = "";

function getClient(config: Config): OpenAI {
  if (client && configuredModel === config.llm.model) {
    return client;
  }
  client = new OpenAI({
    baseURL: config.llm.baseURL,
    apiKey: config.llm.apiKey,
  });
  configuredModel = config.llm.model;
  return client;
}

/**
 * Send a chat completion request to the configured LLM.
 */
export async function chatCompletion(
  config: Config,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" };
  },
): Promise<string> {
  const oai = getClient(config);
  const response = await oai.chat.completions.create({
    model: config.llm.model,
    messages,
    temperature: options?.temperature ?? 0.1,
    max_tokens: options?.maxTokens ?? 2048,
    ...(options?.responseFormat && {
      response_format: options.responseFormat,
    }),
  });
  return response.choices[0]?.message?.content ?? "";
}
