import type { DocumentFileType } from "@/lib/supabase/database.types";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_CLIENT = 50;

/** A document still "processing" after this long is treated as failed. */
export const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

export const FILE_TYPES: Record<DocumentFileType, { label: string; mimeType: string }> = {
  pdf: { label: "PDF", mimeType: "application/pdf" },
  docx: { label: "Word", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  txt: { label: "Text", mimeType: "text/plain" },
};

export const ACCEPT_ATTRIBUTE = ".pdf,.docx,.txt";

export function fileTypeFromName(name: string): DocumentFileType | null {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "pdf" || extension === "docx" || extension === "txt" ? extension : null;
}

/** Checks a file before upload; returns an error message or null. */
export function checkFile(file: { name: string; size: number }): string | null {
  if (!fileTypeFromName(file.name)) return "Only PDF, Word (.docx) and text (.txt) files are supported.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_FILE_BYTES) return "This file is larger than 10 MB. Please upload a smaller file.";
  return null;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
