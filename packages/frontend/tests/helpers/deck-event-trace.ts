import type { BrowserContext } from "../../../backend/node_modules/playwright-core";

/** Keep bounded fixture-only event evidence even when an iframe or page disappears. */
export async function observeDeckEvents(context: BrowserContext): Promise<readonly string[]> {
  const trace: string[] = [];
  const record = (entry: string) => { if (trace.length < 160) trace.push(entry); };
  context.on("page", page => {
    page.on("console", message => {
      const text = message.text();
      if (text.startsWith("DECK_EVENT ")) record(text.slice("DECK_EVENT ".length));
    });
    page.on("framenavigated", frame => record(JSON.stringify({ kind: "frame-navigation", child: Boolean(frame.parentFrame()), srcdoc: frame.url().startsWith("about:srcdoc") })));
    page.on("framedetached", frame => record(JSON.stringify({ kind: "frame-detached", child: Boolean(frame.parentFrame()) })));
    page.on("close", () => record(JSON.stringify({ kind: "page-closed" })));
  });
  context.on("close", () => record(JSON.stringify({ kind: "context-closed" })));
  await context.addInitScript(() => {
    const surface = window === window.top ? "parent" : "child";
    const tag = (target: EventTarget | null) => target instanceof Element
      ? target.tagName.toLowerCase() + (target.id ? `#${target.id}` : "")
      : target === window ? "window" : "other";
    const record = (kind: string, values: object = {}) => console.debug("DECK_EVENT " + JSON.stringify({
      surface, kind, time: performance.timeOrigin + performance.now(),
      active: tag(document.activeElement), focused: document.hasFocus(), ready: document.readyState,
      fullscreen: Boolean(document.fullscreenElement), ...values,
    }));
    for (const name of ["focus", "blur", "focusin", "focusout", "load", "DOMContentLoaded", "fullscreenchange", "fullscreenerror"]) {
      window.addEventListener(name, event => record(name, { target: tag(event.target) }), true);
    }
    window.addEventListener("keydown", event => record("key-capture", {
      key: event.key, target: tag(event.target), composing: event.isComposing, repeat: event.repeat,
      prevented: event.defaultPrevented, trusted: event.isTrusted, authorCancels: Reflect.get(window, "cancelEscape") === true,
    }), true);
    window.addEventListener("load", () => {
      window.addEventListener("keydown", event => record("key-bubble", {
        key: event.key, target: tag(event.target), prevented: event.defaultPrevented, trusted: event.isTrusted,
      }));
    }, { once: true });
    window.addEventListener("message", event => {
      if (event.data === "qa-input-fence") record("fence");
      if (event.data?.__bgFrameBridge === true && event.data.type === "event") {
        record("bridge-event", { name: event.data.event, selfSource: event.source === window,
          frameSource: event.source === document.querySelector("iframe")?.contentWindow });
      }
    });
  });
  return trace;
}
