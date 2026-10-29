import "server-only";
import type { Database, DocumentFileType, DocumentStatus } from "@/lib/supabase/database.types";
import { checkFile, FILE_TYPES, fileTypeFromName, PROCESSING_TIMEOUT_MS } from "./limits";

export const BUCKET = "documents";

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

/** What the browser is told about a document. */
export type ClientDocument = {
  id: string;
  fileName: string;
  fileType: DocumentFileType;
  sizeBytes: number;
  status: DocumentStatus;
  errorMessage: string | null;
  uploadedAt: string;
  updatedAt: string;
};

export const DOCUMENT_COLUMNS = "id, file_name, file_type, size_bytes, status, error_message, created_at, updated_at";

export function toClientDocument(
  row: Pick<DocumentRow, "id" | "file_name" | "file_type" | "size_bytes" | "status" | "error_message" | "created_at" | "updated_at">,
): ClientDocument {
  // A run that never finished (for example the server restarted) is shown as
  // failed, so the client knows to try again.
  const stale = row.status === "processing" && Date.now() - Date.parse(row.updated_at) > PROCESSING_TIMEOUT_MS;
  return {
    id: row.id,
    fileName: row.file_name,
    fileType: row.file_type,
    sizeBytes: row.size_bytes,
    status: stale ? "failed" : row.status,
    errorMessage: stale ? "Processing did not finish. Please replace the file to try again." : row.error_message,
    uploadedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ValidUpload = { name: string; type: DocumentFileType; size: number; data: Uint8Array };

/** Reads and checks the "file" field of an upload form. */
export async function readUpload(request: Request): Promise<ValidUpload | { error: string }> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return { error: "Please choose a file to upload." };

  const problem = checkFile(file);
  if (problem) return { error: problem };

  const name = file.name.trim().slice(-255) || "document";
  return { name, type: fileTypeFromName(name)!, size: file.size, data: new Uint8Array(await file.arrayBuffer()) };
}

/** <client id>/<document id>/<revision>-<safe file name> */
export function storagePath(clientId: string, documentId: string, revision: number, fileName: string) {
  const safe =
    fileName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+/, "")
      .slice(-100) || "document";
  return `${clientId}/${documentId}/${revision}-${safe}`;
}

export function contentType(type: DocumentFileType) {
  return FILE_TYPES[type].mimeType;
}
