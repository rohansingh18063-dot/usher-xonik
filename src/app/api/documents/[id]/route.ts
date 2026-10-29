import { after } from "next/server";
import { z } from "zod";
import { getCurrentBusiness, getCurrentUser } from "@/lib/data";
import { BUCKET, contentType, DOCUMENT_COLUMNS, readUpload, storagePath, toClientDocument } from "@/lib/documents/manage";
import { processDocument } from "@/lib/documents/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/**
 * Replaces a document's file. The old file's knowledge is removed right away
 * and the new file is processed in the background.
 */
export async function PUT(request: Request, context: RouteContext<"/api/documents/[id]">) {
  const owned = await ownedDocument(context);
  if ("error" in owned) return owned.error;
  const { business, document } = owned;

  const upload = await readUpload(request);
  if ("error" in upload) return jsonError(upload.error, 400);

  const admin = createAdminClient();
  const revision = document.revision + 1;
  const path = storagePath(business.id, document.id, revision, upload.name);

  const stored = await admin.storage
    .from(BUCKET)
    .upload(path, upload.data, { contentType: contentType(upload.type), upsert: true });
  if (stored.error) {
    console.error("Replacement upload failed:", stored.error);
    return jsonError("We couldn't store this file. Please try again.", 500);
  }

  // Only succeeds if nobody replaced the document in the meantime.
  const { data: rows, error } = await admin
    .from("documents")
    .update({
      file_name: upload.name,
      file_type: upload.type,
      size_bytes: upload.size,
      storage_path: path,
      revision,
      status: "processing",
      error_message: null,
      chunk_count: 0,
      processed_at: null,
    })
    .eq("id", document.id)
    .eq("revision", document.revision)
    .select(DOCUMENT_COLUMNS);
  if (error || rows.length === 0) {
    await admin.storage.from(BUCKET).remove([path]);
    return jsonError("This document was changed at the same time. Please refresh and try again.", 409);
  }

  await admin.from("document_chunks").delete().eq("document_id", document.id).lt("revision", revision);
  if (document.storage_path !== path) await admin.storage.from(BUCKET).remove([document.storage_path]);

  after(() =>
    processDocument({
      documentId: document.id,
      clientId: business.id,
      revision,
      fileName: upload.name,
      fileType: upload.type,
      data: upload.data,
    }),
  );

  return Response.json({ document: toClientDocument(rows[0]) });
}

/** Deletes a document, its knowledge and its stored file. */
export async function DELETE(_request: Request, context: RouteContext<"/api/documents/[id]">) {
  const owned = await ownedDocument(context);
  if ("error" in owned) return owned.error;
  const { document } = owned;

  const admin = createAdminClient();
  // Chunks are removed with the row (on delete cascade).
  const { error } = await admin.from("documents").delete().eq("id", document.id);
  if (error) return jsonError("We couldn't delete this document. Please try again.", 500);

  const folder = document.storage_path.split("/").slice(0, 2).join("/");
  const { data: files } = await admin.storage.from(BUCKET).list(folder);
  const paths = [document.storage_path, ...(files ?? []).map((file) => `${folder}/${file.name}`)];
  await admin.storage.from(BUCKET).remove([...new Set(paths)]);

  return new Response(null, { status: 204 });
}

/** The document, if it exists and belongs to the signed-in client. */
async function ownedDocument(context: RouteContext<"/api/documents/[id]">) {
  if (!(await getCurrentUser())) return { error: jsonError("Please sign in again.", 401) };
  const business = await getCurrentBusiness();
  if (!business) return { error: jsonError("Please sign in again.", 401) };

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return { error: jsonError("Document not found.", 404) };

  // Row Level Security only returns the document if it belongs to this client.
  const supabase = await createClient();
  const { data: document } = await supabase
    .from("documents")
    .select("id, revision, storage_path")
    .eq("id", id)
    .eq("client_id", business.id)
    .maybeSingle();
  if (!document) return { error: jsonError("Document not found.", 404) };

  return { business, document };
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
