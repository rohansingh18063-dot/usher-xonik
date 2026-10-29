import "server-only";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { DocumentFileType } from "@/lib/supabase/database.types";

/** A processing failure with a message that can be shown to the client. */
export class DocumentProcessingError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "DocumentProcessingError";
    this.userMessage = userMessage;
  }
}

const NO_TEXT =
  "We couldn't find any text in this file. If it is a scanned document or a photo, please upload a text-based PDF, a Word document or a text file instead.";

/** Extracts the plain text of an uploaded file. */
export async function extractDocumentText(data: Uint8Array, type: DocumentFileType): Promise<string> {
  const raw = type === "pdf" ? await fromPdf(data) : type === "docx" ? await fromDocx(data) : fromTxt(data);
  const text = normalize(raw);
  if (text.replace(/\s/g, "").length < 20) throw new DocumentProcessingError(NO_TEXT);
  return text;
}

async function fromPdf(data: Uint8Array) {
  if (!startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new DocumentProcessingError("This file is not a valid PDF.");
  }
  try {
    // pdf.js takes ownership of the buffer it is given, so pass a copy.
    const pdf = await getDocumentProxy(data.slice());
    const { text } = await extractPdfText(pdf, { mergePages: false });
    return text.join("\n\n");
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new DocumentProcessingError("This PDF is password-protected. Please upload a version without a password.");
    }
    throw new DocumentProcessingError("This PDF could not be read. It may be damaged; please try exporting it again.");
  }
}

async function fromDocx(data: Uint8Array) {
  if (!startsWith(data, [0x50, 0x4b, 0x03, 0x04])) {
    throw new DocumentProcessingError("This file is not a valid Word (.docx) document.");
  }
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return value;
  } catch {
    throw new DocumentProcessingError(
      "This Word document could not be read. Please save it again as .docx, or upload it as a PDF.",
    );
  }
}

function fromTxt(data: Uint8Array) {
  if (startsWith(data, [0xff, 0xfe]) || startsWith(data, [0xfe, 0xff])) {
    return new TextDecoder(data[0] === 0xff ? "utf-16le" : "utf-16be").decode(data);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (text.includes("\u0000")) throw new Error("binary");
    return text;
  } catch {
    throw new DocumentProcessingError("This file does not look like a plain text file. Please save it as UTF-8 text.");
  }
}

function normalize(text: string) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function startsWith(data: Uint8Array, bytes: number[]) {
  return bytes.every((byte, index) => data[index] === byte);
}
