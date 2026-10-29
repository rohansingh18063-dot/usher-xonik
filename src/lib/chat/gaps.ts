import "server-only";
import { embed, toPgVector } from "@/lib/embeddings";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { GapCategory } from "./hidden-tags";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Records questions the assistant could not answer from the client's data.
 * Each topic is embedded so the database can add it to the most similar
 * existing gap; without embeddings, gaps are grouped by identical topic.
 */
export async function recordKnowledgeGaps(
  admin: Admin,
  clientId: string,
  sessionId: string,
  question: string,
  gaps: { category: GapCategory; topic: string }[],
) {
  let vectors: (number[] | null)[] = gaps.map(() => null);
  try {
    vectors = await embed(
      gaps.map((gap) => `${gap.category}: ${gap.topic}`),
      "query",
    );
  } catch (error) {
    console.error("Embedding knowledge gaps failed; grouping by topic only:", error);
  }

  for (const [index, gap] of gaps.entries()) {
    const vector = vectors[index];
    const { error } = await admin.rpc("record_knowledge_gap", {
      p_client_id: clientId,
      p_category: gap.category,
      p_topic: gap.topic,
      p_question: question,
      p_session_id: sessionId,
      p_embedding: vector ? toPgVector(vector) : null,
    });
    if (error) console.error("Recording a knowledge gap failed:", error);
  }
}
