import { expect, test } from "bun:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NormalizedEvent, SessionInfo } from "@bg/shared";
import AgentMessage from "../src/components/chat/blocks/AgentMessage";
import MessageStream from "../src/components/chat/MessageStream";
import { t, type MessageKey } from "../src/i18n/t";

const SESSION: SessionInfo = {
  id: "session", project_id: "project", backend_id: "codex", status: "idle",
  usage: { input: 0, output: 0, cached: 0, cache_write: 0 }, updated_at: 1, last_active_at: 1,
};

async function messageFields(markup: string): Promise<string[]> {
  const fields: string[] = [];
  await new HTMLRewriter().on('[data-qa="agent-message"] > div:first-child', {
    element() { fields.push(""); },
    text(chunk) { fields[fields.length - 1] += chunk.text; },
  }).transform(new Response(markup)).text();
  return fields;
}

async function anchors(markup: string): Promise<Array<{ href: string | null; rel: string | null; target: string | null }>> {
  const found: Array<{ href: string | null; rel: string | null; target: string | null }> = [];
  await new HTMLRewriter().on("a", {
    element(element) { found.push({ href: element.getAttribute("href"), rel: element.getAttribute("rel"), target: element.getAttribute("target") }); },
  }).transform(new Response(markup)).text();
  return found;
}

function agentMarkup(text: string, projectDir?: string): string {
  return renderToStaticMarkup(createElement(AgentMessage, { text, projectDir, turnId: "turn", disposition: "committed" as const }));
}

async function renderMessage(text: string, projectDir?: string): Promise<string[]> {
  return messageFields(agentMarkup(text, projectDir));
}

const shipped = (key: MessageKey) => renderToStaticMarkup(createElement(Fragment, null, t(key)));

for (const [name, root, target] of [
  ["POSIX", "/Users/owner/profile/projects/project", "/Users/owner/profile/projects/project/.meta/artifact-operations/op-1/stage/index.html:23"],
  ["Windows", "C:\\Users\\owner\\profile\\projects\\project", "C:\\Users\\owner\\profile\\projects\\project\\.meta\\artifact-operations\\op-1\\stage\\index.html:23:2"],
  ["NFD and spaces", "/Users/owner/Café profile/projects/project".normalize("NFD"), "/Users/owner/Café profile/projects/project/.meta/artifact-operations/op-1/stage/pages/Café page.html".normalize("NFD")],
] as const) {
  test(`Given a ${name} staged Markdown link When the completion bubble renders Then only the project-relative filename remains`, async () => {
    // Given: the link label is untrusted and the target names the turn's private stage.
    const text = `[${target}](<${target}>)`;
    // When
    const fields = await renderMessage(text, root);
    // Then: rendered fields, not completion prose.
    expect(fields).toEqual([name === "NFD and spaces" ? "pages/Café page.html" : "index.html"]);
  });
}

test("Given a committed project link When the bubble renders Then its relative label replaces Markdown syntax", async () => {
  const fields = await renderMessage("[changed](</profile/projects/project/pages/about.html#L12>)", "/profile/projects/project");
  expect(fields).toEqual(["pages/about.html"]);
});

test("Given Windows forward slashes and drive casing When the bubble renders Then the reference resolves within the project", async () => {
  const fields = await renderMessage("[changed](c:/Users/Owner/project/index.html)", "C:\\Users\\Owner\\project");
  expect(fields).toEqual(["index.html"]);
});

test("Given encoded file URLs When the bubble renders Then spaces and Unicode map to the project-relative name", async () => {
  const fields = await renderMessage("[changed](file:///C:/Users/owner/project/pages/Caf%C3%A9%20page.html)", "C:\\Users\\owner\\project");
  expect(fields).toEqual(["pages/Café page.html"]);
});

test("Given quoted and bare local references When the bubble renders Then managed paths are relative and other roots are scrubbed", async () => {
  const root = "/Users/owner/Café profile".normalize("NFD");
  const fields = await renderMessage(`\`${root}/index.html:23\`\n"/private/Other Profile/secrets.txt"\nC:\\Users\\other\\secret.txt\n/private/token.txt`, root);
  expect(fields).toEqual(["index.html\n[private-path]\n[private-path]\n[private-path]"]);
});

