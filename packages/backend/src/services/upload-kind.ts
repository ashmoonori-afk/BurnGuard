import path from "node:path";

/** The only source kinds the upload extractor can truthfully process. */
export const SUPPORTED_UPLOAD_KINDS = ["pdf", "pptx"] as const;

export type SupportedUploadKind = (typeof SUPPORTED_UPLOAD_KINDS)[number];

export function inferUploadKind(fileName: string, contentType?: string | null): SupportedUploadKind | null {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".pptx") return "pptx";
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("application/pdf")) return "pdf";
  if (normalized.includes("application/vnd.openxmlformats-officedocument.presentationml.presentation")) return "pptx";
  return null;
}

/** Attachment intake is broader than design-system extraction. */
export function inferAttachmentKind(name: string): "pdf" | "pptx" | "docx" | "image" | null {
  if (/\.(png|jpe?g|webp)$/i.test(name)) return "image";
  if (/\.docx$/i.test(name)) return "docx";
  return inferUploadKind(name);
}
