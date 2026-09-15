// allow: SIZE_OK — embedded browser runtime is one shipped state machine.
/**
 * Deck stage runtime — served at /runtime/deck-stage.js.
 *
 * Embedded as a string rather than a separate .js file so `bun build --compile`
 * bundles it into the Windows binary without extra asset copying. The string
 * is served verbatim with `Content-Type: application/javascript` by
 * `routes/runtime.ts`.
 *
 * Contract (shared with slide-deck template and exporters):
 *   - Every slide is a top-level element matching `[data-slide]`.
 *   - Exactly one slide at a time carries `data-active`.
 *   - <body> gets `data-deck-ready` once boot finishes (CSS in the template
 *     uses this to switch from stacked preview to single-slide display).
 *   - `?present` or `?presenter` query flags set `data-presenter` on <body>
 *     so CSS can reveal speaker notes.
 *   - Hash `#slide-N` reflects and drives the current slide (1-indexed).
 *
 * Keyboard:
 *   →, Space, PageDown → next
 *   ←, PageUp          → prev
 *   Home / End         → jump to first / last
 *   f                  → toggle fullscreen
 *   Esc                → exit presenter
 */
export const DECK_STAGE_JS = `(function() {
  "use strict";

  var SLIDE_SELECTOR = "[data-slide]";
  var ACTIVE_ATTR = "data-active";

  function slides() {
    return Array.prototype.slice.call(document.querySelectorAll(SLIDE_SELECTOR));
  }

  function setActive(list, index) {
    for (var i = 0; i < list.length; i++) {
      // Generated and newly inserted slides share the template's geometry.
      list[i].classList.add("deck-slide");
      if (i === index) list[i].setAttribute(ACTIVE_ATTR, "");
      else list[i].removeAttribute(ACTIVE_ATTR);
    }
  }

  function parseHashIndex() {
    var m = /^#slide-(\\d+)/.exec(location.hash || "");
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return isFinite(n) && n > 0 ? n - 1 : 0;
  }

  function writeHash(index) {
    var next = "#slide-" + (index + 1);
    if (location.hash !== next) {
      try { history.replaceState(null, "", next); }
      catch (e) { location.hash = next; }
    }
  }

  function init() {
    var all = slides();
    if (all.length === 0) return;

    var current = Math.min(parseHashIndex(), all.length - 1);
    var stageStyle = document.createElement("style");
    stageStyle.textContent = "@media screen { body[data-deck-ready] [data-slide]:not([data-active]) { display: none; } }";
    document.head.appendChild(stageStyle);
    setActive(all, current);
    writeHash(current);
    globalThis.__BURNGUARD_DECK_RUNTIME__ = { version: 1, slideCount: all.length };
    document.body.setAttribute("data-deck-ready", "");

    var params = new URLSearchParams(location.search || "");
    if (params.has("present") || params.has("presenter")) {
      document.body.setAttribute("data-presenter", "");
    }

    var nav = installNav();

    function refreshNav() {
      var list = slides();
      if (!nav) return;
      // Only write DOM if the values actually changed. Without this guard,
      // each textContent assignment triggers the MutationObserver below,
      // which calls refreshNav again — saturating the main thread and making
      // arrow keys feel like the tab froze.
      var nextLabel = (current + 1) + " / " + Math.max(1, list.length);
      if (nav.count.textContent !== nextLabel) nav.count.textContent = nextLabel;
      var prevDisabled = current <= 0;
      var nextDisabled = current >= list.length - 1;
      if (nav.prev.disabled !== prevDisabled) nav.prev.disabled = prevDisabled;
      if (nav.next.disabled !== nextDisabled) nav.next.disabled = nextDisabled;
    }

    function go(delta) {
      var list = slides();
      if (list.length === 0) return;
      var next = Math.max(0, Math.min(list.length - 1, current + delta));
      if (next === current) return;
      current = next;
      setActive(list, current);
      writeHash(current);
      refreshNav();
    }

    function goTo(index) {
      var list = slides();
      if (list.length === 0) return;
      var next = Math.max(0, Math.min(list.length - 1, index));
      current = next;
      setActive(list, current);
      writeHash(current);
      refreshNav();
    }

    refreshNav();
    if (nav) {
      nav.prev.addEventListener("click", function() { go(-1); });
      nav.next.addEventListener("click", function() { go(1); });
    }

    document.addEventListener("keydown", function(e) {
      var target = e.target;
      if (target && target.nodeType === 1) {
        var el = target;
        if (el.matches && el.matches("input, textarea, [contenteditable='true'], [contenteditable='']")) {
          return;
        }
      }
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(-1);
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(slides().length - 1);
          break;
        case "Escape":
          if (document.body.hasAttribute("data-presenter")) {
            document.body.removeAttribute("data-presenter");
          }
          break;
        case "f":
        case "F":
          e.preventDefault();
          var docEl = document.documentElement;
          if (!document.fullscreenElement && docEl.requestFullscreen) {
            docEl.requestFullscreen();
          } else if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen();
          }
          break;
      }
    });

    // Touch swipe (tablet-friendly).
    var touchX = null;
    document.addEventListener("touchstart", function(e) {
      if (e.touches.length === 1) touchX = e.touches[0].clientX;
    }, { passive: true });
    document.addEventListener("touchend", function(e) {
      if (touchX == null) return;
      var endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : touchX;
      var dx = endX - touchX;
      touchX = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    // If the CLI rewrites the deck mid-session, keep the active attribute
    // on whatever slide lives at the same index (or clamp to last). Skip
    // mutations that originate from our own nav (otherwise the counter
    // update would loop: counter → MO fires → refreshNav → counter → ...).
    var lastSlideCount = all.length;
    var mo = new MutationObserver(function(records) {
      var external = false;
      for (var i = 0; i < records.length; i++) {
        var target = records[i].target;
        if (!(nav && nav.root && nav.root.contains(target))) {
          external = true;
          break;
        }
      }
      if (!external) return;
      var list = slides();
      if (list.length === 0) return;
      if (list.length === lastSlideCount) {
        // Same count — probably an inner edit, not a structural change.
        // Still make sure the active attribute is honored.
        setActive(list, Math.min(current, list.length - 1));
        return;
      }
      lastSlideCount = list.length;
      var idx = Math.min(current, list.length - 1);
      current = idx;
      setActive(list, idx);
      refreshNav();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("hashchange", function() {
      var list = slides();
      var target = Math.min(parseHashIndex(), Math.max(0, list.length - 1));
      if (target !== current) {
        current = target;
        setActive(list, target);
        refreshNav();
      }
    });
  }

  function installNav() {
    // Skip in hosts that don't want the control strip (e.g. print / PDF
    // export). Exporters set ?print=1 or ?nonav=1 on the URL to opt out.
    var params = new URLSearchParams(location.search || "");
    if (params.has("print") || params.has("nonav")) return null;

    // Inject minimal CSS for the nav. Scoped via [data-deck-nav] so the
    // deck's own stylesheet can override if needed.
    var style = document.createElement("style");
    style.setAttribute("data-deck-nav-style", "");
    style.textContent = [
      "[data-deck-nav] {",
      "  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);",
      "  display: inline-flex; align-items: center; gap: 4px;",
      "  padding: 6px 8px; border-radius: 999px;",
      "  background: rgba(17, 24, 33, 0.82); color: #fff;",
      "  font: 500 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
      "  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);",
      "  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);",
      "  opacity: 0; pointer-events: none;",
      "  transition: opacity 180ms ease;",
      "  z-index: 2147483646;",
      "}",
      "[data-deck-nav][data-visible] { opacity: 1; pointer-events: auto; }",
      "[data-deck-nav] button {",
      "  width: 28px; height: 28px; border: 0; border-radius: 50%;",
      "  background: transparent; color: inherit; cursor: pointer;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  font-size: 16px; line-height: 1;",
      "}",
      "[data-deck-nav] button:hover:not(:disabled) { background: rgba(255,255,255,0.12); }",
      "[data-deck-nav] button:disabled { opacity: 0.35; cursor: default; }",
      "[data-deck-nav] .deck-nav-count {",
      "  min-width: 42px; padding: 0 6px; text-align: center;",
      "  font-variant-numeric: tabular-nums; letter-spacing: 0.02em;",
      "  opacity: 0.85;",
      "}",
    ].join("\\n");
    document.head.appendChild(style);

    var nav = document.createElement("nav");
    nav.setAttribute("data-deck-nav", "");
    nav.setAttribute("role", "toolbar");
    nav.setAttribute("aria-label", "Slide navigation");

    var prev = document.createElement("button");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous slide");
    prev.textContent = "\\u2190";

    var count = document.createElement("span");
    count.className = "deck-nav-count";
    count.textContent = "1 / 1";

    var next = document.createElement("button");
    next.type = "button";
    next.setAttribute("aria-label", "Next slide");
    next.textContent = "\\u2192";

    nav.appendChild(prev);
    nav.appendChild(count);
    nav.appendChild(next);
    document.body.appendChild(nav);

    var hideTimer = null;
    function show() {
      nav.setAttribute("data-visible", "");
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function() {
        if (!nav.matches(":hover")) nav.removeAttribute("data-visible");
      }, 1800);
    }
    function hideSoon() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function() { nav.removeAttribute("data-visible"); }, 400);
    }

    document.addEventListener("mousemove", show);
    nav.addEventListener("mouseenter", function() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      nav.setAttribute("data-visible", "");
    });
    nav.addEventListener("mouseleave", hideSoon);

    return { root: nav, prev: prev, next: next, count: count };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;