for (const target of [
  "/profile/project-other/index.html",
  "/profile/project/../other/index.html",
  "/profile/project/.meta/artifact-operations/op-1/snapshot/index.html",
  "/profile/project/.meta/artifact-operations/op-1/stage/.attachments/secret.txt",
  "/profile/project/.burnguard-inputs/reference.png",
  "\\\\server\\private\\secret.txt",
]) {
  test(`Given private target ${target} When the bubble renders Then no private label or destination survives`, async () => {
    const fields = await renderMessage(`[${target}](<${target}>)`, "/profile/project");
    expect(fields).toEqual(["[private-path]"]);
  });
}

test("Given no project root When an absolute link renders Then the private target is scrubbed", async () => {
  expect(await renderMessage("[index.html](/private/profile/index.html)")).toEqual(["[private-path]"]);
});

test("Given a relative staged reference When the bubble renders Then only the authored filename remains", async () => {
  expect(await renderMessage("[changed](.meta/artifact-operations/op-1/stage/index.html:23)")).toEqual(["index.html"]);
});

test("Given a streaming absolute link label When its destination has not arrived Then the private label is scrubbed", async () => {
  expect(await renderMessage("[/Users/owner/private", "/profile/project")).toEqual(["[[private-path]"]);
  expect(await renderMessage("[C:\\Users\\owner\\private", "C:\\profile\\project")).toEqual(["[[private-path]"]);
});

test("Given generation and automatic repair deltas When live prefixes and reopened history render Then no partial destination leaks", async () => {
  // Given: a provider may split a path at any character, including inside the profile root.
  const root = "/Users/owner/profile/project";
  const text = `[index.html](<${root}/.meta/artifact-operations/op-1/stage/index.html:23>)`;
  const events: NormalizedEvent[] = [];
  for (const [index, character] of [...text].entries()) {
    events.push({ id: `delta-${index}`, ts: index, type: "chat.delta", turnId: "turn", text: character });
    if (index < text.indexOf("](") + 1) continue;
    // When: the real stream groups partial events before the display boundary.
    const fields = await messageFields(renderToStaticMarkup(createElement(MessageStream, { session: SESSION, events, projectDir: root })));
    // Then
    expect(fields).toEqual([index === text.length - 1 ? "index.html" : "[private-path]"]);
  }
  events.push({ id: "end", ts: 1000, type: "chat.message_end", turnId: "turn" });
  events.push({ id: "repair", ts: 1001, type: "chat.delta", turnId: "turn-design-repair-1", text });
  expect(await messageFields(renderToStaticMarkup(createElement(MessageStream, { session: SESSION, events, projectDir: root })))).toEqual(["index.html", "index.html"]);
});

for (const [flavor, root, target, expected] of [
  ["POSIX managed", "/profile/project", "/profile/project/.meta/artifact-operations/op-1/stage/index.html:23", "index.html"],
  ["Windows managed", "C:\\profile\\project", "C:\\profile\\project\\.meta\\artifact-operations\\op-1\\stage\\index.html:23", "index.html"],
  ["POSIX private", "/profile/project", "/Users/owner/private/secret.txt", "[private-path]"],
  ["Windows private", "C:\\profile\\project", "C:\\Users\\owner\\private\\secret.txt", "[private-path]"],
] as const) {
  test(`Given review punctuation-adjacent ${flavor} paths When the bubble renders Then the complete local reference is classified`, async () => {
    const prefix = "ref:";
    const fields = await renderMessage(`${prefix}${target}`, root);
    expect(fields.map((field) => field.slice(prefix.length))).toEqual([expected]);
  });
}

test("Given review Windows relative staging casing When the bubble renders Then no internal directory spelling survives", async () => {
  const fields = await renderMessage(".META\\artifact-operations\\op-1\\stage\\index.html", "C:\\profile\\project");
  expect(fields).toEqual(["index.html"]);
});

