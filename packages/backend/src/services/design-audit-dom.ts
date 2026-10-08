import type { Page } from "playwright-core";
import type { DesignAuditCheckCode, DesignAuditSeverity, DesignAuditTargetedAction, DesignAuditUnknownReason } from "@bg/shared";

/** `fix` is the font-size a minimum-text safe fix may write for this finding; absent when no contract-accepted value fits. */
export type DomAuditFinding = { readonly code: DesignAuditCheckCode; readonly severity: DesignAuditSeverity; readonly nodeId: string | null; readonly evidence: string; readonly measured?: number; readonly threshold?: number; readonly action: DesignAuditTargetedAction; readonly fix?: string };
export type DomAuditObservation = { readonly findings: readonly DomAuditFinding[]; readonly measurable: Readonly<Record<DesignAuditCheckCode, boolean>>; readonly unknownReasons: Readonly<Partial<Record<DesignAuditCheckCode, DesignAuditUnknownReason>>> };

/**
 * journey "desktop" adds the live-page journey checks (layout shift, keyboard focus walk) and restores scroll and
 * focus afterwards; only the design audit asks for it, on a session it closes right after. Other callers, such as
 * the handoff export that screenshots the same page, keep the default "none".
 */
export async function inspectRenderedPage(page: Page, fixedCanvas = false, journey: "none" | "desktop" = "none"): Promise<DomAuditObservation> {
  await page.evaluate(async () => {
    const pending = [...document.images].filter((image) => !image.complete);
    await Promise.all(pending.map((image) => new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        image.removeEventListener("load", done); image.removeEventListener("error", done);
        resolve();
      };
      const timer = setTimeout(done, 5000);
      image.addEventListener("load", done, { once: true }); image.addEventListener("error", done, { once: true });
      image.loading = "eager";
      if (image.complete) done();
    })));
  });
  // A page marks intentional edge motion (a marquee band, copy sliding in from an edge) with data-bg-motion. Such a
  // region is measured at rest, not at the sampled moment: prefers-reduced-motion is emulated, and any animation still
  // running inside the region loses its effect until the inspection ends. The marker is ignored, and reported, where it
  // would cover the page's main content: on html, body or main, around main, or over more than half the page.
  const motionRegions = await page.evaluate(() => {
    const regions: HTMLElement[] = []; const ignored: { element: HTMLElement; evidence: string }[] = [];
    const pageArea = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) * Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    for (const region of document.querySelectorAll<HTMLElement>("[data-bg-motion]")) {
      const rect = region.getBoundingClientRect(); const share = pageArea > 0 ? rect.width * rect.height / pageArea : 1;
      const reason = region.matches("html,body,main,[data-bg-content]") || region.querySelector("main,[data-bg-content]") !== null ? "wraps the page's main content" : share > 0.5 ? `covers ${Math.round(share * 100)}% of the page; a motion region may cover at most 50%` : null;
      if (reason === null) regions.push(region); else ignored.push({ element: region, evidence: `data-bg-motion is ignored on <${region.tagName.toLowerCase()}>: it ${reason}` });
    }
    Reflect.set(window, "__bgMotion", { regions, ignored, effects: [] });
    return regions.length;
  });
  let observation: DomAuditObservation;
  try {
    if (motionRegions > 0) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => {
        const motion = Reflect.get(window, "__bgMotion") as { regions: HTMLElement[]; effects: [Animation, AnimationEffect | null][] };
        for (const animation of document.getAnimations()) {
          const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
          if (target !== null && motion.regions.some((region) => region.contains(target))) { motion.effects.push([animation, animation.effect]); animation.effect = null; }
        }
      });
    }
    observation = await page.evaluate((fixedCanvas) => {
    type Code = "text_overflow" | "element_overlap" | "minimum_text_size" | "contrast" | "narrow_width" | "duplicate_node_id" | "missing_image" | "token_usage" | "site_nav_mismatch" | "site_missing_aria_current" | "site_dangling_link" | "site_missing_shared_block" | "site_root_absolute_asset" | "font_consistency" | "copy_review" | "em_dash_copy" | "eyebrow_density" | "duplicate_cta_intent" | "cta_label_wrap" | "placeholder_copy" | "accent_color_count" | "radius_scale_count" | "repeated_section_structure" | "remote_resources" | "journey_dead_link" | "journey_mobile_nav" | "journey_focus_visible" | "journey_layout_shift";
    type Severity = "must_fix" | "recommended";
    type Action = "expand_or_reflow_text" | "separate_overlapping_elements" | "set_minimum_font_size" | "increase_color_contrast" | "repair_narrow_layout" | "assign_unique_node_ids" | "restore_image_reference" | "replace_literal_with_token" | "repair_site_navigation" | "mark_current_page" | "create_or_repair_site_link" | "add_shared_blocks" | "relativize_asset_path" | "align_font_roles" | "revise_copy" | "keep_cta_label_single_line" | "consolidate_visual_language" | "vary_section_layout" | "bundle_remote_resource" | "add_visible_focus" | "reserve_layout_space";
    type Reason = "no_measurable_candidates" | "unresolvable_rendering" | "tokens_not_exposed";
    type Finding = { code: Code; severity: Severity; nodeId: string | null; evidence: string; measured?: number; threshold?: number; action: Action; fix?: string };
    type Color = readonly [number, number, number, number];
    const findings: Finding[] = [];
    const measurable: Record<Code, boolean> = { text_overflow: false, element_overlap: false, minimum_text_size: false, contrast: false, narrow_width: !fixedCanvas, duplicate_node_id: true, missing_image: true, token_usage: false, site_nav_mismatch: true, site_missing_aria_current: true, site_dangling_link: true, site_missing_shared_block: true, site_root_absolute_asset: true, font_consistency: false, copy_review: false, em_dash_copy: false, eyebrow_density: !fixedCanvas, duplicate_cta_intent: !fixedCanvas, cta_label_wrap: !fixedCanvas, placeholder_copy: false, accent_color_count: true, radius_scale_count: true, repeated_section_structure: !fixedCanvas, remote_resources: true, journey_dead_link: false, journey_mobile_nav: false, journey_focus_visible: false, journey_layout_shift: false };
    const unknownReasons: Partial<Record<Code, Reason>> = { text_overflow: "no_measurable_candidates", element_overlap: "no_measurable_candidates", minimum_text_size: "no_measurable_candidates", contrast: "no_measurable_candidates", token_usage: "tokens_not_exposed", journey_dead_link: "no_measurable_candidates", journey_mobile_nav: "no_measurable_candidates", journey_focus_visible: "no_measurable_candidates", journey_layout_shift: "no_measurable_candidates" };
    const elements = [...document.querySelectorAll<HTMLElement>("body *")];
    const rootStyle = getComputedStyle(document.documentElement);
    const visible = (element: HTMLElement): boolean => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0; };
    const textBearing = (element: HTMLElement): boolean => visible(element) && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0);
    const loadBearing = (element: HTMLElement): boolean => textBearing(element) || element instanceof HTMLImageElement || element.matches("button,a,input,select,textarea,[role=button]");
    const id = (element: Element): string | null => element.getAttribute("data-bg-node-id");
    const push = (element: Element | null, finding: Omit<Finding, "nodeId">): void => { findings.push({ ...finding, nodeId: element === null ? null : id(element), evidence: finding.evidence.slice(0, 500) }); };
    // Accepted motion regions are already at rest; inside one, an aria-hidden copy (a seamless marquee's second set) is decorative.
    const motion = Reflect.get(window, "__bgMotion") as { regions: HTMLElement[]; ignored: { element: HTMLElement; evidence: string }[] } | undefined;
    for (const { element, evidence } of motion?.ignored ?? []) push(element, { code: "text_overflow", severity: "must_fix", evidence, action: "expand_or_reflow_text" });
    const decorative = (element: Element): boolean => { const hidden = element.closest('[aria-hidden="true"]'); return hidden !== null && (motion?.regions ?? []).some((region) => region.contains(hidden)); };

    const textElements = elements.filter(textBearing);
    measurable.font_consistency = textElements.length > 0;
    measurable.copy_review = textElements.length > 0;
    measurable.em_dash_copy = textElements.length > 0;
    measurable.placeholder_copy = textElements.length > 0;
    // Korean literals in the following patterns are generated-copy detection data only; findings emit English evidence.
    const placeholderCopy = /\blorem ipsum\b|\b(?:john|jane)\s+doe\b|\bacme(?:\s+(?:inc|corp(?:oration)?))?\b|홍길동|김철수|이영희|임꺽정|성춘향|아무개/iu;
    // Mono is its own role: a generic monospace stack, or the family the page exposes as --font-mono.
    const normalizeFamily = (value: string): string => value.replace(/["']/gu, "").replace(/\s*,\s*/gu, ",").trim().toLowerCase();
    const monoToken = normalizeFamily(rootStyle.getPropertyValue("--font-mono"));
    const isMono = (family: string): boolean => /(?:^|,)\s*monospace\s*(?:,|$)/iu.test(family) || (monoToken !== "" && normalizeFamily(family) === monoToken);
    const roleFonts = new Map<string, Map<string, HTMLElement[]>>();
    for (const element of textElements) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? "").join(" ").trim();
      if (/\binsert (?:text|title) here\b|여기에\s*(?:내용|텍스트|제목).*입력/iu.test(text) || /^(?:todo|tbd|placeholder)[.!…]*$/iu.test(text)) push(element, { code: "copy_review", severity: "recommended", evidence: "Unfinished placeholder wording remains in visible copy", action: "revise_copy" });
      if (!element.closest("code,pre") && /[—–]/u.test(text)) push(element, { code: "em_dash_copy", severity: "recommended", evidence: "Visible copy uses an em dash or en dash as a separator", action: "revise_copy" });
      if (element.closest("code,pre,svg,[data-bg-font-exception]")) continue;
      const family = getComputedStyle(element).fontFamily;
      const role = element.closest("h1,h2,h3,h4,h5,h6,[role=heading]") ? "heading" : isMono(family) ? "mono" : "body";
      const fonts = roleFonts.get(role) ?? new Map<string, HTMLElement[]>();
      fonts.set(family, [...(fonts.get(family) ?? []), element]); roleFonts.set(role, fonts);
    }
    for (const [role, fonts] of roleFonts) {
      const ordered = [...fonts].sort((a, b) => b[1].length - a[1].length);
      for (const [family, nodes] of ordered.slice(1)) for (const node of nodes) push(node, { code: "font_consistency", severity: "recommended", evidence: `${role} font differs from the shared role stack: ${family}`, action: "align_font_roles" });
    }
    const placeholderElements = elements.filter((element) => {
      if (!visible(element) || element.closest("code,pre") !== null) return false;
      const text = (element.innerText || element.textContent || "").replace(/\s+/gu, " ").trim(); return placeholderCopy.test(text);
    });
    for (const element of placeholderElements) {
      if (placeholderElements.some((candidate) => candidate !== element && element.contains(candidate))) continue;
      push(element, { code: "placeholder_copy", severity: "recommended", evidence: "Visible copy contains placeholder wording or a sample identity", action: "revise_copy" });
    }
    const accentTokens = [...rootStyle].filter((name) => /^--(?:(?:color|theme)-)?(?:accent|brand|primary)$/iu.test(name)).map((name) => ({ name, value: rootStyle.getPropertyValue(name).replace(/\s+/gu, " ").trim().toLocaleLowerCase() })).filter((token) => token.value !== "");
    const accentValues = new Set(accentTokens.map((token) => token.value)); if (accentValues.size > 1) push(document.documentElement, { code: "accent_color_count", severity: "recommended", evidence: `Found ${accentValues.size} distinct primary accent token values across ${accentTokens.map((token) => token.name).join(", ")}`, action: "consolidate_visual_language", measured: accentValues.size, threshold: 1 });

    const radii = new Map<string, HTMLElement>(); for (const element of elements.filter(visible)) {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      for (const value of [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]) {
        const normalized = value.replace(/\s+/gu, " ").trim().toLocaleLowerCase(); const pixels = Number.parseFloat(normalized);
        if (normalized === "" || normalized === "0px" || normalized === "0px 0px" || normalized.includes("%") || Number.isFinite(pixels) && pixels >= Math.min(rect.width, rect.height) / 2 - 0.5) continue; if (!radii.has(normalized)) radii.set(normalized, element);
      }
    }
    if (radii.size > 3) push([...radii.values()][3] ?? null, { code: "radius_scale_count", severity: "recommended", evidence: `Found ${radii.size} distinct non-pill corner radii; keep a scale of at most 3`, action: "consolidate_visual_language", measured: radii.size, threshold: 3 });

    if (!fixedCanvas) {
      const sections = [...new Set([...document.querySelectorAll<HTMLElement>("main section, body > section, [data-section]")])].filter(visible);
      const sectionFamilies = sections.map((section) => { const style = getComputedStyle(section); const tracks = style.gridTemplateColumns === "none" ? 0 : style.gridTemplateColumns.trim().split(/\s+/u).length; const children = [...section.children].filter((child): child is HTMLElement => child instanceof HTMLElement && visible(child)).map((child) => { const childStyle = getComputedStyle(child); const kind = child.matches("picture,img,video,svg,figure,canvas") ? "media" : child.matches("h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote") ? child.tagName.toLocaleLowerCase() : "group"; return `${kind}:${childStyle.display}:${childStyle.position}:${childStyle.gridColumnStart}/${childStyle.gridRowStart}`; }).join(","); return `${style.display}:${tracks}:${style.flexDirection}:${children}`; });
      for (let index = 1; index < sections.length; index += 1) {
        const family = sectionFamilies[index]; if (family === "" || family !== sectionFamilies[index - 1]) continue;
        push(sections[index] ?? null, { code: "repeated_section_structure", severity: "recommended", evidence: `Adjacent sections repeat the ${family} layout family`, action: "vary_section_layout", measured: 2, threshold: 1 });
      }
      const eyebrows: HTMLElement[] = [];
      for (const heading of elements.filter((element) => element.matches("h1,h2,h3,h4,h5,h6,[role=heading]") && visible(element))) {
        const candidate = heading.previousElementSibling;
        if (!(candidate instanceof HTMLElement) || !visible(candidate)) continue;
        const text = candidate.textContent?.trim() ?? "";
        if (text === "" || text.length > 80) continue;
        const style = getComputedStyle(candidate);
        const headingSize = Number.parseFloat(getComputedStyle(heading).fontSize);
        const size = Number.parseFloat(style.fontSize);
        const letterSpacing = Number.parseFloat(style.letterSpacing);
        const letters = text.replace(/[^\p{L}]+/gu, "");
        const uppercase = letters !== "" && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase();
        const smallUppercase = Number.isFinite(size) && Number.isFinite(headingSize) && size < headingSize * 0.75 && uppercase;
        if (smallUppercase || Number.isFinite(letterSpacing) && letterSpacing >= 1) eyebrows.push(candidate);
      }
      const eyebrowLimit = Math.ceil(sections.length / 3);
      if (eyebrows.length > eyebrowLimit) push(eyebrows[eyebrowLimit] ?? eyebrows[0] ?? null, { code: "eyebrow_density", severity: "recommended", evidence: `Found ${eyebrows.length} eyebrow labels across ${sections.length} sections; use at most ${eyebrowLimit}`, action: "revise_copy", measured: eyebrows.length, threshold: eyebrowLimit });

      const primaryActions = elements.filter((element) => visible(element)
        && element.matches('a[href][data-cta="primary"],button[data-cta="primary"],[role=button][data-cta="primary"],a[href][data-primary-cta],button[data-primary-cta],[role=button][data-primary-cta],a[href].primary-cta,button.primary-cta,[role=button].primary-cta,a[href].btn-primary,button.btn-primary,[role=button].btn-primary,a[href].button-primary,button.button-primary,[role=button].button-primary,a[href][class~="primary"],button[class~="primary"],[role=button][class~="primary"]')
        && element.closest("nav,footer") === null);
      const labels = new Map<string, HTMLElement>();
      const hrefs = new Map<string, HTMLElement>();
      const duplicateActions = new Set<HTMLElement>();
      for (const action of primaryActions) {
        const label = (action.getAttribute("aria-label") ?? action.textContent ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        const rawHref = action instanceof HTMLAnchorElement ? action.getAttribute("href")?.trim() ?? "" : "";
        let href = rawHref;
        if (rawHref !== "") {
          try {
            const url = new URL(rawHref, document.baseURI);
            href = url.href;
          } catch {
            href = rawHref;
          }
        }
        if (label !== "") {
          if (labels.has(label)) duplicateActions.add(action);
          else labels.set(label, action);
        }
        if (href !== "") {
          if (hrefs.has(href)) duplicateActions.add(action);
          else hrefs.set(href, action);
        }
        const range = document.createRange(); range.selectNodeContents(action);
        const lineTops = new Set([...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => Math.round(rect.top * 10) / 10)); if (lineTops.size > 1) push(action, { code: "cta_label_wrap", severity: "recommended", evidence: `Primary call-to-action label wraps across ${lineTops.size} rendered lines`, action: "keep_cta_label_single_line", measured: lineTops.size, threshold: 1 });
      }
      for (const action of duplicateActions) push(action, { code: "duplicate_cta_intent", severity: "recommended", evidence: "A primary call to action repeats an earlier label or destination", action: "revise_copy", measured: 2, threshold: 1 });
    }
    measurable.text_overflow = textElements.length > 0;
    measurable.minimum_text_size = textElements.length > 0;
    if (textElements.length > 0) { delete unknownReasons.text_overflow; delete unknownReasons.minimum_text_size; }
    const slideCaptionToken = rootStyle.getPropertyValue("--slide-type-caption").trim() !== "";
    const contentCaption = Number.parseFloat(rootStyle.getPropertyValue("--content-type-caption"));
    const contentBase = Number.parseFloat(rootStyle.getPropertyValue("--content-base"));
    const floors = new Map<Element, number>();
    // A graphic artboard's floor is its caption step scaled by the frame's short side, never below the 12px content floor.
    const artboardFloor = (artboard: HTMLElement): number => {
      const cached = floors.get(artboard); if (cached !== undefined) return cached;
      const rect = artboard.getBoundingClientRect(); const base = Number.isFinite(contentBase) && contentBase > 0 ? contentBase : 1080;
      const scaled = Number.isFinite(contentCaption) && contentCaption > 0 ? contentCaption * Math.min(rect.width, rect.height) / base : 12;
      const floor = Math.max(12, Math.floor(scaled * 100) / 100); floors.set(artboard, floor); return floor;
    };
    for (const element of textElements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const canvas = element.closest<HTMLElement>("[data-slide],[data-graphic-artboard]")?.getBoundingClientRect();
      const bounds = canvas ?? { left: 0, right: document.documentElement.clientWidth, top: 0, bottom: fixedCanvas ? window.innerHeight : Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) };
      // Scroll dimensions include visible ink outside tight line boxes; only clipped axes lose text.
      const clips = (overflow: string): boolean => overflow !== "visible";
      let clipped = (clips(style.overflowX) && element.scrollWidth > element.clientWidth + 1) || (clips(style.overflowY) && element.scrollHeight > element.clientHeight + 1);
      const range = document.createRange(); range.selectNodeContents(element);
      const textRect = range.getBoundingClientRect();
      for (let parent = element.parentElement; parent !== null && !clipped; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent); const parentRect = parent.getBoundingClientRect();
        clipped = (clips(parentStyle.overflowX) && (textRect.left < parentRect.left - 1 || textRect.right > parentRect.right + 1)) || (clips(parentStyle.overflowY) && (textRect.top < parentRect.top - 1 || textRect.bottom > parentRect.bottom + 1));
      }
      if (!decorative(element) && (clipped || Math.min(rect.left, textRect.left) < bounds.left - 1 || Math.max(rect.right, textRect.right) > bounds.right + 1 || Math.min(rect.top, textRect.top) < bounds.top - 1 || Math.max(rect.bottom, textRect.bottom) > bounds.bottom + 1)) push(element, { code: "text_overflow", severity: "must_fix", evidence: "Text geometry exceeds clipping or page bounds", action: "expand_or_reflow_text" });
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      const slide = element.closest("[data-slide]") !== null; const artboard = element.closest<HTMLElement>("[data-graphic-artboard]");
      const minimum = slide ? 24 : artboard === null ? 12 : artboardFloor(artboard);
      if (Number.isFinite(size) && size < minimum) {
        const fix = slide ? (slideCaptionToken ? "var(--slide-type-caption)" : "24px") : minimum === 12 ? "12px" : minimum === 24 ? "24px" : undefined;
        push(element, { code: "minimum_text_size", severity: "recommended", evidence: `Rendered font size is ${size}px; minimum is ${minimum}px`, action: "set_minimum_font_size", measured: size, threshold: minimum, ...(fix === undefined ? {} : { fix }) });
      }
    }

    const counts = new Map<string, number>();
    for (const element of elements) { const nodeId = id(element); if (nodeId !== null) counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1); }
    for (const [nodeId, count] of [...counts].sort(([left], [right]) => left.localeCompare(right))) if (count > 1) push(document.querySelector(`[data-bg-node-id="${CSS.escape(nodeId)}"]`), { code: "duplicate_node_id", severity: "must_fix", evidence: `data-bg-node-id ${nodeId} occurs ${count} times`, action: "assign_unique_node_ids", measured: count, threshold: 1 });

    const positioned = elements.filter((element) => visible(element) && loadBearing(element) && getComputedStyle(element).position !== "static" && id(element) !== null && counts.get(id(element) ?? "") === 1);
    measurable.element_overlap = false;
    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
      const left = positioned[leftIndex]; const right = positioned[rightIndex];
      if (left === undefined || right === undefined || left.parentElement !== right.parentElement) continue;
      measurable.element_overlap = true; delete unknownReasons.element_overlap;
      const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect(); const width = Math.min(a.right, b.right) - Math.max(a.left, b.left); const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (width > 1 && height > 1) push(left, { code: "element_overlap", severity: "recommended", evidence: `Overlaps sibling ${id(right) ?? "unknown"} by ${Math.round(width * height)}px2`, action: "separate_overlapping_elements", measured: Math.round(width * height), threshold: 0 });
    }

    const parseColor = (value: string): Color | null => { const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/u); return match?.[1] === undefined || match[2] === undefined || match[3] === undefined ? null : [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]; };
    const parseHex = (value: string): Color | null => { const hex = value.slice(1); if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/iu.test(hex)) return null; const wide = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex; const channel = (index: number): number => Number.parseInt(wide.slice(index * 2, index * 2 + 2), 16); return [channel(0), channel(1), channel(2), wide.length === 8 ? channel(3) / 255 : 1]; };
    const luminance = (color: Color): number => { const channels = color.slice(0, 3).map((part) => { const value = part / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }); return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0); };
    const contrast = (first: Color, second: Color): number => { const a = luminance(first); const b = luminance(second); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    // A single linear-/radial-gradient whose every stop is an opaque rgb()/hex colour resolves to its stops; any other image stays unresolvable.
    const gradientStops = (image: string): readonly Color[] | null => {
      const inner = image.match(/^(?:linear|radial)-gradient\((.*)\)$/su)?.[1];
      if (inner === undefined) return null;
      const segments: string[] = []; let depth = 0; let start = 0;
      for (let index = 0; index < inner.length; index += 1) { const char = inner[index]; if (char === "(") depth += 1; else if (char === ")") depth -= 1; else if (char === "," && depth === 0) { segments.push(inner.slice(start, index).trim()); start = index + 1; } }
      segments.push(inner.slice(start).trim());
      const stops: Color[] = [];
      for (const [index, segment] of segments.entries()) {
        const match = segment.match(/^(rgba?\([^)]*\)|#[0-9a-f]{3,8})(?:\s+[\d.]+(?:%|px|em|rem))*$/iu);
        if (match?.[1] === undefined) { if (index === 0 && !/rgb|#/iu.test(segment)) continue; return null; }
        const color = match[1].startsWith("#") ? parseHex(match[1]) : parseColor(match[1]);
        if (color === null || color[3] !== 1) return null;
        stops.push(color);
      }
      return stops.length >= 2 ? stops : null;
    };
    let contrastUnresolved = false;
    for (const element of textElements) {
      const style = getComputedStyle(element); const foreground = parseColor(style.color); let current: HTMLElement | null = element; let background: Color | null = null;
      while (current !== null && background === null) {
        const currentStyle = getComputedStyle(current);
        if (currentStyle.backgroundImage !== "none") {
          const stops = foreground === null ? null : gradientStops(currentStyle.backgroundImage);
          if (stops === null || foreground === null) { contrastUnresolved = true; break; }
          background = stops.reduce((worst, stop) => contrast(foreground, stop) < contrast(foreground, worst) ? stop : worst);
          break;
        }
        const parsed = parseColor(currentStyle.backgroundColor); if (parsed !== null && parsed[3] > 0 && parsed[3] < 1) { contrastUnresolved = true; break; } if (parsed !== null && parsed[3] === 1) background = parsed; current = current.parentElement;
      }
      if (foreground === null || foreground[3] !== 1 || background === null) { contrastUnresolved = true; continue; }
      measurable.contrast = true; const ratio = contrast(foreground, background); const size = Number.parseFloat(style.fontSize); const weight = Number.parseInt(style.fontWeight, 10); const threshold = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (ratio < threshold) push(element, { code: "contrast", severity: "must_fix", evidence: `Contrast ratio ${ratio.toFixed(2)} is below ${threshold.toFixed(1)}`, action: "increase_color_contrast", measured: Number(ratio.toFixed(2)), threshold });
    }
    if (contrastUnresolved) { measurable.contrast = false; unknownReasons.contrast = "unresolvable_rendering"; } else if (measurable.contrast) delete unknownReasons.contrast;

    // A fixed canvas is its own viewport: a deliberate full-bleed figure on a banner is not a narrow-layout escape.
    if (!fixedCanvas) {
      const viewport = document.documentElement.clientWidth; const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewport;
      if (viewport <= 375 && overflow > 1) push(null, { code: "narrow_width", severity: "must_fix", evidence: `Document exceeds narrow viewport by ${Math.round(overflow)}px`, action: "repair_narrow_layout", measured: Math.round(overflow), threshold: 0 });
      if (viewport <= 375) for (const element of elements.filter((candidate) => visible(candidate) && loadBearing(candidate) && !decorative(candidate))) { const rect = element.getBoundingClientRect(); if (rect.left < -1 || rect.right > viewport + 1) push(element, { code: "narrow_width", severity: "must_fix", evidence: `Element escapes 375px viewport at ${Math.round(rect.left)}..${Math.round(rect.right)}`, action: "repair_narrow_layout" }); }

      // Journey: a visible link must lead somewhere - a page, a URL or an element on this page.
      const anchors = elements.filter((element): element is HTMLAnchorElement => element instanceof HTMLAnchorElement && visible(element));
      measurable.journey_dead_link = anchors.length > 0;
      if (anchors.length > 0) delete unknownReasons.journey_dead_link;
      let deadLinks = 0;
      for (const anchor of anchors) {
        const href = anchor.getAttribute("href")?.trim() ?? null;
        const fragment = href !== null && href.startsWith("#") && href.length > 1 ? (() => { try { return decodeURIComponent(href.slice(1)); } catch { return href.slice(1); } })() : null;
        // The current-page marker without a link, a JavaScript-driven button and "#top" (which scrolls to the top by
        // definition) are deliberate, not dead ends.
        if ((href === null && anchor.hasAttribute("aria-current")) || anchor.getAttribute("role") === "button" || (href !== null && href.toLowerCase() === "#top")) continue;
        const reason = href === null ? "has no href" : href === "" || href === "#" ? `points to "${href}"` : /^javascript:/iu.test(href) ? "uses a javascript: URL" : fragment !== null && document.getElementById(fragment) === null && document.getElementsByName(fragment).length === 0 ? `targets #${fragment.slice(0, 60)}, which is not on the page` : null;
        if (reason === null || deadLinks >= 20) continue;
        deadLinks += 1;
        const label = (anchor.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60);
        push(anchor, { code: "journey_dead_link", severity: "recommended", evidence: `Link "${label}" ${reason}`, action: "create_or_repair_site_link" });
      }

      // Journey: on a phone the navigation's visible links must fit inside it without sideways scrolling or clipping.
      if (viewport <= 375) {
        // A closed off-canvas drawer lies wholly outside the viewport; it is not the navigation a visitor sees.
        const navs = [...document.querySelectorAll<HTMLElement>("nav, [role=navigation]")].filter((nav) => { const box = nav.getBoundingClientRect(); return visible(nav) && nav.parentElement?.closest("nav, [role=navigation]") == null && box.right > 0 && box.left < viewport; });
        measurable.journey_mobile_nav = navs.length > 0;
        if (navs.length > 0) delete unknownReasons.journey_mobile_nav;
        for (const nav of navs) {
          const box = nav.getBoundingClientRect();
          const links = [...nav.querySelectorAll<HTMLElement>("a, button")].filter(visible);
          const outside = links.filter((link) => { const rect = link.getBoundingClientRect(); return rect.left < Math.max(0, box.left) - 1 || rect.right > Math.min(viewport, box.right) + 1; }).length;
          const scrolls = nav.scrollWidth > nav.clientWidth + 1;
          if (outside > 0 || scrolls) push(nav, { code: "journey_mobile_nav", severity: "recommended", evidence: `Navigation at ${viewport}px ${scrolls ? `scrolls sideways by ${nav.scrollWidth - nav.clientWidth}px` : "does not scroll"} and ${outside} of ${links.length} visible links fall outside its visible box`, action: "repair_narrow_layout", measured: outside, threshold: 0 });
        }
      }
    }

    for (const image of document.images) if (!image.complete || image.naturalWidth === 0 || image.currentSrc.length === 0) { const raw = image.getAttribute("src") ?? "missing src"; let safe = raw; try { const url = new URL(raw, location.href); safe = url.protocol === "file:" ? raw : `${url.protocol}//${url.host}${url.pathname}`; } catch { safe = "invalid image reference"; } push(image, { code: "missing_image", severity: "must_fix", evidence: `Image reference failed: ${safe}`, action: "restore_image_reference" }); }
    measurable.token_usage = [...rootStyle].some((name) => name.startsWith("--")); if (measurable.token_usage) delete unknownReasons.token_usage;
    if (measurable.token_usage) for (const element of elements) { const inline = element.getAttribute("style") ?? ""; const match = inline.match(/(?:^|;)\s*(?:color|background(?:-color)?|border(?:-[\w-]+)?-color)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/iu); if (match?.[1] !== undefined) push(element, { code: "token_usage", severity: "recommended", evidence: `Inline literal color ${match[1]} bypasses exposed design tokens`, action: "replace_literal_with_token" }); }
    // Same-origin stylesheet rules, bounded to 2000 rules: only the three colour properties, never :root/html declarations.
    // At most 20 rule findings per page plus one anchorless summary, so a literal-heavy stylesheet cannot crowd out the page's other findings.
    if (measurable.token_usage) {
      const literal = /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/iu; let budget = 2000; let reported = 0; let summarized = 0;
      const scan = (rules: CSSRuleList): void => {
        for (const rule of rules) {
          if (budget <= 0) return; budget -= 1;
          if (rule instanceof CSSStyleRule) {
            if (/(?:^|,)\s*(?::root|html)\b/iu.test(rule.selectorText)) continue;
            for (const property of ["color", "background-color", "border-color"]) {
              const value = rule.style.getPropertyValue(property).trim(); if (!literal.test(value)) continue;
              if (reported >= 20) { summarized += 1; continue; }
              reported += 1;
              let target: Element | null = null; try { target = document.querySelector(rule.selectorText); } catch { target = null; }
              push(target, { code: "token_usage", severity: "recommended", evidence: `Stylesheet rule ${rule.selectorText} sets ${property}: ${value}, bypassing exposed design tokens`, action: "replace_literal_with_token" });
            }
          } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) scan(rule.cssRules);
        }
      };
      for (const sheet of document.styleSheets) { let rules: CSSRuleList; try { rules = sheet.cssRules; } catch { continue; } scan(rules); }
      if (summarized > 0) push(null, { code: "token_usage", severity: "recommended", evidence: `${summarized} further stylesheet declarations set literal colours, bypassing exposed design tokens`, action: "replace_literal_with_token" });
    }
    return { findings, measurable, unknownReasons };
  }, fixedCanvas);
  } finally {
    await page.evaluate(() => {
      const motion = Reflect.get(window, "__bgMotion") as { effects: [Animation, AnimationEffect | null][] } | undefined;
      for (const [animation, effect] of motion?.effects ?? []) animation.effect = effect;
      Reflect.deleteProperty(window, "__bgMotion");
    });
    if (motionRegions > 0) await page.emulateMedia({ reducedMotion: null });
  }
  return fixedCanvas || journey === "none" ? observation : await inspectJourney(page, observation);
}

