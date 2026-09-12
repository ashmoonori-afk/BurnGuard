/**
 * Iframe ↔ parent messaging for the canvas. Two modalities:
 *
 *   1. Request / response (`requestFrame*` exports). The parent posts a
 *      typed request, the iframe's BRIDGE_SCRIPT processes it and posts
 *      a response keyed by requestId. Used for selection, hit tests,
 *      slide control, etc.
 *   2. Event push (`subscribeFrameEvent`). The iframe broadcasts state
 *      changes (e.g. active slide changed) without the parent having
 *      to poll. Used by Canvas to drop the 5-Hz polling loop that used
 *      to drain CPU even on idle decks.
 *
 * Security model:
 *   - The canvas iframe runs with `sandbox="allow-scripts"` and no
 *     `allow-same-origin`, so its origin is opaque. That makes
 *     `event.origin` always `"null"` and `target.postMessage(_, "*")`
 *     the only viable target. We compensate with a strict source check
 *     (`event.source === window.parent` inside the iframe;
 *     `event.source === request.source` in the parent), which is
 *     immune to spoofing because no other window can become our
 *     iframe's contentWindow.
 *   - The shared envelope `{ __bgFrameBridge: true, ... }` doubles as
 *     a tag so unrelated postMessages (e.g. from extensions) are
 *     ignored cheaply.
 */

import type { GraphicCanvasV1 } from "@bg/shared";
import { artifactContentSecurityPolicy } from "@bg/shared/security";
import { buildGraphicPreviewInjection } from "@/lib/graphic-preview";
import { isCommentEditable, isQuickCommentShortcut } from "./quick-comment";

export interface FrameRect {
  rotation?: number;
  boxWidth?: number;
  boxHeight?: number;
  scaleX?: number;
  scaleY?: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameSelectHit {
  rect: FrameRect | null;
  selector: string | null;
  bgId: string | null;
  tag: string | null;
  text: string | null;
  computed: Record<string, string>;
  inline: Record<string, string>;
}

export interface FrameCommentHit {
  selector: string;
  slideIndex: number | null;
}

export interface FrameBgHit {
  geometry?: { width: number; height: number };
  rect: FrameRect | null;
  bgId: string | null;
  tag: string | null;
  text: string | null;
  attributes: Record<string, string>;
  computed: Record<string, string>;
  inline: Record<string, string>;
}

type BridgeAction =
  | "preview-report"
  | "scroll-at-point"
  | "hit-select"
  | "hit-comment"
  | "hit-bg"
  | "rect-selector"
  | "rect-bg"
  | "active-slide"
  | "set-active-slide"
  | "reveal-selector"
  | "count-selector";

/**
 * Default timeout per request. Bumped from the original 200 ms because
 * a busy iframe (large DOM, mid-render Edit-mode hover spam) can lose
 * a tick or two and leave callers staring at a silent `null`. 1000 ms
 * is long enough to absorb that without making genuine failures slow.
 */
export const FRAME_BRIDGE_REQUEST_TIMEOUT_MS = 1_000;

interface BridgeRequest {
  __bgFrameBridge: true;
  type: "request";
  requestId: string;
  action: BridgeAction;
  payload?: Record<string, unknown>;
}

interface BridgeResponse {
  __bgFrameBridge: true;
  type: "response";
  requestId: string;
  payload?: unknown;
}

/**
 * Names of one-way events the iframe can push to the parent without
 * being asked. Add new event names here AND in BRIDGE_SCRIPT (or
 * deck-stage.ts for runtime-emitted events).
 */
type FrameEventName = "document-loaded" | "present-dismiss" | "active-slide-changed" | "navigate" | "viewport-wheel" | "comment-pointer" | "comment-shortcut" | "comment-dismiss";

type FrameEventPayload<E extends FrameEventName> = E extends "document-loaded" | "present-dismiss" ? { documentKey: string } : E extends "comment-pointer" | "comment-shortcut" | "comment-dismiss" ? { documentKey: string; x: number | null; y: number | null } : E extends "viewport-wheel" ? { x: number; y: number; delta: number } : E extends "navigate" ? { href: string } : { index: number };

interface FrameEvent<E extends FrameEventName = FrameEventName> {
  __bgFrameBridge: true;
  type: "event";
  event: E;
  payload: FrameEventPayload<E>;
}

interface PendingRequest {
  source: Window;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: number;
}

const pending = new Map<string, PendingRequest>();
type AnyEventHandler = (payload: unknown) => void;
const subscribers = new Map<
  HTMLIFrameElement,
  Map<FrameEventName, Set<AnyEventHandler>>
>();

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as
      | BridgeResponse
      | FrameEvent
      | undefined;
    if (!data || data.__bgFrameBridge !== true) return;

