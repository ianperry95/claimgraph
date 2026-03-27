import OpenAI from "openai";
import type { Config } from "../config/index.js";

let client: OpenAI | null = null;
let configuredModel: string = "";

function getClient(config: Config): OpenAI {
  if (
    client &&
    configuredModel === config.embedding.model
  ) {
    return client;
  }
  client = new OpenAI({
    baseURL: config.embedding.baseURL,
    apiKey: config.embedding.apiKey,
  });
  configuredModel = config.embedding.model;
  return client;
}

/**
 * Generate an embedding vector for the given text.
 */
export async function embed(
  config: Config,
  text: string,
): Promise<number[]> {
  const oai = getClient(config);
  const response = await oai.embeddings.create({
    model: config.embedding.model,
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single batch.
 */
export async function embedBatch(
  config: Config,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const oai = getClient(config);
  const response = await oai.embeddings.create({
    model: config.embedding.model,
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
