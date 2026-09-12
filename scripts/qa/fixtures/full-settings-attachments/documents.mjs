import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(new URL("../../../../packages/backend/package.json", import.meta.url));

/** Build real, disposable files for the settings/attachment browser run. */
export async function createAttachmentFixtures(directory) {
  await mkdir(directory, { recursive: true });
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const JSZip = require("jszip");
  const PptxGenJS = require("pptxgenjs");
  const { createCanvas } = require("@napi-rs/canvas");

  const pdf = await PDFDocument.create();
  pdf.setTitle("BurnGuard attachment QA PDF");
  const pdfFont = await pdf.embedFont(StandardFonts.Helvetica);
  const pdfPage = pdf.addPage([480, 320]);
  pdfPage.drawText("BG_ATTACHMENT_PDF_SENTINEL", { x: 36, y: 250, size: 22, font: pdfFont, color: rgb(0.08, 0.25, 0.62) });
  pdfPage.drawText("A real local PDF used only by isolated browser QA.", { x: 36, y: 215, size: 12, font: pdfFont });
  await writeFile(path.join(directory, "reference.pdf"), await pdf.save());

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "BurnGuard isolated QA";
  pptx.subject = "Attachment intake";
  pptx.title = "BG_ATTACHMENT_PPTX_SENTINEL";
  const slide = pptx.addSlide();
  slide.background = { color: "F4F7FC" };
  slide.addText("BG_ATTACHMENT_PPTX_SENTINEL", { x: 0.8, y: 0.8, w: 10.8, h: 0.8, fontFace: "Arial", fontSize: 28, bold: true, color: "153E75" });
  slide.addText("Real local presentation source", { x: 0.8, y: 1.9, w: 8, h: 0.5, fontFace: "Arial", fontSize: 16, color: "334155" });
  await pptx.writeFile({ fileName: path.join(directory, "reference.pptx") });

  const docx = new JSZip();
  docx.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docx.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>BG_ATTACHMENT_DOCX_SENTINEL</w:t></w:r></w:p><w:p><w:r><w:t>Real local Word source</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  await writeFile(path.join(directory, "reference.docx"), await docx.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

  const canvas = createCanvas(32, 24);
  const drawing = canvas.getContext("2d");
  drawing.fillStyle = "#174EA6";
  drawing.fillRect(0, 0, 32, 24);
  drawing.fillStyle = "#F8FAFC";
  drawing.fillRect(5, 5, 22, 14);
  await writeFile(path.join(directory, "reference.png"), canvas.toBuffer("image/png"));
  await writeFile(path.join(directory, "reference.jpg"), canvas.toBuffer("image/jpeg", 85));
  await writeFile(path.join(directory, "reference.jpeg"), canvas.toBuffer("image/jpeg", 75));
  await writeFile(path.join(directory, "reference.webp"), canvas.toBuffer("image/webp", 80));

  await writeFile(path.join(directory, "notes.txt"), "BG_ATTACHMENT_TEXT_SENTINEL\nBackend text intake parity probe.\n");
  await writeFile(path.join(directory, "malformed.pdf"), "This is deliberately not a PDF.\n");

  const oversized = path.join(directory, "over-10MiB.pdf");
  const oversizedHandle = await open(oversized, "w");
  try { await oversizedHandle.truncate(10 * 1024 * 1024 + 1); } finally { await oversizedHandle.close(); }
  for (const name of ["total-a.pdf", "total-b.pdf", "total-c.pdf"]) {
    const handle = await open(path.join(directory, name), "w");
    try { await handle.truncate(9 * 1024 * 1024); } finally { await handle.close(); }
  }
  for (let index = 1; index <= 9; index += 1) await writeFile(path.join(directory, `count-${index}.png`), canvas.toBuffer("image/png"));

  const names = ["reference.pdf", "reference.pptx", "reference.docx", "reference.png", "reference.jpg", "reference.jpeg", "reference.webp"];
  return { directory, names, paths: Object.fromEntries(names.map((name) => [name, path.join(directory, name)])), bytes: Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(path.join(directory, name))]))) };
}