for (const destination of ["https://example.com/docs", "mailto:owner@example.com"]) {
  test(`Given review angle-wrapped ${destination.split(":")[0]} links When the bubble renders Then a safe new-tab link keeps the destination behind its label`, async () => {
    const markup = agentMarkup(`[reference](<${destination}>)`, "/profile/project");
    expect(await messageFields(markup)).toEqual(["reference"]);
    expect(await anchors(markup)).toEqual([{ href: destination, rel: "noopener noreferrer", target: "_blank" }]);
  });
}

test("Given review slash separators When the bubble renders Then ordinary message fields are unchanged", async () => {
  const text = "HTML / CSS; width/height; 16/9; 50%";
  expect(await renderMessage(text, "/profile/project")).toEqual([text]);
});

for (const [flavor, root, tail, expected] of [
  ["POSIX staged", "/Users/owner/Café profile/projects/project", "/.meta/artifact-operations/op-1/stage/index.html", "index.html"],
  ["POSIX committed", "/Users/owner/Café profile/projects/project", "/pages/Café page.html", "pages/Café page.html"],
  ["Windows staged", "C:\\Users\\owner\\Café profile\\projects\\project", "\\.meta\\artifact-operations\\op-1\\stage\\index.html", "index.html"],
  ["Windows committed", "C:\\Users\\owner\\Café profile\\projects\\project", "\\pages\\Café page.html", "pages/Café page.html"],
] as const) {
  test(`Given review unquoted NFD space paths in ${flavor} When the bubble renders Then the complete project-relative field remains`, async () => {
    const prefix = "ref ";
    const suffix = " done.";
    const fields = await renderMessage(`${prefix}${(root + tail).normalize("NFD")}${suffix}`, root.normalize("NFD"));
    expect(fields.map((field) => field.slice(prefix.length, -suffix.length))).toEqual([expected]);
  });
}

for (const [flavor, root, target] of [
  ["Windows dot", "C:\\profile\\project", ".\\.meta\\artifact-operations\\op-1\\stage\\index.html"],
  ["Windows uppercase dot", "C:\\profile\\project", ".\\.META\\artifact-operations\\op-1\\stage\\index.html"],
  ["Windows parent", "C:\\profile\\project", "..\\.meta\\artifact-operations\\op-1\\stage\\index.html"],
  ["Windows parent subtree", "C:\\profile\\project", "..\\x\\.meta\\artifact-operations\\op-1\\stage\\index.html"],
  ["Windows project subtree", "C:\\profile\\project", "project\\.meta\\artifact-operations\\op-1\\stage\\index.html"],
  ["Windows sub subtree", "C:\\profile\\project", "sub\\.meta\\artifact-operations\\op-1\\stage\\index.html"],
  ["POSIX dot", "/profile/project", "./.meta/artifact-operations/op-1/stage/index.html"],
  ["POSIX uppercase dot", "/profile/project", "./.META/artifact-operations/op-1/stage/index.html"],
  ["POSIX parent", "/profile/project", "../.meta/artifact-operations/op-1/stage/index.html"],
  ["POSIX parent subtree", "/profile/project", "../x/.meta/artifact-operations/op-1/stage/index.html"],
  ["POSIX project subtree", "/profile/project", "project/.meta/artifact-operations/op-1/stage/index.html"],
  ["POSIX sub subtree", "/profile/project", "sub/.meta/artifact-operations/op-1/stage/index.html"],
] as const) {
  test(`Given second review relative ${flavor} stages When prose renders Then the whole private reference is scrubbed`, async () => {
    const prefix = "Updated ";
    const suffix = " successfully.";
    const fields = await renderMessage(`${prefix}${target}${suffix}`, root);
    expect(fields.map((field) => field.slice(prefix.length, -suffix.length))).toEqual(["[private-path]"]);
  });
}

