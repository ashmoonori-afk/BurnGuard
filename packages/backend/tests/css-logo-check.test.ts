import { describe, expect, test } from "bun:test";
import { checkCssLogos, type CssLogoRuleId, type CssLogoRuleResult } from "../src/services/css-logo-check";

const rule = (html: string, id: CssLogoRuleId): CssLogoRuleResult | undefined => checkCssLogos(html)[0]?.find((result) => result.rule === id);

const statuses = (html: string): Record<CssLogoRuleId, string> => {
  const [logo] = checkCssLogos(html);
  return Object.fromEntries(logo!.map((result) => [result.rule, result.status])) as Record<CssLogoRuleId, string>;
};

describe("CSS logo construction check", () => {
  test("Given a monoline grid mark with two token colours When checked Then every measurable rule passes and judgement rules stay self-checks", () => {
    const html = `<header><svg data-bg-css-logo role="img" aria-label="Acme" viewBox="0 0 48 48" fill="none" stroke="var(--brand-ink)" stroke-width="4" stroke-linejoin="round">
      <circle cx="24" cy="24" r="18"/><polyline points="8,32 24,16 40,32"/><line x1="16" y1="28" x2="32" y2="28" stroke="var(--brand-accent)"/></svg></header>`;
    expect(statuses(html)).toEqual({
      LOGO_FORM: "pass", LOGO_LINE: "pass", LOGO_NEGATIVE_SPACE: "self_check", LOGO_GRID: "pass",
      LOGO_COUNTERS: "pass", LOGO_COLOR: "pass", LOGO_SIMPLIFY: "self_check",
    });
  });

  test("Given edges at 0, 45 and 90 degrees When checked Then the grid rule passes", () => {
    const html = `<svg data-bg-css-logo viewBox="0 0 32 32" fill="currentColor"><polygon points="0,0 16,16 32,0"/><rect x="0" y="20" width="32" height="8"/></svg>`;
    expect(statuses(html).LOGO_GRID).toBe("pass");
  });

  test("Given a busy multi-weight, multi-colour mark When checked Then form, line, counters and colour fail", () => {
    const shapes = Array.from({ length: 6 }, (_, index) => `<circle cx="${index * 10}" cy="10" r="4" stroke="#${index}${index}0000" stroke-width="${index === 0 ? 0.5 : 2}"/>`).join("");
    const html = `<svg data-bg-css-logo viewBox="0 0 64 64" fill="none"><rect x="0" y="0" width="8" height="8" rx="2"/><polygon points="0,0 8,0 8,8"/>${shapes}</svg>`;
    const result = statuses(html);
    expect(result.LOGO_FORM).toBe("fail");
    expect(result.LOGO_LINE).toBe("fail");
    expect(result.LOGO_COUNTERS).toBe("fail");
    expect(result.LOGO_COLOR).toBe("fail");
  });

  test("Given a monoline mark of a rounded square and round-capped lines When LOGO_LINE is measured Then it passes because a line has no corner to vote with", () => {
    const html = `<svg data-bg-css-logo role="img" aria-label="Acme" viewBox="0 0 48 48" fill="none" stroke="var(--brand-ink)" stroke-width="4" stroke-linecap="round">
      <rect x="6" y="6" width="36" height="36" rx="8"/><line x1="16" y1="24" x2="32" y2="24"/><line x1="24" y1="16" x2="24" y2="32"/></svg>`;
    expect(rule(html, "LOGO_LINE")).toEqual({ rule: "LOGO_LINE", status: "pass", measured: 1, limit: 1 });
  });

  test("Given a rounded square and a two-point polyline without joins When LOGO_LINE is measured Then the open polyline ends do not vote a sharp corner", () => {
    const html = `<svg data-bg-css-logo viewBox="0 0 48 48" fill="none" stroke="var(--brand-ink)" stroke-width="4" stroke-linecap="round">
      <rect x="6" y="6" width="36" height="36" rx="8"/><polyline points="16,24 32,24"/></svg>`;
    expect(rule(html, "LOGO_LINE")).toEqual({ rule: "LOGO_LINE", status: "pass", measured: 1, limit: 1 });
  });

  test("Given a rounded square and a polyline with a mitred join When LOGO_LINE is measured Then the join still votes sharp and the rule fails", () => {
    const html = `<svg data-bg-css-logo viewBox="0 0 48 48" fill="none" stroke="var(--brand-ink)" stroke-width="4" stroke-linecap="round">
      <rect x="6" y="6" width="36" height="36" rx="8"/><polyline points="8,32 24,16 40,32"/></svg>`;
    expect(rule(html, "LOGO_LINE")).toEqual({ rule: "LOGO_LINE", status: "fail", measured: 2, limit: 1 });
  });

  test("Given a mark painted only by a page CSS rule When checked Then colour and line are self-checks instead of a zero-colour failure", () => {
    const html = `<style>.mark path { fill: var(--brand-primary); }</style>
      <svg class="mark" data-bg-css-logo role="img" aria-label="Acme" viewBox="0 0 32 32"><path d="M0 0H32V32H0Z"/></svg>`;
    expect(rule(html, "LOGO_COLOR")).toEqual({ rule: "LOGO_COLOR", status: "self_check" });
    expect(rule(html, "LOGO_LINE")).toEqual({ rule: "LOGO_LINE", status: "self_check" });
  });

  test("Given a page without a marked logo When checked Then nothing is reported", () => {
    expect(checkCssLogos("<svg viewBox='0 0 10 10'><circle r='4'/></svg>")).toEqual([]);
  });
});
