"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { ClientDocument } from "@/lib/documents/manage";
import { ACCEPT_ATTRIBUTE, checkFile, FILE_TYPES, formatFileSize, MAX_DOCUMENTS_PER_CLIENT } from "@/lib/documents/limits";
import { Alert, Button, Card } from "@/components/ui";

type Upload = { key: string; name: string; progress: number; replacing?: string };

const POLL_INTERVAL_MS = 2500;

export function DocumentsManager({ initialDocuments }: { initialDocuments: ClientDocument[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const replacePicker = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/documents", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json()) as { documents: ClientDocument[] };
    setDocuments(body.documents);
  }, []);

  // Keep statuses up to date while anything is still processing.
  const processing = documents.some((document) => document.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [processing, refresh]);

  function upload(file: File, replacing?: string) {
    setError(null);
    const problem = checkFile(file);
    if (problem) {
      setError(`${file.name}: ${problem}`);
      return;
    }
    if (!replacing && documents.length + uploads.length >= MAX_DOCUMENTS_PER_CLIENT) {
      setError(`You can upload up to ${MAX_DOCUMENTS_PER_CLIENT} documents. Delete one to add another.`);
      return;
    }

    const key = crypto.randomUUID();
    setUploads((current) => [...current, { key, name: file.name, progress: 0, replacing }]);

    // XMLHttpRequest reports upload progress, which fetch cannot.
    const request = new XMLHttpRequest();
    request.open(replacing ? "PUT" : "POST", replacing ? `/api/documents/${replacing}` : "/api/documents");
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setUploads((current) => current.map((item) => (item.key === key ? { ...item, progress } : item)));
    };
    request.onload = () => {
      setUploads((current) => current.filter((item) => item.key !== key));
      let body: { document?: ClientDocument; error?: string } = {};
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // Not JSON; handled below.
      }
      if (request.status >= 200 && request.status < 300 && body.document) {
        const saved = body.document;
        setDocuments((current) =>
          replacing ? current.map((item) => (item.id === replacing ? saved : item)) : [saved, ...current],
        );
      } else {
        setError(`${file.name}: ${body.error ?? "The upload failed. Please try again."}`);
      }
    };
    request.onerror = () => {
      setUploads((current) => current.filter((item) => item.key !== key));
      setError(`${file.name}: The upload failed. Please check your connection and try again.`);
    };
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  }

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    const response = await fetch(`/api/documents/${id}`, { method: "DELETE" }).catch(() => null);
    setDeleting(null);
    setConfirmingDelete(null);
    if (response?.ok) {
      setDocuments((current) => current.filter((document) => document.id !== id));
    } else {
      setError("We couldn't delete this document. Please try again.");
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    Array.from(event.dataTransfer.files).forEach((file) => upload(file));
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-white"
        }`}
      >
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
            <path d="M12 16V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-slate-900">Drag and drop files here</p>
        <p className="mt-1 text-sm text-slate-500">PDF, Word (.docx) or text files, up to 10 MB each</p>
        <Button type="button" className="mt-5" onClick={() => picker.current?.click()}>
          Choose files
        </Button>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          multiple
          className="sr-only"
          aria-label="Upload documents"
          data-testid="upload-input"
          onChange={(event) => {
            Array.from(event.target.files ?? []).forEach((file) => upload(file));
            event.target.value = "";
          }}
        />
        <input
          ref={replacePicker}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="replace-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && replaceTarget.current) upload(file, replaceTarget.current);
            replaceTarget.current = null;
            event.target.value = "";
          }}
        />
      </div>

      {error && <Alert>{error}</Alert>}

      <Card>
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Your documents</h2>
        </div>

        {documents.length === 0 && uploads.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No documents yet. Until you upload some, your assistant answers from your Business Info and general dental
            knowledge.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {uploads
              .filter((item) => !item.replacing)
              .map((item) => (
                <li key={item.key} className="px-6 py-4">
                  <UploadProgress name={item.name} progress={item.progress} />
                </li>
              ))}
            {documents.map((document) => {
              const replacement = uploads.find((item) => item.replacing === document.id);
              return (
                <li key={document.id} className="px-6 py-4" data-testid="document-row">
                  {replacement ? (
                    <UploadProgress name={replacement.name} progress={replacement.progress} replacing />
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <FileBadge type={FILE_TYPES[document.fileType].label} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900" data-testid="document-name">
                            {document.fileName}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatFileSize(document.sizeBytes)} · Uploaded <LocalDate value={document.uploadedAt} />
                          </p>
                          {document.status === "failed" && document.errorMessage && (
                            <p className="mt-1.5 text-sm text-red-700" data-testid="document-error">
                              {document.errorMessage}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={document.status} />
                        {confirmingDelete === document.id ? (
                          <>
                            <Button
                              type="button"
                              className="bg-red-600 px-3 py-1.5 hover:bg-red-700"
                              pending={deleting === document.id}
                              onClick={() => remove(document.id)}
                            >
                              Delete
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="px-3 py-1.5"
                              onClick={() => setConfirmingDelete(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              className="px-3 py-1.5"
                              aria-label={`Replace ${document.fileName}`}
                              onClick={() => {
                                replaceTarget.current = document.id;
                                replacePicker.current?.click();
                              }}
                            >
                              Replace
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="px-3 py-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                              aria-label={`Delete ${document.fileName}`}
                              onClick={() => setConfirmingDelete(document.id)}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UploadProgress({ name, progress, replacing }: { name: string; progress: number; replacing?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="truncate font-medium text-slate-900">{name}</span>
        <span className="shrink-0 text-slate-500">
          {replacing ? "Replacing" : "Uploading"} {progress}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ClientDocument["status"] }) {
  const styles = {
    processing: "bg-amber-50 text-amber-800 ring-amber-200",
    ready: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    failed: "bg-red-50 text-red-800 ring-red-200",
  };
  const labels = { processing: "Processing", ready: "Ready", failed: "Failed" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
      data-testid="document-status"
    >
      {status === "processing" && <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />}
      {labels[status]}
    </span>
  );
}

function FileBadge({ type }: { type: string }) {
  return (
    <span className="flex h-10 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
      {type === "Word" ? "DOC" : type === "Text" ? "TXT" : type}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function LocalDate({ value }: { value: string }) {
  // Formatted in the viewer's time zone, which can differ from the server's.
  return (
    <time dateTime={value} suppressHydrationWarning>
      {dateFormat.format(new Date(value))}
    </time>
  );
}
