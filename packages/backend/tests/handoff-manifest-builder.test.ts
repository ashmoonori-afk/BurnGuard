import { describe, expect, test } from "bun:test";
import { buildHandoffSpec } from "../src/services/export-handoff";
import { buildHandoffManifest } from "../src/services/export-handoff-manifest";

describe("buildHandoffManifest", () => {
  test("Given artifact files and pinned tokens When the manifest is built Then regions and production gaps are derived deterministically", () => {
    const result = buildHandoffManifest({
      spec: buildHandoffSpec({
        project: {
          id: "p1",
          name: "/Users/private/Launch",
          type: "prototype",
          entrypoint: "index.html",
        },
        viewport: { width: 1280, height: 720 },
        pages: [{
          slide_index: null,
          title: "Page",
          rect: { w: 1280, h: 720 },
          nodes: [{
            bg_id: "hero",
            tag: "section",
            parent_bg_id: null,
            text: "",
            rect: { x: 0, y: 0, w: 1280, h: 640 },
            styles: {},
          }],
        }],
        designSystem: {
          name: "Northvale",
          tokensFileInZip: "tokens/colors_and_type.css",
        },
        generatedAt: 1700000000,
      }),
      designSystem: {
        revision: 2,
        digest: "b".repeat(64),
        tokens: ":root { --color-brand: #123456; --color-brand-copy: #654321; }",
      },
      files: [
        {
          path: "index.html",
          text: `<style>
            @media (max-width: 640px) and (--source: /Users/private/mobile.css) /* token=gate-secret */ {
              .hero { color: var(--color-brand); }
            }
          </style><main>
            <section class="hero" data-bg-node-id="hero" data-component="Hero">
              <a href="/pricing?token=private">Pricing</a>
              <button type="button" data-action="open">Open /Users/private/dialog</button>
              <form action="/api/join"><input name="email"><button type="submit">Join</button></form>
              <img src="assets/hero.webp" alt="">
            </section>
          </main>`,
        },
        {
          path: "about.html",
          text: '<main data-bg-node-id="about-main" data-component="AboutPage"><h1>About</h1></main>',
        },
        {
          path: "styles.css",
          text: "@media (max-width: 768px) { .hero-copy, .section, .hero .child { color: var(--color-brand-copy); } }",
        },
        {
          path: "assets/hero.webp",
          text: null,
        },
      ],
    });

    expect(result.pages[0]?.regions[0]).toEqual({
      node_id: "hero",
      tag: "section",
      component: "Hero",
      route: "/",
      token_refs: ["--color-brand"],
    });
    expect(result.routes.map((route) => route.path)).toEqual(["/", "/about", "/pricing"]);
    expect(result.pages.map((page) => page.source_path)).toEqual([
      "source/index.html",
      "source/about.html",
    ]);
    expect(result.pages[1]?.regions[0]?.node_id).toBe("about-main");
    expect(result.interactions[0]?.target).toBe("/pricing");
    expect(result.components.find((component) => component.name === "Hero")?.node_ids).toEqual(["hero"]);
    expect(result.interactions.map((interaction) => interaction.kind)).toEqual([
      "link",
      "button",
      "form",
      "button",
    ]);
    expect(result.interactions.filter((interaction) => interaction.status === "mocked")).toHaveLength(3);
    expect(result.assets).toEqual([{ path: "source/assets/hero.webp", kind: "image" }]);
    expect(result.responsive_rules).toEqual([
      {
        source_file: "source/index.html",
        condition: "(max-width: 640px) and (--source: <private-path>)",
      },
      {
        source_file: "source/styles.css",
        condition: "(max-width: 768px)",
      },
    ]);
    expect(result.unresolved_backend_work).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("/Users/private");
    expect(JSON.stringify(result)).not.toContain("token=private");
    expect(JSON.stringify(result)).not.toContain("gate-secret");
  });

  test("Given secrets and platform paths in authored text When the manifest is built Then no text field carries them", () => {
    const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTYifQ", "c2lnbmF0dXJlMTIz"].join(".");
    const result = buildHandoffManifest({
      spec: emptySpec("index.html"),
      designSystem: null,
      files: [{
        path: "index.html",
        text: `<title>API_KEY=abc123 C:/Users/me/site</title>
          <main data-bg-node-id="m" data-component="Panel /opt/private/x">
            <button type="button" aria-label="Authorization: Bearer ${fakeJwt}">Go</button>
            <a href="file:///etc/passwd">Local</a>
          </main>`,
      }],
    });

    const serialized = JSON.stringify(result);
    for (const leaked of ["abc123", "C:/Users", "/opt/private", "eyJhbGci", "file:///etc", "/etc/passwd"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  test("Given links in a nested page When routes are derived Then hrefs resolve against their owner and never escape the root", () => {
    const result = buildHandoffManifest({
      spec: emptySpec("index.html"),
      designSystem: null,
      files: [
        { path: "index.html", text: '<a href="pages/about.html">About</a>' },
        { path: "pages/about.html", text: '<a href="contact.html">Contact</a><a href="../index.html">Home</a><a href="../../outside.html">Out</a>' },
        { path: "pages/contact.html", text: "<p>Contact</p>" },
      ],
    });

    expect(result.routes.map((route) => [route.path, route.kind])).toEqual([
      ["/", "page"],
      ["/pages/about", "page"],
      ["/pages/contact", "page"],
    ]);
  });

  test("Given a selector with an unmatched ancestor in another page's stylesheet When tokens are mapped Then only rules that apply to the page and element count", () => {
    const result = buildHandoffManifest({
      spec: emptySpec("app.html"),
      designSystem: { revision: 1, digest: "c".repeat(64), tokens: ":root { --brand: #111; --admin: #222; --linked: #333; }" },
      files: [
        { path: "index.html", text: '<link rel="stylesheet" href="site.css"><section class="hero" data-bg-node-id="hero"></section>' },
        { path: "site.css", text: ".admin .hero { color: var(--admin); } section.hero { color: var(--linked); }" },
        { path: "unlinked.css", text: ".hero { color: var(--brand); }" },
      ],
    });

    expect(result.pages[0]?.regions[0]?.token_refs).toEqual(["--linked"]);
  });

  test("Given two pages with mocked buttons When the manifest is built Then unresolved work ids are unique and ordering is code-unit stable", () => {
    const result = buildHandoffManifest({
      spec: emptySpec("index.html"),
      designSystem: null,
      files: [
        { path: "index.html", text: '<button type="button">A</button>' },
        { path: "b.html", text: '<button type="button">B</button>' },
        { path: "Z.html", text: "<p>Z</p>" },
      ],
    });

    const ids = result.unresolved_backend_work.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.routes.map((route) => route.path)).toEqual(["/", "/Z", "/b"]);
  });
});

function emptySpec(entrypoint: string) {
  return buildHandoffSpec({
    project: { id: "p1", name: "Site", type: "prototype", entrypoint },
    viewport: { width: 1280, height: 720 },
    pages: [],
    designSystem: { name: null, tokensFileInZip: null },
    generatedAt: 1,
  });
}
