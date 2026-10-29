import "server-only";
import { embed, embeddingSettings, EmbeddingError, toPgVector } from "@/lib/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DocumentFileType } from "@/lib/supabase/database.types";
import { chunkText } from "./chunk";
import { DocumentProcessingError, extractDocumentText } from "./extract";

const MAX_CHUNKS = 800;
const INSERT_BATCH_SIZE = 50;

export type ProcessJob = {
  documentId: string;
  clientId: string;
  revision: number;
  fileName: string;
  fileType: DocumentFileType;
  data: Uint8Array;
};

/**
 * Turns an uploaded file into searchable chunks and marks the document ready,
 * or failed with a message the client can act on. Runs after the upload
 * response has been sent.
 *
 * Every write is tied to the document's revision: if the file is replaced or
 * deleted while this runs, the outdated result is thrown away.
 */
export async function processDocument(job: ProcessJob) {
  const admin = createAdminClient();
  const { model } = embeddingSettings();

  try {
    const text = await extractDocumentText(job.data, job.fileType);
    const chunks = chunkText(text);
    if (chunks.length > MAX_CHUNKS) {
      throw new DocumentProcessingError(
        "This document is too long. Please split it into smaller files (up to about 300 pages of text each).",
      );
    }

    // The file name gives each piece context, e.g. "price-list.pdf".
    const vectors = await embed(
      chunks.map((chunk) => `${job.fileName}\n\n${chunk}`),
      "document",
    );

    for (let start = 0; start < chunks.length; start += INSERT_BATCH_SIZE) {
      const rows = chunks.slice(start, start + INSERT_BATCH_SIZE).map((content, offset) => ({
        client_id: job.clientId,
        document_id: job.documentId,
        revision: job.revision,
        chunk_index: start + offset,
        content,
        embedding: toPgVector(vectors[start + offset]),
        embedding_model: model,
      }));
      const { error } = await admin.from("document_chunks").insert(rows);
      if (error) throw new Error(`Could not save document chunks: ${error.message}`);
    }

    const { data: updated, error } = await admin
      .from("documents")
      .update({ status: "ready", chunk_count: chunks.length, error_message: null, processed_at: new Date().toISOString() })
      .eq("id", job.documentId)
      .eq("revision", job.revision)
      .select("id");
    if (error) throw new Error(`Could not update the document: ${error.message}`);

    if (updated.length === 0) {
      // Replaced or deleted while processing: discard this run's chunks.
      await deleteChunks(job.documentId, job.revision);
    } else {
      // Remove anything left over from earlier revisions.
      await admin.from("document_chunks").delete().eq("document_id", job.documentId).neq("revision", job.revision);
    }
  } catch (error) {
    console.error(`Processing document ${job.documentId} failed:`, error);
    await deleteChunks(job.documentId, job.revision);
    await admin
      .from("documents")
      .update({ status: "failed", chunk_count: 0, error_message: userMessage(error), processed_at: new Date().toISOString() })
      .eq("id", job.documentId)
      .eq("revision", job.revision);
  }
}

async function deleteChunks(documentId: string, revision: number) {
  await createAdminClient().from("document_chunks").delete().eq("document_id", documentId).eq("revision", revision);
}

function userMessage(error: unknown) {
  if (error instanceof DocumentProcessingError) return error.userMessage;
  if (error instanceof EmbeddingError) {
    return "We couldn't index this document right now. Please try again in a few minutes by replacing the file.";
  }
  return "Something went wrong while processing this document. Please try again by replacing the file.";
}
