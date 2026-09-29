import { describe, expect, test } from "bun:test";
import { checkCssLogos, type CssLogoRuleId } from "../src/services/css-logo-check";

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

  test("Given a page without a marked logo When checked Then nothing is reported", () => {
    expect(checkCssLogos("<svg viewBox='0 0 10 10'><circle r='4'/></svg>")).toEqual([]);
  });
});
