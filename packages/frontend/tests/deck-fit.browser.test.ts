import { expect, test } from "bun:test";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { launchChromiumViaNode } from "../../backend/src/services/chromium-node-launch";

test("Given a fixed-size deck When the sandbox resizes or changes slides Then the whole artboard fits without document scrollbars", async () => {
  const browser = await launchChromiumViaNode({ channel: "chrome" }, AbortSignal.timeout(30_000));
  try {
    const page = await browser.newPage();
    await page.setContent('<iframe sandbox="allow-scripts" style="width:586px;height:365px;border:0"></iframe>');
    const html = `<style>html,body{margin:0;min-width:1920px;min-height:1080px} [data-slide]{position:fixed;inset:0;width:1920px;height:1080px;background:#369} [data-slide]:not([data-active]){display:none}</style><section data-slide data-active><h1>Full slide</h1></section><section data-slide style="width:1080px;height:1920px">Portrait</section><nav style="position:fixed;bottom:24px">1 / 2</nav>`;
    await page.locator('iframe').evaluate((frame, srcdoc) => { frame.srcdoc = srcdoc; }, buildSandboxedArtifactSrcDoc(html, "http://127.0.0.1:14070/api/projects/test/fs/deck.html"));
    const frame = page.frames().find(frame => frame.parentFrame());
    if (!frame) throw new Error("missing_frame");
    const check = async (width: number, height: number) => {
      await frame.waitForFunction(({ width, height }) => {
        if (innerWidth !== width || innerHeight !== height) return false;
        const slide = document.querySelector('[data-slide][data-active]');
        if (!slide?.hasAttribute('data-bg-slide-fit')) return false;
        const rect = slide.getBoundingClientRect();
        return rect.width > 0 && rect.x >= -1 && rect.y >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1
          && document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight;
      }, { width, height });
      expect(await frame.evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth, y: document.documentElement.scrollHeight <= innerHeight }))).toEqual({ x: true, y: true });
    };
    await check(586, 365);
    expect(await frame.locator('[data-active]').evaluate(node => (node as HTMLElement).offsetWidth)).toBe(1920);
    await page.locator('iframe').evaluate(frame => { frame.style.width = '320px'; frame.style.height = '600px'; });
    await check(320, 600);
    await frame.evaluate(() => { const slides = document.querySelectorAll('[data-slide]'); slides[0]!.removeAttribute('data-active'); slides[1]!.setAttribute('data-active', ''); });
    await check(320, 600);
    expect(await frame.locator('nav').evaluate(node => getComputedStyle(node).transform)).toBe('none');
  } finally { await browser.close(); }
}, 30_000);
