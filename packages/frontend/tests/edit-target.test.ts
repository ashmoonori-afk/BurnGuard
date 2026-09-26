import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EditPanel, { buildEditPatch } from "../src/components/modes/EditPanel";
import type { EditTarget } from "../src/components/canvas/EditLayer";
import { buildSandboxedArtifactSrcDoc } from "../src/components/canvas/frame-bridge";
import { t } from "../src/i18n/t";

const textTarget: EditTarget = { bg_id: "hero-title", tag: "h1", text: "Hello", attributes: { "data-bg-node-id": "hero-title", class: "title" }, hasBlockChildren: false };
const imageTarget: EditTarget = { bg_id: "hero-image", tag: "img", text: "", attributes: { "data-bg-node-id": "hero-image", src: "hero.png", alt: "Hero" }, hasBlockChildren: false };
const linkTarget: EditTarget = { bg_id: "cta", tag: "a", text: "Start", attributes: { "data-bg-node-id": "cta", href: "/start" }, hasBlockChildren: false };

function panel(target: EditTarget): string {
  return renderToStaticMarkup(createElement(EditPanel, { target, saving: false, onSave() {}, onClear() {} }));
}
const textarea = (html: string) => html.match(/<textarea[^>]*id="element-edit-text"[^>]*>/)?.[0] ?? null;
const saveButton = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes(t("modes.save"))) ?? "";
const beforeDetails = (html: string) => html.slice(0, html.indexOf("<details"));

describe("EditPanel block-children guard (UXM-08)", () => {
  test("Given a target with block children When rendered Then the text field is disabled and the leaf hint explains why", () => {
    const html = panel({ ...textTarget, hasBlockChildren: true });
    expect(textarea(html)).toContain('disabled=""');
    expect(html).toContain(t("modes.edit.selectLeaf"));
  });

  test("Given a leaf text target When rendered Then the text field is editable and no hint shows", () => {
    const html = panel(textTarget);
    expect(textarea(html)).not.toBeNull();
    expect(textarea(html)).not.toContain('disabled=""');
    expect(html).not.toContain(t("modes.edit.selectLeaf"));
  });
});

describe("EditPanel image and link fields (UXM-09)", () => {
  test("Given an image target When rendered Then src and alt inputs sit outside the advanced details and no text field shows", () => {
    const html = panel(imageTarget);
    expect(textarea(html)).toBeNull();
    const primary = beforeDetails(html);
    expect(primary).toContain(`aria-label="${t("modes.edit.imageSrc")}"`);
    expect(primary).toContain(`aria-label="${t("modes.edit.imageAlt")}"`);
    expect(primary).toContain('value="hero.png"');
    expect(primary).toContain('value="Hero"');
  });

  test("Given a link target When rendered Then an href input sits outside the advanced details next to the text field", () => {
    const html = panel(linkTarget);
    expect(textarea(html)).not.toBeNull();
    expect(beforeDetails(html)).toContain(`aria-label="${t("modes.edit.linkHref")}"`);
    expect(beforeDetails(html)).toContain('value="/start"');
  });

  test("Given an unchanged target When rendered Then Save is disabled", () => {
    for (const target of [textTarget, imageTarget, linkTarget]) expect(saveButton(panel(target))).toContain('disabled=""');
  });

  test("Given edits When the patch is built Then only the changed text or attributes are sent", () => {
    const rows = (target: EditTarget) => Object.entries(target.attributes).filter(([key]) => key !== "data-bg-node-id").map(([key, value]) => ({ key, value }));
    expect(buildEditPatch(imageTarget, imageTarget.text, rows(imageTarget))).toBeNull();
    expect(buildEditPatch(imageTarget, "", [{ key: "src", value: "hero.png" }, { key: "alt", value: "Hero banner" }])).toEqual({ attributes: { alt: "Hero banner" } });
    expect(buildEditPatch(textTarget, "Hello again", rows(textTarget))).toEqual({ text: "Hello again" });
    expect(buildEditPatch(linkTarget, linkTarget.text, [])).toEqual({ attributes: { href: null } });
  });
});

describe("frame bridge hit-bg (UXM-08)", () => {
  function hitBg(childFound: boolean) {
    const html = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/index.html", { quickCommentKey: "current" });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error("bridge_script_missing");
    const listeners = new Map<string, (event: unknown) => void>();
    const messages: Array<{ payload: unknown }> = [];
    const selectors: string[] = [];
    const parent = { postMessage: (data: { payload: unknown }) => messages.push(data) };
    const node = {
      nodeType: 1, tagName: "SECTION", parentElement: null, textContent: "Hero", offsetWidth: 200, offsetHeight: 100, attributes: [],
      closest: () => node,
      getAttribute: (name: string) => name === "data-bg-node-id" ? "hero" : null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
      querySelector: (selector: string) => { selectors.push(selector); return childFound ? {} : null; },
    };
    const root = { scrollWidth: 800, scrollHeight: 600, parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }) };
    const document = { readyState: "loading", baseURI: "http://localhost/index.html", documentElement: root, body: root, addEventListener() {}, elementFromPoint: () => node, querySelector: () => null, querySelectorAll: () => [] };
    const frameWindow = { parent, innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 0, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) };
    class DOMMatrix { a = 1; b = 0; c = 0; d = 1; rotate() { return new DOMMatrix(); } multiply() { return new DOMMatrix(); } }
    runInNewContext(script, { URL, DOMMatrix, document, window: frameWindow, navigator: { platform: "Win32" }, getComputedStyle: () => ({ rotate: "none", transform: "none" }), requestAnimationFrame() {} });
    listeners.get("message")?.({ source: parent, data: { __bgFrameBridge: true, type: "request", requestId: "test", action: "hit-bg", payload: { x: 10, y: 10 } } });
    return { response: messages.at(-1)?.payload as { bgId: string; hasBlockChildren: boolean } | undefined, selectors };
  }

  test("Given a hit node When the bridge answers Then it reports whether a non-inline child exists, mirroring the server's leaf rule", () => {
    const withChild = hitBg(true);
    expect(withChild.response).toMatchObject({ bgId: "hero", hasBlockChildren: true });
    expect(withChild.selectors).toEqual([":not(span,em,strong,br,i,b,u,s,small,sup,sub,mark,code)"]);
    expect(hitBg(false).response).toMatchObject({ bgId: "hero", hasBlockChildren: false });
  });
});