/** Cumulative layout shift above this value is reported; it is the "good" limit for page experience. */
const LAYOUT_SHIFT_LIMIT = 0.1;
const MAX_FOCUS_STOPS = 20;

/**
 * Journey checks that need the live page rather than one DOM snapshot: layout shift recorded by the browser's
 * PerformanceObserver since navigation, and the focus indicator of the first keyboard stops reached with Tab.
 */
async function inspectJourney(page: Page, observation: DomAuditObservation): Promise<DomAuditObservation> {
  const findings = [...observation.findings];
  const measurable = { ...observation.measurable };
  const unknownReasons = { ...observation.unknownReasons };
  const shift = await page.evaluate(() => new Promise<number | null>((resolve) => {
    if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) { resolve(null); return; }
    let total = 0;
    // Every entry counts: the audit sends no input before this point, and automation can flag load-time shifts as
    // following recent input, which would hide exactly the shifts a visitor sees.
    const add = (entries: PerformanceEntryList) => { for (const entry of entries) total += Number(Reflect.get(entry, "value")) || 0; };
    const observer = new PerformanceObserver((list) => add(list.getEntries()));
    observer.observe({ type: "layout-shift", buffered: true });
    // Buffered entries are delivered in a task after observe(); two frames later they have all arrived. A page that
    // produces no frames still settles through the bounded fallback.
    let settled = false;
    const finish = () => { if (settled) return; settled = true; add(observer.takeRecords()); observer.disconnect(); resolve(total); };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 1_000);
  }));
  if (shift !== null) {
    measurable.journey_layout_shift = true;
    delete unknownReasons.journey_layout_shift;
    const rounded = Math.round(shift * 1000) / 1000;
    if (rounded > LAYOUT_SHIFT_LIMIT) findings.push({ code: "journey_layout_shift", severity: "recommended", nodeId: null, evidence: `Content moved while the page loaded: cumulative layout shift ${rounded} (PerformanceObserver)`, measured: rounded, threshold: LAYOUT_SHIFT_LIMIT, action: "reserve_layout_space" });
  }
  // Keyboard focus is only reached by real Tab presses; each stop is compared with its own unfocused style.
  const stops = await page.evaluate((max) => {
    const focusable = [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, [tabindex]")].filter((element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return element.tabIndex >= 0 && !element.hasAttribute("disabled") && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    }).slice(0, max);
    const look = (element: HTMLElement) => { const style = getComputedStyle(element); return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.borderColor, style.backgroundColor, style.color, style.textDecorationLine].join("|"); };
    const baseline = new Map(focusable.map((element) => [element, look(element)]));
    Reflect.set(window, "__bgFocusBaseline", baseline);
    (document.activeElement as HTMLElement | null)?.blur?.();
    return focusable.length;
  }, MAX_FOCUS_STOPS);
  if (stops > 0) {
    measurable.journey_focus_visible = true;
    delete unknownReasons.journey_focus_visible;
    const unmarked: (string | null)[] = [];
    for (let index = 0; index < stops; index += 1) {
      await page.keyboard.press("Tab");
      const result = await page.evaluate(() => {
        const active = document.activeElement;
        const baseline = Reflect.get(window, "__bgFocusBaseline") as Map<Element, string> | undefined;
        if (!(active instanceof HTMLElement) || baseline === undefined || !baseline.has(active)) return null;
        const style = getComputedStyle(active);
        const now = [style.outlineStyle, style.outlineWidth, style.outlineColor, style.boxShadow, style.borderColor, style.backgroundColor, style.color, style.textDecorationLine].join("|");
        const outlined = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
        return { nodeId: active.getAttribute("data-bg-node-id"), label: (active.getAttribute("aria-label") ?? active.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60), marked: outlined || now !== baseline.get(active) };
      });
      if (result !== null && !result.marked && unmarked.length < 20) {
        unmarked.push(result.nodeId);
        findings.push({ code: "journey_focus_visible", severity: "recommended", nodeId: result.nodeId, evidence: `Keyboard focus on "${result.label}" shows no outline or style change`, action: "add_visible_focus" });
      }
    }
  }
  // The walk leaves focus on the last stop and the page scrolled to it; put both back for anything that reads the page next.
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); Reflect.deleteProperty(window, "__bgFocusBaseline"); window.scrollTo(0, 0); });
  return { findings, measurable, unknownReasons };
}
