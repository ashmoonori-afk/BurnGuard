import { describe, expect, test } from "bun:test";
import { deflateSync, crc32 } from "node:zlib";
import { inspectRenderedPage } from "../src/services/design-audit-dom";
import { launchChromium } from "../src/services/export-render-session";

/** A solid-colour PNG of the given pixel size, generated in-test so no fixture file is needed. */
function pngDataUri(width: number, height: number): string {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function stretchFindings(style: string): Promise<readonly string[]> {
  const browser = await launchChromium(new AbortController().signal);
  try {
    const page = await browser.newPage();
    await page.setContent(`<body style="margin:0"><img data-bg-node-id="photo" style="${style}" src="${pngDataUri(200, 100)}"></body>`);
    const result = await inspectRenderedPage(page);
    return result.findings.filter((finding) => finding.code === "stretched_image").map((finding) => finding.nodeId ?? "");
  } finally { await browser.close(); }
}

describe("stretched photographs", () => {
  test("Given a 2:1 image forced into a square box with the default fit, When audited, Then it is reported as stretched", async () => {
    expect(await stretchFindings("width:200px;height:200px")).toEqual(["photo"]);
  }, 60_000);

  test("Given the same image in a square box with object-fit: cover, When audited, Then it is not reported", async () => {
    expect(await stretchFindings("width:200px;height:200px;object-fit:cover")).toEqual([]);
  }, 60_000);

  test("Given the image at its own aspect ratio, When audited, Then it is not reported", async () => {
    expect(await stretchFindings("width:400px;height:200px")).toEqual([]);
  }, 60_000);
});
