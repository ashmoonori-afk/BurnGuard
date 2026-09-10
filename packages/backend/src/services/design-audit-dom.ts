import type { Page } from "playwright-core";
import type { DesignAuditCheckCode, DesignAuditSeverity, DesignAuditTargetedAction, DesignAuditUnknownReason } from "@bg/shared";

export type DomAuditFinding = { readonly code: DesignAuditCheckCode; readonly severity: DesignAuditSeverity; readonly nodeId: string | null; readonly evidence: string; readonly measured?: number; readonly threshold?: number; readonly action: DesignAuditTargetedAction };
export type DomAuditObservation = { readonly findings: readonly DomAuditFinding[]; readonly measurable: Readonly<Record<DesignAuditCheckCode, boolean>>; readonly unknownReasons: Readonly<Partial<Record<DesignAuditCheckCode, DesignAuditUnknownReason>>> };

export async function inspectRenderedPage(page: Page, fixedCanvas = false): Promise<DomAuditObservation> {
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
  return page.evaluate((fixedCanvas) => {
    type Code = "text_overflow" | "element_overlap" | "minimum_text_size" | "contrast" | "narrow_width" | "duplicate_node_id" | "missing_image" | "token_usage" | "site_nav_mismatch" | "site_missing_aria_current" | "site_dangling_link" | "site_missing_shared_block" | "site_root_absolute_asset" | "font_consistency" | "copy_review";
    type Severity = "must_fix" | "recommended";
    type Action = "expand_or_reflow_text" | "separate_overlapping_elements" | "set_minimum_font_size" | "increase_color_contrast" | "repair_narrow_layout" | "assign_unique_node_ids" | "restore_image_reference" | "replace_literal_with_token" | "repair_site_navigation" | "mark_current_page" | "create_or_repair_site_link" | "add_shared_blocks" | "relativize_asset_path" | "align_font_roles" | "revise_copy";
    type Reason = "no_measurable_candidates" | "unresolvable_rendering" | "tokens_not_exposed";
    type Finding = { code: Code; severity: Severity; nodeId: string | null; evidence: string; measured?: number; threshold?: number; action: Action };
    const findings: Finding[] = [];
    const measurable: Record<Code, boolean> = { text_overflow: false, element_overlap: false, minimum_text_size: false, contrast: false, narrow_width: true, duplicate_node_id: true, missing_image: true, token_usage: false, site_nav_mismatch: true, site_missing_aria_current: true, site_dangling_link: true, site_missing_shared_block: true, site_root_absolute_asset: true, font_consistency: false, copy_review: false };
    const unknownReasons: Partial<Record<Code, Reason>> = { text_overflow: "no_measurable_candidates", element_overlap: "no_measurable_candidates", minimum_text_size: "no_measurable_candidates", contrast: "no_measurable_candidates", token_usage: "tokens_not_exposed" };
    const elements = [...document.querySelectorAll<HTMLElement>("body *")];
    const visible = (element: HTMLElement): boolean => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0; };
    const textBearing = (element: HTMLElement): boolean => visible(element) && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim().length ?? 0) > 0);
    const loadBearing = (element: HTMLElement): boolean => textBearing(element) || element instanceof HTMLImageElement || element.matches("button,a,input,select,textarea,[role=button]");
    const id = (element: Element): string | null => element.getAttribute("data-bg-node-id");
    const push = (element: Element | null, finding: Omit<Finding, "nodeId">): void => { findings.push({ ...finding, nodeId: element === null ? null : id(element), evidence: finding.evidence.slice(0, 500) }); };

    const textElements = elements.filter(textBearing);
    measurable.font_consistency = textElements.length > 0;
    measurable.copy_review = textElements.length > 0;
    const roleFonts = new Map<string, Map<string, HTMLElement[]>>();
    for (const element of textElements) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent ?? "").join(" ").trim();
      if (/\b(?:lorem ipsum|insert (?:text|title) here|placeholder|todo|tbd)\b|여기에\s*(?:내용|텍스트|제목).*입력/iu.test(text)) push(element, { code: "copy_review", severity: "recommended", evidence: "Unfinished placeholder wording remains in visible copy", action: "revise_copy" });
      if (element.closest("code,pre,svg,[data-bg-font-exception]")) continue;
      const role = element.closest("h1,h2,h3,h4,h5,h6,[role=heading]") ? "heading" : "body";
      const family = getComputedStyle(element).fontFamily;
      const fonts = roleFonts.get(role) ?? new Map<string, HTMLElement[]>();
      fonts.set(family, [...(fonts.get(family) ?? []), element]); roleFonts.set(role, fonts);
    }
    for (const [role, fonts] of roleFonts) {
      const ordered = [...fonts].sort((a, b) => b[1].length - a[1].length);
      for (const [family, nodes] of ordered.slice(1)) for (const node of nodes) push(node, { code: "font_consistency", severity: "recommended", evidence: `${role} font differs from the shared role stack: ${family}`, action: "align_font_roles" });
    }
    measurable.text_overflow = textElements.length > 0;
    measurable.minimum_text_size = textElements.length > 0;
    if (textElements.length > 0) { delete unknownReasons.text_overflow; delete unknownReasons.minimum_text_size; }
    for (const element of textElements) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const canvas = element.closest<HTMLElement>("[data-slide]")?.getBoundingClientRect();
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
      if (clipped || Math.min(rect.left, textRect.left) < bounds.left - 1 || Math.max(rect.right, textRect.right) > bounds.right + 1 || Math.min(rect.top, textRect.top) < bounds.top - 1 || Math.max(rect.bottom, textRect.bottom) > bounds.bottom + 1) push(element, { code: "text_overflow", severity: "must_fix", evidence: "Text geometry exceeds clipping or page bounds", action: "expand_or_reflow_text" });
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      const minimum = element.closest("[data-slide]") ? 24 : 12;
      if (Number.isFinite(size) && size < minimum) push(element, { code: "minimum_text_size", severity: "recommended", evidence: `Rendered font size is ${size}px; minimum is ${minimum}px`, action: "set_minimum_font_size", measured: size, threshold: minimum });
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

    const parseColor = (value: string): readonly [number, number, number, number] | null => { const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/u); return match?.[1] === undefined || match[2] === undefined || match[3] === undefined ? null : [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]; };
    const luminance = (color: readonly [number, number, number, number]): number => { const channels = color.slice(0, 3).map((part) => { const value = part / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }); return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0); };
    let contrastUnresolved = false;
    for (const element of textElements) {
      const style = getComputedStyle(element); const foreground = parseColor(style.color); let current: HTMLElement | null = element; let background: readonly [number, number, number, number] | null = null;
      while (current !== null && background === null) { const currentStyle = getComputedStyle(current); if (currentStyle.backgroundImage !== "none") { contrastUnresolved = true; break; } const parsed = parseColor(currentStyle.backgroundColor); if (parsed !== null && parsed[3] > 0 && parsed[3] < 1) { contrastUnresolved = true; break; } if (parsed !== null && parsed[3] === 1) background = parsed; current = current.parentElement; }
      if (foreground === null || foreground[3] !== 1 || background === null) { contrastUnresolved = true; continue; }
      measurable.contrast = true; const first = luminance(foreground); const second = luminance(background); const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05); const size = Number.parseFloat(style.fontSize); const weight = Number.parseInt(style.fontWeight, 10); const threshold = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (ratio < threshold) push(element, { code: "contrast", severity: "must_fix", evidence: `Contrast ratio ${ratio.toFixed(2)} is below ${threshold.toFixed(1)}`, action: "increase_color_contrast", measured: Number(ratio.toFixed(2)), threshold });
    }
    if (contrastUnresolved) { measurable.contrast = false; unknownReasons.contrast = "unresolvable_rendering"; } else if (measurable.contrast) delete unknownReasons.contrast;

    const viewport = document.documentElement.clientWidth; const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewport;
    if (viewport <= 375 && overflow > 1) push(null, { code: "narrow_width", severity: "must_fix", evidence: `Document exceeds narrow viewport by ${Math.round(overflow)}px`, action: "repair_narrow_layout", measured: Math.round(overflow), threshold: 0 });
    if (viewport <= 375) for (const element of elements.filter((candidate) => visible(candidate) && loadBearing(candidate))) { const rect = element.getBoundingClientRect(); if (rect.left < -1 || rect.right > viewport + 1) push(element, { code: "narrow_width", severity: "must_fix", evidence: `Element escapes 375px viewport at ${Math.round(rect.left)}..${Math.round(rect.right)}`, action: "repair_narrow_layout" }); }

    for (const image of document.images) if (!image.complete || image.naturalWidth === 0 || image.currentSrc.length === 0) { const raw = image.getAttribute("src") ?? "missing src"; let safe = raw; try { const url = new URL(raw, location.href); safe = url.protocol === "file:" ? raw : `${url.protocol}//${url.host}${url.pathname}`; } catch { safe = "invalid image reference"; } push(image, { code: "missing_image", severity: "must_fix", evidence: `Image reference failed: ${safe}`, action: "restore_image_reference" }); }
    const rootStyle = getComputedStyle(document.documentElement); measurable.token_usage = [...rootStyle].some((name) => name.startsWith("--")); if (measurable.token_usage) delete unknownReasons.token_usage;
    if (measurable.token_usage) for (const element of elements) { const inline = element.getAttribute("style") ?? ""; const match = inline.match(/(?:^|;)\s*(?:color|background(?:-color)?|border(?:-[\w-]+)?-color)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/iu); if (match?.[1] !== undefined) push(element, { code: "token_usage", severity: "recommended", evidence: `Inline literal color ${match[1]} bypasses exposed design tokens`, action: "replace_literal_with_token" }); }
    return { findings, measurable, unknownReasons };
  }, fixedCanvas);
}
