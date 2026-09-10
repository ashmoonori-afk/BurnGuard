import { readFile } from "node:fs/promises";

export type AttachmentSummary = {
  readonly kind: "pdf" | "pptx" | "docx" | "image";
  readonly brand_name?: string;
  readonly page_count: number;
  readonly fonts: readonly string[];
  readonly colors: readonly string[];
  readonly notes: readonly string[];
  readonly headings: readonly string[];
  readonly bodies: readonly string[];
  readonly pages: readonly { readonly index: number; readonly title: string; readonly summary: string; readonly text_excerpt: string }[];
};

export async function readAttachmentSummaryFile(filePath: string): Promise<AttachmentSummary | null> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(value) || (value["kind"] !== "pdf" && value["kind"] !== "pptx" && value["kind"] !== "docx" && value["kind"] !== "image")) return null;
    const pageCount = value["page_count"];
    if (typeof pageCount !== "number" || !Number.isSafeInteger(pageCount) || pageCount < 0) return null;
    const pages = value["pages"];
    if (!Array.isArray(pages)) return null;
    const parsedPages = pages.flatMap((page) => {
      if (!isRecord(page) || typeof page["index"] !== "number" || typeof page["title"] !== "string" || typeof page["summary"] !== "string" || typeof page["text_excerpt"] !== "string") return [];
      return [{ index: page["index"], title: page["title"], summary: page["summary"], text_excerpt: page["text_excerpt"] }];
    });
    if (parsedPages.length !== pages.length) return null;
    const brand = value["brand_name"];
    if (brand !== undefined && typeof brand !== "string") return null;
    const fonts = strings(value["fonts"]); const colors = strings(value["colors"]); const notes = strings(value["notes"]); const headings = strings(value["headings"]); const bodies = strings(value["bodies"]);
    if (fonts === null || colors === null || notes === null || headings === null || bodies === null) return null;
    return { kind: value["kind"], ...(brand === undefined ? {} : { brand_name: brand }), page_count: pageCount, fonts, colors, notes, headings, bodies, pages: parsedPages };
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error)) return null;
    throw error;
  }
}
function strings(value: unknown): readonly string[] | null { return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
