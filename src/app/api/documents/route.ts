import { after } from "next/server";
import { getCurrentBusiness, getCurrentUser } from "@/lib/data";
import { MAX_DOCUMENTS_PER_CLIENT } from "@/lib/documents/limits";
import {
  BUCKET,
  contentType,
  DOCUMENT_COLUMNS,
  readUpload,
  storagePath,
  toClientDocument,
} from "@/lib/documents/manage";
import { processDocument } from "@/lib/documents/process";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Leaves room for processing to finish after the response is sent.
export const maxDuration = 300;

/** Lists the signed-in client's documents. */
export async function GET() {
  const business = await currentBusiness();
  if (!business) return jsonError("Please sign in again.", 401);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("client_id", business.id)
    .order("created_at", { ascending: false });
  if (error) return jsonError("Could not load your documents.", 500);

  return Response.json({ documents: data.map(toClientDocument) }, { headers: { "Cache-Control": "no-store" } });
}

/** Uploads a new document; processing continues in the background. */
export async function POST(request: Request) {
  const business = await currentBusiness();
  if (!business) return jsonError("Please sign in again.", 401);

  const upload = await readUpload(request);
  if ("error" in upload) return jsonError(upload.error, 400);

  const admin = createAdminClient();
  const { count } = await admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("client_id", business.id);
  if ((count ?? 0) >= MAX_DOCUMENTS_PER_CLIENT) {
    return jsonError(`You can upload up to ${MAX_DOCUMENTS_PER_CLIENT} documents. Delete one to add another.`, 400);
  }

  const documentId = crypto.randomUUID();
  const path = storagePath(business.id, documentId, 1, upload.name);

  const stored = await admin.storage
    .from(BUCKET)
    .upload(path, upload.data, { contentType: contentType(upload.type), upsert: false });
  if (stored.error) {
    console.error("Document upload failed:", stored.error);
    return jsonError("We couldn't store this file. Please try again.", 500);
  }

  const { data: row, error } = await admin
    .from("documents")
    .insert({
      id: documentId,
      client_id: business.id,
      file_name: upload.name,
      file_type: upload.type,
      size_bytes: upload.size,
      storage_path: path,
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error) {
    await admin.storage.from(BUCKET).remove([path]);
    console.error("Saving the document failed:", error);
    return jsonError("We couldn't save this document. Please try again.", 500);
  }

  after(() =>
    processDocument({
      documentId,
      clientId: business.id,
      revision: 1,
      fileName: upload.name,
      fileType: upload.type,
      data: upload.data,
    }),
  );

  return Response.json({ document: toClientDocument(row) }, { status: 201 });
}

async function currentBusiness() {
  if (!(await getCurrentUser())) return null;
  return getCurrentBusiness();
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
