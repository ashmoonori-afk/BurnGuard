import { describe, expect, test } from "bun:test";
import { injectMadeWithBadge, MADE_WITH_BADGE_MARKER } from "../src/services/publish-badge";

const markerCount = (html: string) => html.split(`<a ${MADE_WITH_BADGE_MARKER}`).length - 1;

describe("Made with BurnGuard badge injection", () => {
  test("Given HTML with several closing body tags When injected Then the badge sits right before the last one", () => {
    const html = "<html><body><template></body></template><p>x</p></BODY >\n</html>";
    const result = injectMadeWithBadge(html);
    const badgeAt = result.indexOf(`<a ${MADE_WITH_BADGE_MARKER}`);
    expect(markerCount(result)).toBe(1);
    expect(result.startsWith("<html><body><template></body></template><p>x</p>")).toBe(true);
    expect(result.endsWith("</BODY >\n</html>")).toBe(true);
    expect(badgeAt).toBeGreaterThan(result.indexOf("<p>x</p>"));
    expect(badgeAt).toBeLessThan(result.lastIndexOf("</BODY >"));
  });

  test("Given HTML without a body tag When injected Then the badge is appended", () => {
    const html = "<h1>Hello</h1>";
    const result = injectMadeWithBadge(html);
    expect(result.startsWith(html)).toBe(true);
    expect(markerCount(result)).toBe(1);
    expect(result.endsWith("</a>")).toBe(true);
  });

  test("Given already badged HTML When injected again Then the output is unchanged", () => {
    const once = injectMadeWithBadge("<html><body>Hi</body></html>");
    expect(injectMadeWithBadge(once)).toBe(once);
  });

  test("Given the injected markup When inspected Then it is static, local and links to the project with noopener", () => {
    const result = injectMadeWithBadge("<body></body>");
    expect(result).not.toMatch(/<script/i);
    expect(result).not.toMatch(/\bsrc=|@import|url\(/i);
    expect(result).toContain('href="https://github.com/ashmoonori-afk/BurnGuard"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain("all:initial");
    expect(result).toContain("@media print");
  });
});