    if (data.type === "response") {
      const request = pending.get(data.requestId);
      if (!request || event.source !== request.source) {
        return;
      }
      pending.delete(data.requestId);
      window.clearTimeout(request.timer);
      request.resolve(data.payload);
      return;
    }

    if (data.type === "event") {
      // Route to the iframe whose contentWindow matches the event source.
      // Iterating is fine — we never have more than a handful of canvas
      // iframes alive at once.
      for (const [iframe, perEvent] of subscribers) {
        if (iframe.contentWindow === event.source) {
          const handlers = perEvent.get(data.event);
          if (handlers) {
            for (const handler of handlers) handler(data.payload);
          }
          break;
        }
      }
    }
  });
}

export function subscribeFrameEvent<E extends FrameEventName>(
  iframe: HTMLIFrameElement | null,
  event: E,
  handler: (payload: FrameEventPayload<E>) => void,
): () => void {
  if (!iframe) return () => {};
  let perEvent = subscribers.get(iframe);
  if (!perEvent) {
    perEvent = new Map();
    subscribers.set(iframe, perEvent);
  }
  let handlers = perEvent.get(event);
  if (!handlers) {
    handlers = new Set();
    perEvent.set(event, handlers);
  }
  handlers.add(handler as AnyEventHandler);
  return () => {
    const ps = subscribers.get(iframe);
    const ss = ps?.get(event);
    ss?.delete(handler as AnyEventHandler);
    if (ss && ss.size === 0) ps?.delete(event);
    if (ps && ps.size === 0) subscribers.delete(iframe);
  };
}

export type SandboxedArtifactOptions = {
  readonly graphicCanvas?: GraphicCanvasV1;
  readonly quickCommentKey?: string;
  readonly presentationKey?: string;
};