test("Given private segments in any path position When separators casing quoting and Unicode vary Then no private segment or operation directory renders", async () => {
  for (const separator of ["/", "\\"]) {
    const root = separator === "/" ? "/profile/project" : "C:\\profile\\project";
    for (const prefix of [".", `..${separator}x`, `sub${separator}Café folder`, root, `${separator}sub`, `sub${separator === "/" ? "\\" : "/"}Café folder`]) {
      for (const directory of [".meta", ".META", ".MeTa"]) {
        for (const form of ["NFC", "NFD"] as const) {
          const target = [prefix, directory, "artifact-operations", "op-1", "stage", "index.html"].join(separator).normalize(form);
          for (const quote of ["", "'", '"', "`", "<"]) {
            const input = quote === "<" ? `<${target}>` : `${quote}${target}${quote}`;
            const fields = await renderMessage(input, root);
            expect(fields.join("").toLowerCase()).not.toContain(".meta");
            expect(fields.join("")).not.toContain("artifact-operations");
          }
        }
      }
    }
  }
});

test("Given a terminal private directory and an external private path When rendered Then each complete path is scrubbed", async () => {
  expect(await renderMessage("sub/.meta\n.META\n[reference](<https://example.com/sub/.meta/file.html>)", "/profile/project"))
    .toEqual(["[private-path]\n[private-path]\n[private-path]"]);
});

test("Given public relative paths with similar directory names When rendered Then their original fields remain intact", async () => {
  const text = "sub/.metadata/index.html; pages/Café page.html; width/height";
  expect(await renderMessage(text, "/profile/project")).toEqual([text]);
});

test("Given model Markdown When the bubble renders Then emphasis, headings, lists and code become elements and only code is monospace", async () => {
  // Given
  const text = "## Plan\n\nUse **bold** and *soft* words.\n\n- first\n- second\n\n1. one\n2. two\n\nRun `npm test` first:\n\n```\nconst ratio = 16 / 9;\n```";
  // When
  const markup = agentMarkup(text, "/profile/project");
  // Then
  expect(markup).toMatch(/<h2[^>]*>Plan<\/h2>/);
  expect(markup).toMatch(/<strong[^>]*>bold<\/strong>/);
  expect(markup).toMatch(/<em[^>]*>soft<\/em>/);
  expect(markup).toMatch(/<ul[^>]*>\s*<li[^>]*>first<\/li>\s*<li[^>]*>second<\/li>\s*<\/ul>/);
  expect(markup).toMatch(/<ol[^>]*>\s*<li[^>]*>one<\/li>/);
  expect(markup).toMatch(/<code[^>]*>npm test<\/code>/);
  expect(markup).toMatch(/<pre[^>]*><code[^>]*>const ratio = 16 \/ 9;\n<\/code><\/pre>/);
  const [field] = await messageFields(markup);
  for (const syntax of ["**", "## ", "- first", "`"]) expect(field).not.toContain(syntax);
  const monospace = [...markup.matchAll(/<(\w+)[^>]*\bfont-mono\b/g)].map((match) => match[1]);
  expect(monospace.length).toBeGreaterThan(0);
  expect(monospace.every((tag) => tag === "code" || tag === "pre")).toBe(true);
});

test("Given raw HTML, script URLs and remote images in model Markdown When the bubble renders Then nothing executes, loads or links", async () => {
  const markup = agentMarkup([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    'Inline <b onclick="steal()">bold</b> text and ![pixel](https://tracker.example/p.png)',
    "<javascript:alert(1)> <vbscript:msgbox(1)> [ref][r]",
    "[r]: javascript:alert(2)",
  ].join("\n\n"), "/profile/project");
  expect(markup).not.toMatch(/<(?:script|img|b)[\s>]/u);
  expect(markup).not.toContain('onclick="');
  expect(markup).not.toContain("href=");
  expect(markup).not.toContain("tracker.example");
  expect(await anchors(markup)).toEqual([]);
});

test("Given web links whose decoded destination names the project, a drive or a file URL When the bubble renders Then only the label remains", async () => {
  for (const destination of [
    "https://example.com/?from=/profile/project/index.html",
    "https://example.com/?from=%2Fprofile%2Fproject%2Findex.html",
    "https://example.com/?from=%252Fprofile%252Fproject%252Findex.html",
    "https://example.com/?from=%252Emeta%252Fsecret",
    "https://example.com/upload?file=C:/Users/owner/secret.txt",
    "mailto:owner@example.com?body=file:///profile/project/index.html",
  ]) {
    const markup = agentMarkup(`[docs](${destination})`, "/profile/project");
    expect(await anchors(markup)).toEqual([]);
    expect(await messageFields(markup)).toEqual(["docs"]);
    expect(markup).not.toContain("example.com");
  }
});

