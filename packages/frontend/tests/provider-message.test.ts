import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NormalizedEvent, SessionInfo } from "@bg/shared";
import AgentMessage from "../src/components/chat/blocks/AgentMessage";
import MessageStream from "../src/components/chat/MessageStream";

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

async function renderMessage(text: string, projectDir?: string): Promise<string[]> {
  const props = { text, projectDir, turnId: "turn", disposition: "committed" as const };
  return messageFields(renderToStaticMarkup(createElement(AgentMessage, props)));
}

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
