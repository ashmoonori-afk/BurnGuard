import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(new URL('../../../../packages/backend/package.json', import.meta.url));
export async function documents(directory) {
  await mkdir(directory, { recursive: true });
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Catalog PDF Reference');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([640, 480]);
  page.drawText('Catalog PDF Reference', { x: 40, y: 400, size: 28, font, color: rgb(0.1, 0.3, 0.6) });
  page.drawText('Readable local brand reference and typography specimen.', { x: 40, y: 350, size: 14, font });
  await writeFile(path.join(directory, 'reference.pdf'), await pdf.save());
  const scanned = await PDFDocument.create();
  const imagePage = scanned.addPage([640, 480]);
  const pixel = await scanned.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  imagePage.drawImage(pixel, { x: 0, y: 0, width: 640, height: 480 });
  await writeFile(path.join(directory, 'scanned.pdf'), await scanned.save());
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.title = 'Catalog PPTX Reference';
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'BurnGuard local QA';
  const slide = pptx.addSlide();
  slide.background = { color: 'F1F5F9' };
  slide.addText('Catalog PPTX Reference', { x: 1, y: 1, w: 10, h: 1, fontFace: 'Arial', fontSize: 32, color: '123ABC', bold: true });
  slide.addText('Local source palette, headings, and body typography.', { x: 1, y: 2.3, w: 10, h: 1, fontFace: 'Arial', fontSize: 18, color: '334455' });
  await pptx.writeFile({ fileName: path.join(directory, 'reference.pptx') });
  for (const filename of ['invalid.pdf', 'invalid.pptx', 'unsupported.txt', 'invalid.woff2']) await writeFile(path.join(directory, filename), 'invalid fixture bytes');
  return directory;
}
