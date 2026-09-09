import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRepoRoot } from "../lib/paths";
import { chromiumNodeCommand } from "./chromium-node-launch";
import { MAX_UPLOAD_BYTES } from "./extraction-acquisition";

export class AttachmentPdfError extends Error {
  constructor(readonly code: string) { super(code); }
}

// Runs the already bundled PDF.js under Node, away from the API event loop.
const WORKER = String.raw`
import {readFile,writeFile,stat} from 'node:fs/promises';
console.log = console.warn = () => {};
try {
  const [moduleUrl, source, output, maxBytes] = process.argv.slice(1);
  if ((await stat(source)).size > Number(maxBytes)) throw {code:'pdf_size_limit'};
  const {getDocument} = await import(moduleUrl);
  const task = getDocument({data:new Uint8Array(await readFile(source)),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0});
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 200) throw {code:'pdf_page_limit'};
    const pages = []; let total = 0;
    for (let index=1; index<=pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const text = await page.getTextContent();
      let excerpt = '';
      for (const item of text.items) {
        if (typeof item.str !== 'string') continue;
        total += item.str.length;
        if (total > 1000000) throw {code:'pdf_text_limit'};
        if (excerpt.length < 640) excerpt += item.str.slice(0,640-excerpt.length) + (item.hasEOL ? '\n' : ' ');
      }
      excerpt = excerpt.trim().slice(0,640);
      pages.push({index,title:'Page '+index,summary:'',text_excerpt:excerpt});
      page.cleanup();
    }
    const notes = pages.some(page=>page.text_excerpt) ? ['PDF text extracted locally; images are not OCR processed.'] : ['텍스트가 없는 PDF예요. 자동 OCR을 지원하지 않으므로 첨부 원본의 시각 자료를 직접 확인해야 해요.'];
    await writeFile(output,JSON.stringify({kind:'pdf',page_count:pdf.numPages,pages,notes}));
  } finally { await task.destroy(); }
} catch(error) {
  const codes=['pdf_size_limit','pdf_page_limit','pdf_text_limit'];
  const code=codes.includes(error?.code)?error.code:error?.name==='PasswordException'?'pdf_password_required':'pdf_invalid';
  process.stdout.write(code);process.exitCode=1;
}
`;

export async function extractPdfAttachment(sourcePath: string, manifestPath: string): Promise<void> {
  const command = chromiumNodeCommand();
  if (!command) throw new AttachmentPdfError("pdf_runtime_unavailable");
  let modulePath: string;
  try { modulePath = createRequire(path.join(resolveRepoRoot(), "packages/backend/package.json")).resolve("pdfjs-dist/legacy/build/pdf.mjs"); }
  catch { throw new AttachmentPdfError("pdf_runtime_unavailable"); }
  const child = Bun.spawn([command.node, "--max-old-space-size=512", "--input-type=module", "--eval", WORKER, pathToFileURL(modulePath).href, sourcePath, manifestPath, String(MAX_UPLOAD_BYTES)], { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30_000);
  try {
    const [exit, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    if (timedOut) throw new AttachmentPdfError("pdf_extraction_timeout");
    if (exit !== 0) throw new AttachmentPdfError(["pdf_size_limit", "pdf_page_limit", "pdf_text_limit", "pdf_password_required", "pdf_invalid"].includes(output) ? output : "pdf_invalid");
  } finally { clearTimeout(timer); }
}
