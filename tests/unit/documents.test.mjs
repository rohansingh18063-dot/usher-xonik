// Tests for document text extraction and chunking, using real PDF, Word and
// text files generated on the fly.
//
// Run with: npm run test:unit

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import JSZip from "jszip";
import { chunkText } from "../../src/lib/documents/chunk.ts";
import { DocumentProcessingError, extractDocumentText } from "../../src/lib/documents/extract.ts";

let browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

async function pdfFromHtml(html) {
  const page = await browser.newPage();
  await page.setContent(html);
  const pdf = await page.pdf({ format: "A4" });
  await page.close();
  return new Uint8Array(pdf);
}

async function docxFromParagraphs(paragraphs) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function rejectsWith(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DocumentProcessingError, `expected a DocumentProcessingError, got ${error}`);
    assert.match(error.userMessage, pattern);
    return true;
  });
}

describe("text extraction", () => {
  test("reads text from a PDF, including a fee table", async () => {
    const pdf = await pdfFromHtml(`
      <h1>Smile Care Dental Clinic</h1>
      <p>Opening hours: Monday to Saturday, 10:00 AM to 7:00 PM.</p>
      <table><tr><td>Teeth cleaning</td><td>₹800</td></tr><tr><td>Root canal treatment</td><td>₹4,500</td></tr></table>`);
    const text = await extractDocumentText(pdf, "pdf");
    assert.match(text, /Smile Care Dental Clinic/);
    assert.match(text, /10:00 AM to 7:00 PM/);
    assert.match(text, /Teeth cleaning/);
    assert.match(text, /₹800/);
    assert.match(text, /₹4,500/);
  });

  test("explains that a PDF without text (a scan) cannot be used", async () => {
    const pdf = await pdfFromHtml(`<svg width="400" height="300"><rect width="400" height="300" fill="#ccc"/></svg>`);
    await rejectsWith(extractDocumentText(pdf, "pdf"), /scanned document/);
  });

  test("rejects a file that only claims to be a PDF", async () => {
    await rejectsWith(extractDocumentText(new TextEncoder().encode("not really a pdf file"), "pdf"), /not a valid PDF/);
  });

  test("reads text from a Word document", async () => {
    const docx = await docxFromParagraphs(["Clinic policies", "Please arrive 10 minutes before your appointment."]);
    const text = await extractDocumentText(docx, "docx");
    assert.match(text, /Clinic policies/);
    assert.match(text, /arrive 10 minutes before/);
  });

  test("rejects a damaged Word document", async () => {
    await rejectsWith(extractDocumentText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "docx"), /could not be read/);
  });

  test("reads UTF-8 and UTF-16 text files, including Hindi", async () => {
    const utf8 = await extractDocumentText(new TextEncoder().encode("﻿Fees list\r\nScaling: ₹800\r\nदांतों की सफाई"), "txt");
    assert.equal(utf8, "Fees list\nScaling: ₹800\nदांतों की सफाई");

    const text = "Opening hours: 9 AM to 5 PM";
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) utf16[2 + i * 2] = text.charCodeAt(i);
    assert.equal(await extractDocumentText(utf16, "txt"), text);
  });

  test("rejects binary data posing as text", async () => {
    await rejectsWith(extractDocumentText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff]), "txt"), /plain text/);
  });

  test("rejects an empty text file", async () => {
    await rejectsWith(extractDocumentText(new TextEncoder().encode("  \n  "), "txt"), /couldn't find any text/);
  });
});

describe("chunking", () => {
  test("keeps a short document in one chunk", () => {
    assert.deepEqual(chunkText("Fees\n\nCleaning: ₹800"), ["Fees\n\nCleaning: ₹800"]);
  });

  test("splits long documents into overlapping chunks within the size limit", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ${"The clinic explains its policies clearly. ".repeat(4)}`);
    const chunks = chunkText(paragraphs.join("\n\n"), { targetSize: 1000, maxSize: 1600, overlap: 200 });

    assert.ok(chunks.length > 5);
    for (const chunk of chunks) assert.ok(chunk.length <= 1600, `chunk too long: ${chunk.length}`);
    for (let i = 1; i <= 40; i++) {
      assert.ok(chunks.some((chunk) => chunk.includes(`Paragraph ${i}.`)), `paragraph ${i} missing`);
    }
    // Each chunk after the first starts with text repeated from the end of the previous one.
    for (let i = 1; i < chunks.length; i++) {
      assert.ok(chunks[i - 1].endsWith(chunks[i].slice(0, chunks[i].indexOf("\n\nParagraph"))), `no overlap before chunk ${i}`);
    }
  });

  test("splits a single huge paragraph at sentence boundaries", () => {
    const paragraph = Array.from({ length: 100 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" ");
    const chunks = chunkText(paragraph, { targetSize: 500, maxSize: 800, overlap: 0 });
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 800);
      assert.match(chunk, /\.$/);
    }
    assert.equal(chunks.join(" ").match(/Sentence number/g).length, 100);
  });
});
