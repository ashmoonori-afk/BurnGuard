import { readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { parse } from "node-html-parser";
import type { AttachmentExtractionInput } from "./attachment-extraction";

/** Bounded local text extraction; no relationships, macros, or external resources run. */
export async function extractImageOrWordAttachment(input: AttachmentExtractionInput): Promise<void> {
  const bytes = await readFile(input.sourcePath);
  if (bytes.length > 10 * 1024 * 1024) throw new Error("attachment_too_large");
  const word = /\.docx$/i.test(input.sourcePath);
  let text = "Image attachment: inspect the original image using the image-viewing tool. No OCR was performed.";
  let colors: string[] = [];
  if (word) {
    const zip = await JSZip.loadAsync(bytes);
    if (Object.keys(zip.files).length > 2000 || !zip.file("word/document.xml")) throw new Error("invalid_docx");
    const parts = Object.values(zip.files).filter(file => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(file.name)).sort((a, b) => a.name === "word/document.xml" ? -1 : b.name === "word/document.xml" ? 1 : a.name.localeCompare(b.name));
    let remaining = 5 * 1024 * 1024;
    const sections: string[] = [];
    for (const part of parts) {
      const xml = await boundedXml(part, remaining);
      remaining -= Buffer.byteLength(xml);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("invalid_docx");
      sections.push(parse(xml.replace(/<w:(?:tab)\b[^>]*\/>/g, "\t").replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, "\t")).textContent.trim());
    }
    text = sections.join("\n\n");
    if (text.length > 1_000_000) throw new Error("docx_text_limit");
    if (!text.trim()) text = "No text was found in this Word document. Embedded images were not OCR processed.";
  } else {
    const { imagePalette } = await import("./pinterest-mood");
    colors = await imagePalette(bytes);
  }
  const kind = word ? "docx" : "image";
  await writeFile(input.extractedTextPath, `# Extracted attachment (${kind})\n\n${text}`, "utf8");
  await writeFile(input.manifestPath, JSON.stringify({ kind, page_count: word ? 0 : 1, fonts: [], colors, headings: [], bodies: word ? [text.slice(0, 640)] : [], pages: [], notes: word ? ["Word body, tables, headers and footnotes extracted locally; page layout and embedded images are not rendered."] : [text] }));
}

function boundedXml(file: JSZip.JSZipObject, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let total = 0;
    const stream = file.nodeStream("nodebuffer");
    stream.on("data", (chunk: Uint8Array) => {
      total += chunk.length;
      if (total > maxBytes) { stream.pause(); if (stream instanceof Readable) stream.destroy(); reject(new Error("docx_size_limit")); return; }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
