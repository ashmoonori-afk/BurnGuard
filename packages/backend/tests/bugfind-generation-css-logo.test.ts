import { describe, expect, test } from "bun:test";
import { checkCssLogos, type CssLogoRuleResult, type CssLogoRuleId } from "../src/services/css-logo-check";

const rule = (html: string, id: CssLogoRuleId): CssLogoRuleResult | undefined => checkCssLogos(html)[0]?.find((result) => result.rule === id);

describe("bugfind generation: CSS logo construction check", () => {
  test("Given a monoline mark of a rounded square and round-capped lines, When LOGO_LINE is measured, Then the all-rounded mark passes because a line has no corner to vote with", () => {
    const html = `<svg data-bg-css-logo role="img" aria-label="Acme" viewBox="0 0 48 48" fill="none" stroke="var(--brand-ink)" stroke-width="4" stroke-linecap="round">
      <rect x="6" y="6" width="36" height="36" rx="8"/><line x1="16" y1="24" x2="32" y2="24"/><line x1="24" y1="16" x2="24" y2="32"/></svg>`;
    expect(rule(html, "LOGO_LINE")).toEqual({ rule: "LOGO_LINE", status: "pass", measured: 1, limit: 1 });
  });

  test("Given a one-colour mark painted by a page CSS rule with a design token, When LOGO_COLOR is measured, Then it is not failed as a mark with zero colours", () => {
    const html = `<style>.mark path { fill: var(--brand-primary); }</style>
      <svg class="mark" data-bg-css-logo role="img" aria-label="Acme" viewBox="0 0 32 32"><path d="M0 0H32V32H0Z"/></svg>`;
    expect(rule(html, "LOGO_COLOR")?.status).not.toBe("fail");
  });
});
