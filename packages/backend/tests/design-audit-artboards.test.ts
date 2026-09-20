import { expect, test } from "bun:test";
import { inspectRenderedPage } from "../src/services/design-audit-dom";
import { launchChromium } from "../src/services/export-render-session";

test.each(["data-graphic-artboard", "data-slide"] as const)("Given twelve stacked %s pages When inspected Then local bounds pass inside text but retain overflow and clipping failures", async (marker) => {
  const browser = await launchChromium(AbortSignal.timeout(60_000));
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const controls = '<p data-bg-node-id="outside-left" style="left:-20px;top:120px">Outside</p><p data-bg-node-id="outside-right" style="left:1900px;top:120px">Outside</p><p data-bg-node-id="outside-top" style="left:40px;top:-40px">Outside</p><p data-bg-node-id="outside-bottom" style="left:40px;top:1070px">Outside</p><p data-bg-node-id="ink-outside" style="left:1880px;top:200px;width:10px;white-space:nowrap">Text extending beyond the page</p><p data-bg-node-id="self-clipped" style="left:40px;top:200px;height:10px;overflow:hidden">Clipped</p><div style="position:absolute;left:40px;top:300px;width:200px;height:10px;overflow:hidden"><p data-bg-node-id="ancestor-clipped" style="left:0;top:0">Clipped</p></div>';
    const pages = Array.from({ length: 12 }, (_, index) => `<section ${marker}><p data-bg-node-id="inside-${index}" style="left:40px;top:40px">Inside</p>${index === 1 ? controls : ""}</section>`).join("");
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:#fff;color:#111}section{position:relative;width:1920px;height:1080px;margin-bottom:24px}p{position:absolute;margin:0;width:200px;height:40px;font:32px/40px Arial}</style>${pages}`);
    const observation = await inspectRenderedPage(page, true);
    const overflow = observation.findings.filter(finding => finding.code === "text_overflow");
    expect(observation.measurable.text_overflow).toBe(true);
    expect(overflow.map(finding => finding.nodeId).sort()).toEqual(["ancestor-clipped", "ink-outside", "outside-bottom", "outside-left", "outside-right", "outside-top", "self-clipped"]);
    expect(overflow.every(finding => finding.severity === "must_fix" && finding.action === "expand_or_reflow_text")).toBe(true);
  } finally { await browser.close(); }
}, 60_000);