test("Given a private path spelled with character references When Markdown decodes them Then the decoded path is still scrubbed", async () => {
  const markup = agentMarkup("Saved to &#47;Users&#47;owner&#47;secret.txt.", "/profile/project");
  expect(await messageFields(markup)).toEqual(["Saved to [private-path]."]);
  expect(markup).not.toContain("Users");
});

test("Given failed and recovered command attempts beside a refused turn When the stream renders Then they share one closed disclosure and the refusal stays primary", () => {
  // Given: routine provider attempts (one failed, one recovered, one provider error item), a pipeline stage and a refusal.
  const turnId = "turn-noise";
  const events: NormalizedEvent[] = [
    { id: "user", ts: 1, type: "chat.user_message", turnId, text: "make the mark", attachmentCount: 0 },
    { id: "bash", ts: 2, type: "tool.started", turnId, toolCallId: "c1", tool: "Bash", input: { command: "cat /Users/owner/secret.txt" } },
    { id: "bash-end", ts: 3, type: "tool.finished", turnId, toolCallId: "c1", tool: "Bash", ok: false },
    { id: "retry", ts: 4, type: "tool.started", turnId, toolCallId: "c2", tool: "command_execution", input: {} },
    { id: "retry-end", ts: 5, type: "tool.finished", turnId, toolCallId: "c2", tool: "command_execution", ok: true },
    { id: "item", ts: 6, type: "tool.started", turnId, toolCallId: "c3", tool: "generation_tool_failed", input: {} },
    { id: "item-end", ts: 7, type: "tool.finished", turnId, toolCallId: "c3", tool: "generation_tool_failed", ok: false },
    { id: "plan", ts: 8, type: "tool.started", turnId, toolCallId: "c4", tool: "generation_phase_plan", input: {} },
    { id: "delta", ts: 9, type: "chat.delta", turnId, text: "**Done**" },
    { id: "refused", ts: 10, type: "status.error", code: "logo_deliverables_missing", reason: "logo_svg_invalid", notApplied: { turnId, operationId: "operation-10", repairs: 1 }, message: "turn_failed", recoverable: true },
    { id: "idle", ts: 11, type: "status.idle", stopReason: "error" },
  ];
  // When
  const html = renderToStaticMarkup(createElement(MessageStream, { session: SESSION, events, projectDir: "/profile/project" }));
  // Then: every step is still listed, inside one closed disclosure.
  const disclosures = html.match(/<details[^>]*data-qa="tool-activity"[^>]*>[\s\S]*?<\/details>/g) ?? [];
  expect(disclosures).toHaveLength(1);
  const disclosure = disclosures[0];
  if (disclosure === undefined) throw new Error("The activity disclosure was not rendered");
  expect(disclosure).not.toMatch(/^<details[^>]*\sopen[\s=>]/);
  expect(disclosure.match(/data-qa="tool-activity-step"/g)?.length).toBe(3);
  expect(disclosure.match(/data-tool-state="error"/g)?.length).toBe(2);
  // The conversation keeps the pipeline stage, the rendered message and the actionable refusal, not the attempts.
  const primary = html.replace(disclosure, "");
  expect(primary).not.toContain(shipped("chat.tool.command"));
  expect(primary).not.toContain(shipped("chat.tool.providerFailed"));
  expect(primary).toContain(shipped("chat.tool.phasePlan"));
  expect(primary).toMatch(/<strong[^>]*>Done<\/strong>/);
  expect(primary).toContain('data-qa="turn-error"');
  expect(primary).toContain('data-turn-not-applied="true"');
  expect(primary).toContain(`data-turn-id="${turnId}" data-turn-disposition="not_applied"`);
  expect(html).not.toContain("/Users/owner");
});
