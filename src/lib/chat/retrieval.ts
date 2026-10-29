import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, toPgVector } from "@/lib/embeddings";
import type { Database } from "@/lib/supabase/database.types";

export type Excerpt = { fileName: string; content: string; similarity: number };

/**
 * What the client's documents say about the visitor's message.
 * - "no-documents": the client has no ready documents.
 * - "found": the most relevant excerpts (possibly none relevant enough).
 * - "unavailable": search failed; the assistant must not guess document facts.
 */
export type DocumentSearch =
  | { status: "no-documents" }
  | { status: "found"; excerpts: Excerpt[] }
  | { status: "unavailable" };

const MATCH_COUNT = 6;
const MIN_SIMILARITY = 0.3;

/**
 * Searches only the given client's documents. `query` should include the
 * previous visitor message too, so short follow-ups ("and for kids?") still
 * find the right passages.
 */
export async function searchClientDocuments(
  admin: SupabaseClient<Database>,
  clientId: string,
  query: string,
): Promise<DocumentSearch> {
  const { count, error: countError } = await admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "ready");
  if (countError) {
    console.error("Counting documents failed:", countError);
    return { status: "unavailable" };
  }
  if (!count) return { status: "no-documents" };

  try {
    const [vector] = await embed([query], "query");
    const { data, error } = await admin.rpc("match_document_chunks", {
      p_client_id: clientId,
      p_query_embedding: toPgVector(vector),
      p_match_count: MATCH_COUNT,
      p_min_similarity: MIN_SIMILARITY,
    });
    if (error) throw error;
    return {
      status: "found",
      excerpts: data.map((row) => ({ fileName: row.file_name, content: row.content, similarity: row.similarity })),
    };
  } catch (error) {
    console.error("Document search failed:", error);
    return { status: "unavailable" };
  }
}