export function buildSandboxedArtifactSrcDoc(
  html: string,
  baseHref: string,
  options?: SandboxedArtifactOptions,
): string {
  // The policy must be the first thing the parser sees in <head> so it also
  // governs the artifact's own inline resources; a sandboxed srcdoc has an
  // opaque origin, so the app origin is named explicitly instead of 'self'.
  const policyTag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(artifactContentSecurityPolicy(new URL(baseHref).origin))}">`;
  const baseTag = `${policyTag}<base href="${escapeHtmlAttr(baseHref)}">`;
  const graphicPreview = options?.graphicCanvas === undefined
    ? ""
    : buildGraphicPreviewInjection(options.graphicCanvas);
  const commentKey = JSON.stringify(options?.quickCommentKey ?? null).replaceAll("<", "\\u003c");
  const presentationKey = JSON.stringify(options?.presentationKey ?? null).replaceAll("<", "\\u003c");
  const scriptTag = `<script>(function () { var quickCommentKey = ${commentKey}; var presentationKey = ${presentationKey}; ${BRIDGE_SCRIPT} })();</script>`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${graphicPreview}${scriptTag}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${baseTag}${graphicPreview}${scriptTag}</head>`,
    );
  }
  return `<!doctype html><html><head>${baseTag}${graphicPreview}${scriptTag}</head><body>${html}</body></html>`;
}


export async function requestFrameSelectAtPoint(
  iframe: HTMLIFrameElement | null,
  x: number,
  y: number,
): Promise<FrameSelectHit | null> {
  return (await requestFrameBridge(iframe, "hit-select", { x, y })) as
    | FrameSelectHit
    | null;
}

export async function requestFrameScrollAtPoint(iframe: HTMLIFrameElement | null, x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
  await requestFrameBridge(iframe, "scroll-at-point", { x, y, deltaX, deltaY });
}

export async function requestFrameCommentAtPoint(
  iframe: HTMLIFrameElement | null,
  x: number,
  y: number,
): Promise<FrameCommentHit | null> {
  return (await requestFrameBridge(iframe, "hit-comment", { x, y })) as
    | FrameCommentHit
    | null;
}

export async function requestFrameBgAtPoint(
  iframe: HTMLIFrameElement | null,
  x: number,
  y: number,
): Promise<FrameBgHit | null> {
  return (await requestFrameBridge(iframe, "hit-bg", { x, y })) as
    | FrameBgHit
    | null;
}

export async function requestFrameRectForSelector(
  iframe: HTMLIFrameElement | null,
  selector: string,
): Promise<FrameRect | null> {
  return (await requestFrameBridge(iframe, "rect-selector", {
    selector,
  })) as FrameRect | null;
}

/** Scrolls the matched element into view and answers with its rect. */
export async function requestFrameRevealSelector(
  iframe: HTMLIFrameElement | null,
  selector: string,
): Promise<FrameRect | null> {
  return (await requestFrameBridge(iframe, "reveal-selector", {
    selector,
  }).catch(() => null)) as FrameRect | null;
}

export async function requestFrameCountSelector(
  iframe: HTMLIFrameElement | null,
  selector: string,
): Promise<number> {
  const count = await requestFrameBridge(iframe, "count-selector", {
    selector,
  }).catch(() => 0);
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export async function requestFramePreviewReport(iframe: HTMLIFrameElement | null): Promise<unknown> {
  return requestFrameBridge(iframe, "preview-report");
}

export async function requestFrameRectForBgId(
  iframe: HTMLIFrameElement | null,
  bgId: string,
): Promise<FrameRect | null> {
  return (await requestFrameBridge(iframe, "rect-bg", {
    bgId,
  })) as FrameRect | null;
}

export async function requestFrameActiveSlide(
  iframe: HTMLIFrameElement | null,
): Promise<number | null> {
  return (await requestFrameBridge(iframe, "active-slide")) as number | null;
}

export async function requestFrameSetActiveSlide(
  iframe: HTMLIFrameElement | null,
  slideIndex: number,
): Promise<number | null> {
  const index = await requestFrameBridge(iframe, "set-active-slide", {
    slideIndex,
  }).catch(() => null);
  return typeof index === "number" && Number.isSafeInteger(index) && index >= -1
    ? index
    : null;
}

async function requestFrameBridge(
  iframe: HTMLIFrameElement | null,
  action: BridgeAction,
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const target = iframe?.contentWindow ?? null;
  if (!target) {
    return null;
  }

  const requestId = `bg-${crypto.randomUUID()}`;
  const request: BridgeRequest = {
    __bgFrameBridge: true,
    type: "request",
    requestId,
    action,
    payload,
  };

  return await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, FRAME_BRIDGE_REQUEST_TIMEOUT_MS);
    pending.set(requestId, { source: target, resolve, reject, timer });
    try {
      // targetOrigin "*" is unavoidable: the iframe's sandbox makes its
      // origin opaque, so any other value would silently drop the
      // message. The recipient enforces a strict source check (see
      // BRIDGE_SCRIPT) so this isn't a hand-off to an arbitrary origin.
      target.postMessage(request, "*");
    } catch (error) {
      pending.delete(requestId);
      window.clearTimeout(timer);
      reject(error);
    }
  });
}

function escapeHtmlAttr(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const BRIDGE_SCRIPT = String.raw`(function () {
  if (window.__BG_FRAME_BRIDGE__) return;
  window.__BG_FRAME_BRIDGE__ = true;

  var STYLE_KEYS = [
    "font-family",
    "font-size",
    "font-weight",
    "color",
    "line-height",
    "letter-spacing",
    "rotate", "aspect-ratio", "box-sizing", "display",
    "width",
    "height",
    "padding",
    "margin",
    "border",
    "border-radius",
    "background",
    "background-color"
  ];

  function elementRect(node) {
    var rect = node.getBoundingClientRect();
    var matrix = new DOMMatrix();
    for (var current = node; current; current = current.parentElement) {
      var style = getComputedStyle(current);
      var rotation = style.rotate && style.rotate !== "none" ? parseFloat(style.rotate) : 0;
      var own = new DOMMatrix().rotate(rotation || 0);
      if (style.transform && style.transform !== "none") own = own.multiply(new DOMMatrix(style.transform));
      matrix = own.multiply(matrix);
    }
    var scaleX = Math.hypot(matrix.a, matrix.b), scaleY = Math.hypot(matrix.c, matrix.d);
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
      boxWidth: node.offsetWidth * scaleX, boxHeight: node.offsetHeight * scaleY,
      scaleX: scaleX, scaleY: scaleY };
  }

  function toRect(node) {
    if (!node || !node.getBoundingClientRect) return null;
    var elemRect = node.getBoundingClientRect();
    // For block leaf elements with only text content, the element's
    // bounding rect covers the full parent content width even when the
    // visible text is much shorter. That made the selection box look
    // "too wide left-right" on every overlay (Select / Edit / Tweaks).
    // Range.getBoundingClientRect over the element's contents returns
    // the tight visual extent of the actual text runs, which is what
    // the user expects to see highlighted.
    var hasElementChild = false;
    if (node.children && node.children.length > 0) {
      hasElementChild = true;
    }
    if (!hasElementChild && node.childNodes && node.childNodes.length > 0) {
      try {
        var range = document.createRange();
        range.selectNodeContents(node);
        var tight = range.getBoundingClientRect();
        // Defensive: only swap when the tight rect is meaningfully
        // narrower than the element rect (>4 px difference) AND it
        // actually has area. Avoids flicker on already-tight elements.
        if (
          tight && tight.width > 0 && tight.height > 0 &&
          elemRect.width - tight.width > 4
        ) {
          return {
            left: tight.left,
            top: tight.top,
            width: tight.width,
            height: tight.height
          };
        }
      } catch (e) {
        // Range API unavailable / failed — fall through.
      }
    }
    return {
      left: elemRect.left,
      top: elemRect.top,
      width: elemRect.width,
      height: elemRect.height
    };
  }

  function selectorOf(node) {
    if (!node || !node.getAttribute) return null;
    var bg = node.getAttribute("data-bg-node-id");
    if (bg) return '[data-bg-node-id="' + String(bg).replace(/"/g, '\\"') + '"]';
    if (node.id) return "#" + node.id;
    return String(node.tagName || "body").toLowerCase();
  }

  function slideIndexOf(node) {
    if (!node || !node.closest) return null;
    // A graphic project has artboards instead of slides; either way the index
    // is the frame the element belongs to, so comments and selections stay
    // frame-local.
    var slide = node.closest("[data-slide]") || node.closest("[data-graphic-artboard]");
    if (!slide) return null;
    var group = slide.hasAttribute("data-slide") ? "[data-slide]" : "[data-graphic-artboard]";
    var slides = Array.prototype.slice.call(document.querySelectorAll(group));
    var idx = slides.indexOf(slide);
    return idx >= 0 ? idx : null;
  }

  function readComputed(node) {
    var out = {};
    if (!node || !window.getComputedStyle) return out;
    try {
      var style = window.getComputedStyle(node);
      for (var i = 0; i < STYLE_KEYS.length; i++) {
        var key = STYLE_KEYS[i];
        out[key] = String(style.getPropertyValue(key) || "").trim();
      }
    } catch (e) {
      return {};
    }
    return out;
  }

  function readInline(node) {
    var out = {};
    if (!node || !node.getAttribute) return out;
    var raw = node.getAttribute("style") || "";
    var parts = raw.split(";");
    for (var i = 0; i < parts.length; i++) {
      var decl = parts[i].trim();
      if (!decl) continue;
      var colon = decl.indexOf(":");
      if (colon <= 0) continue;
      var key = decl.slice(0, colon).trim();
      var value = decl.slice(colon + 1).trim();
      if (key && value) out[key] = value;
    }
    return out;
  }

  function readAttributes(node) {
    var out = {};
    if (!node || !node.attributes) return out;
    for (var i = 0; i < node.attributes.length; i++) {
      var attr = node.attributes[i];
      out[attr.name] = attr.value;
    }
    return out;
  }

  function resolveTargetAtPoint(x, y) {
    try {
      return document.elementFromPoint(Number(x) || 0, Number(y) || 0);
    } catch (e) {
      return null;
    }
  }

  function queryByBgId(bgId) {
    if (!bgId || !document.querySelector) return null;
    if (window.CSS && typeof window.CSS.escape === "function") {
      return document.querySelector('[data-bg-node-id="' + window.CSS.escape(bgId) + '"]');
    }
    return document.querySelector('[data-bg-node-id="' + String(bgId).replace(/"/g, '\\"') + '"]');
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.__bgFrameBridge !== true || data.type !== "request") {
      return;
    }
    if (event.source !== window.parent) return;

    var payload = data.payload || {};
    var response = null;

    if (data.action === "scroll-at-point") {
      var dx = Number(payload.deltaX);
      var dy = Number(payload.deltaY);
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        var scrollNode = resolveTargetAtPoint(payload.x, payload.y);
        while (scrollNode && scrollNode !== document.documentElement) {
          var scrollStyle = window.getComputedStyle(scrollNode);
          var beforeX = scrollNode.scrollLeft;
          var beforeY = scrollNode.scrollTop;
          if (/(auto|scroll)/.test(scrollStyle.overflowY)) scrollNode.scrollTop += Math.max(-2000, Math.min(2000, dy));
          if (/(auto|scroll)/.test(scrollStyle.overflowX)) scrollNode.scrollLeft += Math.max(-2000, Math.min(2000, dx));
          if (beforeX !== scrollNode.scrollLeft || beforeY !== scrollNode.scrollTop) break;
          scrollNode = scrollNode.parentElement;
        }
        if (!scrollNode || scrollNode === document.documentElement) window.scrollBy(Math.max(-2000, Math.min(2000, dx)), Math.max(-2000, Math.min(2000, dy)));
      }
    } else if (data.action === "hit-select") {
      var selectNode = resolveTargetAtPoint(payload.x, payload.y);
      var selectAnchor = selectNode && selectNode.closest
        ? selectNode.closest("[data-bg-node-id]")
        : null;
      var inspectNode = selectAnchor || selectNode;
      response = inspectNode ? {
        rect: toRect(inspectNode),
        selector: selectorOf(inspectNode),
        bgId: selectAnchor ? selectAnchor.getAttribute("data-bg-node-id") : null,
        tag: String(inspectNode.tagName || "").toLowerCase(),
        text: String(inspectNode.textContent || ""),
        computed: readComputed(inspectNode),
        inline: readInline(inspectNode)
      } : null;
    } else if (data.action === "hit-comment") {
      var commentNode = resolveTargetAtPoint(payload.x, payload.y);
      response = commentNode ? {
        selector: selectorOf(commentNode) || "body",
        slideIndex: slideIndexOf(commentNode)
      } : { selector: "body", slideIndex: null };
    } else if (data.action === "hit-bg") {
      var rawNode = resolveTargetAtPoint(payload.x, payload.y);
      var bgNode = rawNode && rawNode.closest ? rawNode.closest("[data-bg-node-id]") : null;
      response = bgNode ? {
        rect: elementRect(bgNode),
        geometry: { width: bgNode.offsetWidth, height: bgNode.offsetHeight },
        bgId: bgNode.getAttribute("data-bg-node-id"),
        tag: String(bgNode.tagName || "").toLowerCase(),
        text: String(bgNode.textContent || ""),
        attributes: readAttributes(bgNode),
        computed: readComputed(bgNode),
        inline: readInline(bgNode)
      } : null;
    } else if (data.action === "rect-selector") {
      try {
        var rectNode = payload.selector ? document.querySelector(String(payload.selector)) : null;
        response = rectNode ? toRect(rectNode) : null;
      } catch (e) {
        response = null;
      }
    } else if (data.action === "reveal-selector") {
      try {
        var revealNode = payload.selector ? document.querySelector(String(payload.selector)) : null;
        if (revealNode) {
          revealNode.scrollIntoView({ block: "center", inline: "center" });
          response = toRect(revealNode);
        } else {
          response = null;
        }
      } catch (e) {
        response = null;
      }
    } else if (data.action === "preview-report") {
      var previewImages = Array.prototype.slice.call(document.images, 0, 10000);
      response = { width: window.innerWidth, height: window.innerHeight, images: previewImages.length, brokenImages: previewImages.filter(function (img) { return img.complete && img.naturalWidth === 0; }).length, pendingImages: previewImages.filter(function (img) { return !img.complete; }).length, horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth) };
    } else if (data.action === "count-selector") {
      try {
        response = payload.selector ? document.querySelectorAll(String(payload.selector)).length : 0;
      } catch (e) {
        response = 0;
      }
    } else if (data.action === "rect-bg") {
      var bgRectNode = queryByBgId(payload.bgId);
      response = bgRectNode ? elementRect(bgRectNode) : null;
    } else if (data.action === "active-slide") {
      var slides = document.querySelectorAll("[data-slide]");
      if (!slides || slides.length === 0) {
        response = null;
      } else {
        var active = document.querySelector("[data-slide][data-active]");
        response = active ? Array.prototype.indexOf.call(slides, active) : 0;
      }
    } else if (data.action === "set-active-slide") {
      var targetIndex = Math.max(0, Number(payload.slideIndex) || 0);
      var slideList = document.querySelectorAll("[data-slide]");
      if (!slideList || slideList.length === 0) {
        response = -1;
      } else {
        var clamped = Math.min(slideList.length - 1, targetIndex);
        var nextHash = "#slide-" + (clamped + 1);
        try {
          if (location.hash !== nextHash) {
            // Resolve against the iframe URL, not the artifact <base>: a
            // sandboxed srcdoc cannot replace its URL with that HTTP origin.
            history.replaceState(null, "", location.href.split("#")[0] + nextHash);
            window.dispatchEvent(new HashChangeEvent("hashchange"));
          } else {
            var activeNode = document.querySelector("[data-slide][data-active]");
            if (!activeNode || Array.prototype.indexOf.call(slideList, activeNode) !== clamped) {
              for (var i = 0; i < slideList.length; i++) {
                if (i === clamped) slideList[i].setAttribute("data-active", "");
                else slideList[i].removeAttribute("data-active");
              }
            }
          }
          response = clamped;
        } catch (e) {
          response = false;
        }
      }
    }

    window.parent.postMessage({
      __bgFrameBridge: true,
      type: "response",
      requestId: data.requestId,
      payload: response
    }, "*");
  });

  var commentPointer = null;
  var commentEditable = ${isCommentEditable.toString()};
  var commentShortcut = ${isQuickCommentShortcut.toString()};
  function notifyComment(eventName) {
    if (quickCommentKey === null) return;
    window.parent.postMessage({ __bgFrameBridge: true, type: "event", event: eventName,
      payload: { documentKey: quickCommentKey, x: commentPointer ? commentPointer.x : null, y: commentPointer ? commentPointer.y : null } }, "*");
  }
  window.addEventListener("pointermove", function (event) {
    commentPointer = { x: event.clientX, y: event.clientY };
    notifyComment("comment-pointer");
  }, true);
  window.addEventListener("pointerout", function (event) {
    if (event.relatedTarget) return;
    commentPointer = null;
    notifyComment("comment-pointer");
  }, true);
  window.addEventListener("keydown", function (event) {
    if (quickCommentKey === null) return;
    var editable = commentEditable(event.target);
    if (event.key === "Escape" && !event.repeat && !event.isComposing && !event.defaultPrevented && !editable) notifyComment("comment-dismiss");
    if (!commentPointer || !commentShortcut(event, editable)) return;
    event.preventDefault();
    notifyComment("comment-shortcut");
  });

  // Push: notify the parent of the active slide whenever it changes
  // (hashchange, deck-stage nav, MutationObserver-driven structural
  // edit). Lets the parent drop its 5-Hz polling loop. Same envelope
  // tag (__bgFrameBridge) so the parent's single message listener
  // routes both kinds of payload.
  window.addEventListener("wheel", function(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    window.parent.postMessage({ __bgFrameBridge: true, type: "event", event: "viewport-wheel", payload: { x: event.clientX, y: event.clientY, delta: event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1) } }, "*");
  }, { passive: false, capture: true });

  function notifyActiveSlide() {
    try {
      var slides = document.querySelectorAll("[data-slide]");
      var index;
      if (!slides || slides.length === 0) {
        index = -1;
      } else {
        var active = document.querySelector("[data-slide][data-active]");
        index = active ? Array.prototype.indexOf.call(slides, active) : 0;
      }
      window.parent.postMessage({
        __bgFrameBridge: true,
        type: "event",
        event: "active-slide-changed",
        payload: { index: index }
      }, "*");
    } catch (e) { /* parent gone, ignore */ }
  }

  window.addEventListener("hashchange", notifyActiveSlide);

  function scrollToFragment(hash) {
    var id = hash.slice(1);
    try { id = decodeURIComponent(id); } catch (e) { /* keep malformed fragments literal */ }
    var target = document.getElementById(id) || document.getElementsByName(id)[0];
    try {
      if (location.hash !== hash) {
        history.replaceState(null, "", location.href.split("#")[0] + hash);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    } catch (e) { /* scrolling still works when history is unavailable */ }
    if (target) target.scrollIntoView();
    else if (!id || id.toLowerCase() === "top") window.scrollTo(0, 0);
  }

  function initializeNavigation() {
    // Window bubbling lets authored element/document handlers prevent navigation first.
    window.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
      if (!link || link.hasAttribute("download")) return;
      var target = (link.getAttribute("target") || "").toLowerCase();
      if (target && target !== "_self") return;
      var href = (link.getAttribute("href") || "").trim();
      if (!href) return;
      var base;
      var destination;
      try { base = new URL(document.baseURI); destination = new URL(href, base); } catch (e) { return; }
      if (destination.origin !== base.origin || !/^https?:$/.test(destination.protocol)) return;
      if (href.charAt(0) === "#" || (destination.pathname === base.pathname && destination.search === base.search && destination.hash)) {
        event.preventDefault();
        scrollToFragment(destination.hash);
      } else if (/\.html?$/i.test(destination.pathname) || !/\.[^\/]*$/.test(destination.pathname.replace(/\/$/, ""))) {
        // Mirrors resolveCanvasPageTarget: an .html file, or a directory-style
        // path (trailing slash or extension-less last segment) that the parent
        // resolves to dir/index.html. Asset links keep their default behavior.
        event.preventDefault();
        window.parent.postMessage({ __bgFrameBridge: true, type: "event", event: "navigate", payload: { href: destination.href } }, "*");
      }
    });
  }

  function applyInitialFragment() {
    try {
      var hash = new URL(document.baseURI).hash;
      if (hash) scrollToFragment(hash);
    } catch (e) { /* no valid artifact base */ }
  }

  initializeNavigation();

  // Watch for [data-slide] structural edits AND data-active attribute
  // toggles. Either one means the active slide may have changed.
  if (typeof MutationObserver === "function") {
    var slideObserver = new MutationObserver(function() { notifyActiveSlide(); });
    slideObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-active"]
    });
  }

  if (presentationKey !== null) {
    // srcdoc has no query string. Presenter mode is host state, not a rewritten
    // Location API or a change to authored runtime code.
    document.addEventListener("DOMContentLoaded", function () { document.body.setAttribute("data-presenter", ""); }, { once: true });
    window.addEventListener("load", function () {
      // Register after authored startup handlers, at window bubble phase, so
      // their preventDefault/stopPropagation and editable/IME keys stay local.
      window.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || event.repeat || event.isComposing || event.keyCode === 229 || event.defaultPrevented || commentEditable(event.target)) return;
        window.parent.postMessage({ __bgFrameBridge: true, type: "event", event: "present-dismiss",
          payload: { documentKey: presentationKey } }, "*");
      });
    }, { once: true });
  }

  function notifyDocumentLoaded() {
    if (quickCommentKey === null) return;
    window.parent.postMessage({ __bgFrameBridge: true, type: "event", event: "document-loaded",
      payload: { documentKey: quickCommentKey } }, "*");
  }
  function finishDocumentLoad() {
    requestAnimationFrame(function () {
      applyInitialFragment();
      notifyDocumentLoaded();
    });
  }
  if (document.readyState === "complete") finishDocumentLoad();
  else window.addEventListener("load", finishDocumentLoad, { once: true });

  // Emit an initial state so the parent gets the first slide without
  // a request.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    notifyActiveSlide();
  } else {
    document.addEventListener("DOMContentLoaded", notifyActiveSlide, { once: true });
  }
})();`;
