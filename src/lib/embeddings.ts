import "server-only";

/**
 * Text embeddings for document search. The provider, model and API key come
 * from environment variables so they can be changed without code changes.
 *
 * The vector size must match the document_chunks.embedding column. Switching
 * to a model with a different size needs a migration, and every document must
 * be processed again (originals are kept in storage for that).
 */
export const EMBEDDING_DIMENSIONS = 1024;

export type EmbeddingPurpose = "document" | "query";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function embeddingSettings() {
  return {
    provider: process.env.EMBEDDING_PROVIDER?.trim() || "voyage",
    model: process.env.EMBEDDING_MODEL?.trim() || "voyage-4",
    apiKey: process.env.EMBEDDING_API_KEY?.trim() ?? "",
  };
}

/** Embeds texts in order; returns one vector per text. */
export async function embed(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]> {
  const settings = embeddingSettings();
  if (!settings.apiKey) throw new EmbeddingError("EMBEDDING_API_KEY is not set.");

  switch (settings.provider) {
    case "voyage":
      return voyageEmbed(texts, purpose, settings.model, settings.apiKey);
    default:
      throw new EmbeddingError(`Unsupported embedding provider "${settings.provider}".`);
  }
}

/** Formats a vector the way pgvector expects it. */
export function toPgVector(vector: number[]) {
  return `[${vector.join(",")}]`;
}

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_BATCH_SIZE = 64;
const MAX_ATTEMPTS = 4;

type VoyageResponse = { data: { embedding: number[]; index: number }[] };

async function voyageEmbed(texts: string[], purpose: EmbeddingPurpose, model: string, apiKey: string) {
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += VOYAGE_BATCH_SIZE) {
    const batch = texts.slice(start, start + VOYAGE_BATCH_SIZE);
    const body = JSON.stringify({ input: batch, model, input_type: purpose, output_dimension: EMBEDDING_DIMENSIONS });

    let response: Response | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      response = await fetch(VOYAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(60_000),
      }).catch(() => undefined);

      const retryable = !response || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }

    if (!response) throw new EmbeddingError("Could not reach the embedding service.");
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new EmbeddingError(`Embedding request failed with status ${response.status}. ${detail}`);
    }

    const { data } = (await response.json()) as VoyageResponse;
    const ordered = [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (ordered.length !== batch.length || ordered.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
      throw new EmbeddingError("The embedding service returned an unexpected response.");
    }
    vectors.push(...ordered);
  }

  return vectors;
}
