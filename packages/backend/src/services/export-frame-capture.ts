import type { Page } from "playwright-core";
import { PDF_PRINT_CSS } from "./export-pdf-contract";

/**
 * The narrow browser surface the frame and slice exporters need. The Playwright
 * adapter below is the only Chromium-aware part; the exporters and their unit
 * tests work against this seam.
 */
export type FrameMeasurement = { readonly sequence: number; readonly width: number; readonly height: number; readonly top: number; readonly bottom: number };
export type FrameRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type SectionMeasurement = { readonly pageWidth: number; readonly pageHeight: number; readonly originX: number; readonly originY: number; readonly sectionBottoms: readonly number[] };
export type CaptureRequest = { readonly clip: FrameRect; readonly format: "png" | "jpeg"; readonly quality?: number };

export type CapturePage = {
  readonly awaitRenderReady: () => Promise<void>;
  /** Lifts the deck runtime's hidden-slide rule so every slide has geometry (same stylesheet the PDF path uses). */
  readonly applyDeckPrintStyles: () => Promise<void>;
  readonly measureFrames: (selector: string) => Promise<readonly FrameMeasurement[]>;
  readonly isolateFrame: (selector: string, index: number) => Promise<FrameRect | null>;
  readonly restoreFrames: (selector: string) => Promise<void>;
  readonly measureSections: (selector: string) => Promise<SectionMeasurement>;
  readonly flattenBackground: () => Promise<void>;
  readonly capture: (request: CaptureRequest) => Promise<Uint8Array>;
};

export function capturePageFromSession(page: Page): CapturePage {
  return {
    awaitRenderReady: async () => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter((image) => !image.complete).map((image) => new Promise<void>((resolve) => {
          image.addEventListener("load", () => { resolve(); }, { once: true });
          image.addEventListener("error", () => { resolve(); }, { once: true });
        })));
        await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
      });
    },
    applyDeckPrintStyles: async () => {
      await page.addStyleTag({ content: PDF_PRINT_CSS });
    },
    measureFrames: async (selector) => await page.evaluate((elementSelector) => [...document.querySelectorAll<HTMLElement>(elementSelector)].map((element, index) => {
      const rect = element.getBoundingClientRect();
      const top = Math.round(rect.top + window.scrollY);
      const height = Math.round(rect.height);
      return { sequence: index + 1, width: Math.round(rect.width), height, top, bottom: top + height };
    }), selector),
    isolateFrame: async (selector, index) => await page.evaluate(({ elementSelector, target }) => {
      const nodes = [...document.querySelectorAll<HTMLElement>(elementSelector)];
      for (const [position, node] of nodes.entries()) {
        node.toggleAttribute("data-bg-export-frame", position === target);
        if (position === target) node.style.removeProperty("display");
        else node.style.setProperty("display", "none", "important");
      }
      const element = nodes[target];
      if (element === undefined) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + window.scrollX), y: Math.round(rect.top + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) };
    }, { elementSelector: selector, target: index }),
    restoreFrames: async (selector) => {
      await page.evaluate((elementSelector) => {
        for (const node of document.querySelectorAll<HTMLElement>(elementSelector)) {
          node.removeAttribute("data-bg-export-frame");
          node.style.removeProperty("display");
        }
      }, selector);
    },
    measureSections: async (selector) => await page.evaluate((elementSelector) => {
      const artboard = document.querySelector<HTMLElement>(elementSelector) ?? document.body;
      const rect = artboard.getBoundingClientRect();
      const originX = Math.round(rect.left + window.scrollX);
      const originY = Math.round(rect.top + window.scrollY);
      const sectionBottoms = [...artboard.children].flatMap((child) => child instanceof HTMLElement && child.hasAttribute("data-bg-node-id")
        ? [Math.round(child.getBoundingClientRect().bottom + window.scrollY) - originY]
        : []);
      return { pageWidth: Math.round(rect.width), pageHeight: Math.round(rect.height), originX, originY, sectionBottoms };
    }, selector),
    flattenBackground: async () => {
      await page.addStyleTag({ content: "html, body { background: #ffffff !important; }" });
    },
    capture: async (request) => new Uint8Array(await page.screenshot({
      type: request.format,
      clip: request.clip,
      animations: "disabled",
      ...(request.quality === undefined ? {} : { quality: request.quality }),
    })),
  };
}
