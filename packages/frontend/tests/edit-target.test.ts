import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EditPanel, { buildEditPatch } from "../src/components/modes/EditPanel";
import { editTargetFromHit, type EditTarget } from "../src/components/canvas/EditLayer";
import { tweaksTargetFromHit } from "../src/components/canvas/TweaksLayer";
import { buildSandboxedArtifactSrcDoc, frameHitImage, frameHitLayout, type FrameBgHit } from "../src/components/canvas/frame-bridge";
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

describe("selection facts for layout and pictures", () => {
  interface FakeElement { tagName: string; textContent: string; style: Record<string, string>; attrs: Record<string, string>; children: FakeElement[]; parentElement: FakeElement | null; naturalWidth?: number; naturalHeight?: number; currentSrc?: string }
  function element(tag: string, init: { id?: string; style?: Record<string, string>; children?: FakeElement[]; picture?: [number, number, string] } = {}): FakeElement {
    const node: FakeElement = { tagName: tag, textContent: "", style: init.style ?? {}, attrs: init.id ? { "data-bg-node-id": init.id } : {}, children: init.children ?? [], parentElement: null };
    if (init.picture) [node.naturalWidth, node.naturalHeight, node.currentSrc] = init.picture;
    for (const child of node.children) child.parentElement = node;
    return node;
  }
  /** Answers hit-bg for `target` the way the sandboxed bridge would, then crosses the message boundary as JSON. */
  function hit(target: FakeElement, root: FakeElement): FrameBgHit | null {
    const script = buildSandboxedArtifactSrcDoc("<head></head>", "http://localhost/index.html").match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const listeners = new Map<string, (event: unknown) => void>();
    const messages: Array<{ payload: unknown }> = [];
    const parent = { postMessage: (data: { payload: unknown }) => messages.push(data) };
    const proxies = new Map<FakeElement, object>();
    const dom = (node: FakeElement): object => proxies.get(node) ?? proxies.set(node, wrap(node)).get(node)!;
    const wrap = (node: FakeElement): object => new Proxy(node, { get: (source, key) => {
      if (key === "parentElement") return source.parentElement ? dom(source.parentElement) : null;
      if (key === "children") return source.children.map(dom);
      if (key === "closest") return (selector: string) => { for (let current: FakeElement | null = source; current; current = current.parentElement) if (selector.slice(1, -1) in current.attrs) return dom(current); return null; };
      if (key === "getAttribute") return (name: string) => source.attrs[name] ?? null;
      if (key === "attributes") return Object.entries(source.attrs).map(([name, value]) => ({ name, value }));
      if (key === "getBoundingClientRect") return () => ({ left: 0, top: 0, width: 100, height: 50 });
      if (key === "querySelector") return () => null;
      if (key === "offsetWidth") return 100;
      if (key === "offsetHeight") return 50;
      if (key === "__source") return source;
      return source[key as keyof FakeElement];
    } });
    const computed = (node: { __source: FakeElement }) => ({ rotate: "none", transform: "none", getPropertyValue: (name: string) => node.__source.style[name] ?? "" });
    const documentElement = dom(root);
    class DOMMatrix { a = 1; b = 0; c = 0; d = 1; rotate() { return new DOMMatrix(); } multiply() { return new DOMMatrix(); } }
    runInNewContext(script, { DOMMatrix, getComputedStyle: computed,
      document: { readyState: "loading", documentElement, addEventListener() {}, elementFromPoint: () => dom(target), querySelector: () => null, querySelectorAll: () => [] },
      window: { parent, getComputedStyle: computed, addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener) } });
    listeners.get("message")!({ source: parent, data: { __bgFrameBridge: true, type: "request", requestId: "facts", action: "hit-bg", payload: { x: 1, y: 1 } } });
    return JSON.parse(JSON.stringify(messages.at(-1)?.payload ?? null)) as FrameBgHit | null;
  }
  const page = (body: FakeElement): FakeElement => element("HTML", { children: [body] });

  test("Given a container with three children When it is selected Then the Style target counts its children and siblings", () => {
    const list = element("UL", { id: "list", children: [element("LI", { id: "a" }), element("LI", { id: "b" }), element("LI", { id: "c" })] });
    const body = element("BODY", { id: "body", style: { display: "block" }, children: [element("HEADER", { id: "top" }), list] });
    const target = tweaksTargetFromHit(hit(list, page(body)));
    expect(target).toMatchObject({ bg_id: "list", childCount: 3, siblingCount: 1, parent: { bgId: "body", display: "block" } });
  });

  test("Given a child of a grid When it is selected Then the parent's display and id come with it", () => {
    const card = element("DIV", { id: "card", style: { "grid-column": "span 2", translate: "4px 0px" } });
    const grid = element("SECTION", { style: { display: "grid" }, children: [card, element("DIV", { id: "other" })] });
    const target = tweaksTargetFromHit(hit(card, page(element("BODY", { children: [grid] }))))!;
    expect(target.parent).toEqual({ bgId: null, display: "grid" });
    expect(target).toMatchObject({ childCount: 0, siblingCount: 1 });
    expect(target.computed).toMatchObject({ "grid-column": "span 2", translate: "4px 0px" });
  });

  test("Given a picture When it is selected Then the Edit target carries its natural size and loaded URL", () => {
    const picture = element("IMG", { id: "hero", picture: [1600, 900, "http://localhost/assets/hero.png"] });
    const root = page(element("BODY", { children: [picture] }));
    expect(editTargetFromHit(hit(picture, root))).toMatchObject({ bg_id: "hero", tag: "img", image: { naturalWidth: 1600, naturalHeight: 900, currentSrc: "http://localhost/assets/hero.png" } });
    const text = element("P", { id: "copy" });
    expect(editTargetFromHit(hit(text, page(element("BODY", { children: [text] }))))!.image).toBeNull();
    expect(tweaksTargetFromHit(null)).toBeNull();
    expect(editTargetFromHit({ ...hit(picture, root)!, bgId: null })).toBeNull();
  });

  test("Given the page body or a detached node When it is selected Then it has no parent and nothing throws", () => {
    const body = element("BODY", { id: "body", children: [element("MAIN", { id: "main" })] });
    const root = page(body);
    expect(tweaksTargetFromHit(hit(body, root))).toMatchObject({ parent: null, childCount: 1, siblingCount: 0 });
    expect(tweaksTargetFromHit(hit(element("DIV", { id: "alone" }), root))).toMatchObject({ parent: null, childCount: 0, siblingCount: 0 });
  });

  test("Given malformed facts from the sandbox When they are read Then counts fall back to none and a broken picture reports 0 by 0", () => {
    const junk = { childCount: -3, siblingCount: 1.5, parent: { bgId: 7, display: 1 } } as unknown as Parameters<typeof frameHitLayout>[0];
    expect(frameHitLayout(junk)).toEqual({ childCount: 0, siblingCount: 0, parent: null });
    expect(frameHitLayout({})).toEqual({ childCount: 0, siblingCount: 0, parent: null });
    expect(frameHitLayout({ childCount: 2, siblingCount: 4, parent: { bgId: "", display: "x".repeat(100) } })).toEqual({ childCount: 2, siblingCount: 4, parent: { bgId: null, display: "x".repeat(40) } });
    expect(frameHitImage({ image: { naturalWidth: Number.NaN, naturalHeight: -1, currentSrc: "a.png" } })).toEqual({ naturalWidth: 0, naturalHeight: 0, currentSrc: "a.png" });
    expect(frameHitImage({ image: { naturalWidth: 10, naturalHeight: 10 } as unknown as FrameBgHit["image"] })).toBeNull();
    expect(frameHitImage({})).toBeNull();
  });
});
