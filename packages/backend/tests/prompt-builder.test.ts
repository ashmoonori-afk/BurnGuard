import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { getSqlite } from "../src/db/sqlite-client";
import { buildPrompt } from "../src/harness/prompt-builder";
import { DESIGN_CRAFT_RULES } from "../src/harness/design-craft";
import { PROTOTYPE_NAVIGATION_CONTRACT } from "../src/harness/skills/prototype-skill";
import { ensureLearningSchema } from "./learning-fixture";
import {
  attachmentExtractedTextPath,
  attachmentSummaryPath,
} from "../src/services/attachment-paths";

type BuildContext = Parameters<typeof buildPrompt>[0];

beforeAll(() => ensureLearningSchema(getSqlite()));

function makeContext(
  overrides: Partial<BuildContext["project"]> = {},
  extra: Partial<Omit<BuildContext, "project">> = {},
): BuildContext {
  return {
    project: {
      project_id: "p1",
      project_name: "Test project",
      project_type: "prototype",
      entrypoint: "index.html",
      project_dir: "/tmp/p1",
      options_json: null,
      ...overrides,
    },
    files: [],
    attachments: [],
    designSystem: null,
    openComments: [],
    ...extra,
  } as BuildContext;
}

describe("buildPrompt", () => {
  test("Given resolved model selections When assembling Then execution guidance follows the selected model and preserves the request", async () => {
    const text = "선택한 영역만 수정해 주세요.\nKeep my exact wording.";
    const cases = [
      { backendId: "codex", model: "gpt-5.4", provider: "native", profile: "codex" },
      { backendId: "claude-code", model: "sonnet", provider: "native", profile: "claude" },
      { backendId: "claude-code", model: "opus", provider: "native", profile: "claude-opus" },
      { backendId: "claude-code", model: "claude-opus-4-6", provider: "commandcode", profile: "claude-opus" },
    ] as const;
    for (const selected of cases) {
      const generation = { model: selected.model, provider: selected.provider, effort: "low", vanilla: true } as const;
      const prompt = await buildPrompt(makeContext(), { type: "user.message", text }, { backendId: selected.backendId, generation });
      const metadata = JSON.parse(prompt.match(/<burnguard-model-guidance-v1>\n([^\n]+)\n<\/burnguard-model-guidance-v1>/)![1]!);
      expect(metadata).toEqual({ schema_version: 1, profile: selected.profile, model: selected.model, provider: selected.provider, effort: "low" });
      expect(prompt.endsWith(`## Request\n${text}`)).toBe(true);
      expect(prompt).toContain("Do not touch anything outside this directory.");
      expect(generation.effort).toBe("low");
      expect(prompt.indexOf("<burnguard-model-guidance-v1>")).toBeLessThan(prompt.indexOf("## Delivery"));
    }
    const prompt = await buildPrompt(makeContext(), { type: "user.message", text });
    expect(prompt).not.toContain("<burnguard-model-guidance-v1>");
  });

  test("Given any generation mode without a design system, When assembling, Then shipped craft rules occur once before delivery", async () => {
    for (const project_type of ["prototype", "slide_deck", "graphic", "from_template", "other"] as const) {
      for (const contextMode of ["compact", "full"] as const) {
        const prompt = await buildPrompt(makeContext({ project_type }), { type: "user.message", text: "Improve the selected element" }, { contextMode });
        expect(prompt.split(DESIGN_CRAFT_RULES)).toHaveLength(2);
        expect(prompt.indexOf(DESIGN_CRAFT_RULES)).toBeLessThan(prompt.indexOf("## Delivery"));
        expect(prompt.indexOf(DESIGN_CRAFT_RULES)).toBeGreaterThan(prompt.indexOf("## Project"));
      }
    }
  });

  test("includes only the selected ready design direction", async () => {
    const base = {
      schema_version: 1, project_id: "p1", session_id: "s1", generation_id: "g1", status: "ready",
      content_outline: ["outline-input-a", "outline-input-b"], selection_revision: 1, selection_history: [null], error: null, updated_at: 1,
      directions: [
        { id: "editorial", order: 0, layout_key: "editorial", title: "selected-input-title", summary: "selected-summary", style_facts: ["selected-input-fact"], status: "ready", preview_url: "/a", error: null },
        { id: "modular", order: 1, layout_key: "modular", title: "unselected-input-title-b", summary: "other", style_facts: ["unselected-input-fact-b"], status: "ready", preview_url: "/b", error: null },
        { id: "narrative", order: 2, layout_key: "narrative", title: "unselected-input-title-c", summary: "other", style_facts: ["unselected-input-fact-c"], status: "ready", preview_url: "/c", error: null },
      ],
      selected_id: "editorial",
    } as const;
    const selected = await buildPrompt(makeContext({}, { designDirectionState: base }), { type: "user.message", text: "continue" });
    const beforeSelection = await buildPrompt(makeContext({}, { designDirectionState: { ...base, selected_id: null, selection_revision: 0, selection_history: [] } }), { type: "user.message", text: "continue" });

    expect(selected).toContain("## Selected design direction");
    expect(selected).toContain("outline-input-a");
    expect(selected).toContain("selected-input-title");
    expect(selected).toContain("editorial");
    expect(selected).toContain("selected-input-fact");
    expect(selected).not.toContain("unselected-input-title-b");
    expect(selected).not.toContain("unselected-input-fact-c");
    expect(beforeSelection).not.toContain("## Selected design direction");
  });

  test("emits project + delivery + request sections for prototype", async () => {
    const prompt = await buildPrompt(makeContext(), {
      type: "user.message",
      text: "make it red",
    });
    expect(prompt).toContain("# BurnGuard Design project session");
    expect(prompt).toContain("## Project");
    expect(prompt).toContain("- type: prototype");
    expect(prompt).toContain("## Delivery");
    expect(prompt).toContain("## Request");
    expect(prompt).toContain("make it red");
    expect(prompt).not.toContain("## Slide deck skill");
    expect(prompt).not.toContain("use_speaker_notes");
  });

  test("injects prototype skill for prototype projects", async () => {
    const prompt = await buildPrompt(makeContext(), {
      type: "user.message",
      text: "build me a landing page",
    });
    expect(prompt).toContain("## Prototype skill");
    expect(prompt).toContain("# Prototype authoring conventions");
    expect(prompt).toContain("data-section");
    expect(prompt).toContain("hero-centered");
    expect(prompt).toContain("data-bg-node-id");
    // Skills must not cross-contaminate.
    expect(prompt).not.toContain("## Slide deck skill");
  });

  test("injects slide deck skill for slide_deck projects", async () => {
    const prompt = await buildPrompt(
      makeContext({
        project_type: "slide_deck",
        entrypoint: "deck.html",
        options_json: JSON.stringify({ use_speaker_notes: true }),
      }),
      { type: "user.message", text: "noop" },
    );
    expect(prompt).toContain("## Slide deck skill");
    expect(prompt).toContain("- use_speaker_notes: true");
  });

  test("compact mode references stable context instead of inlining full skills", async () => {
    const prompt = await buildPrompt(
      makeContext({
        project_type: "slide_deck",
        entrypoint: "deck.html",
        options_json: JSON.stringify({ use_speaker_notes: false }),
      }),
      { type: "user.message", text: "redesign slide 4" },
      { contextMode: "compact" },
    );

    expect(prompt).toContain("## Context budget");
    expect(prompt).toContain("Keep this turn token-light");
    expect(prompt).toContain("# Slide deck compact contract");
    expect(prompt).toContain("top-level `<section data-slide");
    // Compact skill must spell out token-budget rules so Claude doesn't fall
    // back to its default "Read the whole file before editing" instinct.
    expect(prompt).toContain("Token budget rules");
    expect(prompt).toContain("Read `deck.html` at most ONCE per turn");
    expect(prompt).toContain("offset");
    expect(prompt).not.toContain("## Layout archetypes");
    expect(prompt).not.toContain("Default pitch deck is 15 slides");
  });

  test("injects deck structure summary when entrypoint is a real deck.html", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "bg-prompt-deckstruct-"));
    try {
      const deckPath = path.join(tempDir, "deck.html");
      await writeFile(
        deckPath,
        `<!doctype html><html><head><style>
:root { --color-primary:#001a4d; --font-heading:"Pretendard"; }
.deck-slide { padding: 4rem; }
</style></head><body>
<section data-slide class="deck-slide deck-cover" data-bg-node-id="slide-1">
  <h1>비전 2030</h1>
</section>
<section data-slide class="deck-slide" data-layout="kpi-grid" data-bg-node-id="slide-2">
  <h2>시장 현황</h2>
</section>
</body></html>`,
        "utf8",
      );

      const prompt = await buildPrompt(
        makeContext({
          project_type: "slide_deck",
          entrypoint: "deck.html",
          project_dir: tempDir,
          options_json: JSON.stringify({ use_speaker_notes: false }),
        }),
        { type: "user.message", text: "redesign slide 2" },
        { contextMode: "compact" },
      );

      expect(prompt).toContain("## Deck structure");
      expect(prompt).toContain("2 slide(s)");
      expect(prompt).toContain("1. slide-1 .deck-cover");
      expect(prompt).toContain("비전 2030");
      expect(prompt).toContain("[layout=kpi-grid]");
      expect(prompt).toContain("--color-primary");
      // The structure section must precede the skill section so Claude reads
      // the map before the behavioral rules that reference it.
      expect(prompt.indexOf("## Deck structure")).toBeLessThan(
        prompt.indexOf("# Slide deck compact contract"),
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("injects prototype structure summary when entrypoint is a real index.html", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "bg-prompt-protostruct-"));
    try {
      const indexPath = path.join(tempDir, "index.html");
      await writeFile(
        indexPath,
        `<!doctype html><html><head><style>
:root { --space-md: 16px; }
header { padding: var(--space-md); }
</style></head><body>
<header data-section="hero" data-bg-node-id="hero"><h1>Welcome</h1></header>
<main data-section="features" data-bg-node-id="features"><p>Features</p></main>
</body></html>`,
        "utf8",
      );

      const prompt = await buildPrompt(
        makeContext({
          project_type: "prototype",
          entrypoint: "index.html",
          project_dir: tempDir,
        }),
        { type: "user.message", text: "polish hero" },
        { contextMode: "compact" },
      );

      expect(prompt).toContain("## Prototype structure");
      expect(prompt).toContain("2 section(s)");
      expect(prompt).toContain("<header> hero");
      expect(prompt).toContain("Welcome");
      expect(prompt).toContain("--space-md");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Given full design-system and file context When built Then deterministic machine paths and values are preserved", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "bg-prompt-context-"));
    try {
      const skill = path.join(tempDir, "SKILL.md");
      const tokens = path.join(tempDir, "tokens.css");
      const readme = path.join(tempDir, "README.md");
      await Promise.all([
        writeFile(skill, "skill-machine-value"),
        writeFile(tokens, ":root{--machine-token:#123456}"),
        writeFile(readme, "readme-machine-value"),
      ]);
      const files = Array.from({ length: 61 }, (_, index) => ({ rel_path: `file-${String(index).padStart(2, "0")}.txt`, category: "document" as const, size_bytes: index, hash: null, updated_at: 1 }));

      const prompt = await buildPrompt(makeContext({}, {
        files,
        designSystem: { id: "machine-system", name: "machine-name", status: "published", source_type: "manual", is_template: false, dir_path: tempDir, skill_md_path: skill, tokens_css_path: tokens, readme_md_path: readme, thumbnail_path: null, created_at: 1, updated_at: 1, archived_at: null },
      }), { type: "user.message", text: "machine-request" });

      expect(prompt).toContain("file-00.txt (0B)");
      expect(prompt).toContain("file-59.txt (59B)");
      expect(prompt).not.toContain("file-60.txt");
      expect(prompt).toContain("skill-machine-value");
      expect(prompt).toContain("--machine-token:#123456");
      expect(prompt).toContain("readme-machine-value");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("skips structure summary gracefully when the entrypoint file does not exist yet", async () => {
    // Brand-new project: backend may build a prompt before the entrypoint has
    // been Written for the first time. The summary block should silently
    // disappear instead of crashing the turn.
    const prompt = await buildPrompt(
      makeContext({
        project_type: "slide_deck",
        entrypoint: "deck.html",
        project_dir: "/no/such/dir/that/exists",
      }),
      { type: "user.message", text: "first turn" },
      { contextMode: "compact" },
    );
    // The compact skill text references "## Deck structure" as documentation,
    // so we can't just look for that string. The unique signature of an
    // actually-injected summary is the file-size line.
    expect(prompt).not.toMatch(/deck\.html — \d/);
    // The rest of the prompt must still render normally.
    expect(prompt).toContain("# Slide deck compact contract");
  });

  test("Given committed learning checkpoints When a prompt is built Then only the latest compatible machine context is injected", async () => {
    const db = getSqlite();
    const suffix = `${process.pid}-${Date.now()}`;
    const projectId = `prompt-learning-project-${suffix}`;
    const itemId = `prompt-learning-item-${suffix}`;
    const oldId = `prompt-learning-old-${suffix}`;
    const latestId = `prompt-learning-latest-${suffix}`;
    db.prepare("INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(projectId, "Prompt learning", "prototype", `/tmp/${projectId}`, "codex", 4, "prompt-digest", 1, 1);
    db.prepare("INSERT INTO learning_items (id,kind,title,content_json,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(itemId, "lesson", "Prompt lesson", JSON.stringify({ schema_revision: 1, owner: "user", seed_key: null, revision: 0, content: { summary: "Prompt" } }), 1, 1);
    db.prepare("INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES (?,'in_progress',1,'DRAFT_MUST_NOT_APPEAR',1)").run(itemId);
    const insert = db.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,parent_checkpoint_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    insert.run(oldId, itemId, projectId, null, 4, "prompt-digest", "OLD_FEEDBACK", JSON.stringify({ kind: "iteration", parent_checkpoint_id: oldId, schema_revision: 1, artifact_revision: 4, artifact_digest: "prompt-digest" }), 2);
    insert.run(latestId, itemId, projectId, oldId, 4, "prompt-digest", "COMMITTED_FEEDBACK", JSON.stringify({ kind: "iteration", parent_checkpoint_id: latestId, schema_revision: 1, artifact_revision: 4, artifact_digest: "prompt-digest" }), 3);

    try {
      const prompt = await buildPrompt(makeContext({ project_id: projectId, project_dir: `/tmp/${projectId}` }), { type: "user.message", text: "iterate" });

      expect(prompt).toContain("<burnguard-learning-context-v1>");
      expect(prompt).toContain(`\"checkpoint_id\":\"${latestId}\"`);
      expect(prompt).toContain("\"artifact_revision\":4");
      expect(prompt).toContain("\"artifact_digest\":\"prompt-digest\"");
      expect(prompt).toContain("\"feedback\":\"COMMITTED_FEEDBACK\"");
      expect(prompt).not.toContain("DRAFT_MUST_NOT_APPEAR");
      expect(prompt).not.toContain("OLD_FEEDBACK");
      db.prepare("UPDATE learning_items SET deleted_at=9 WHERE id=?").run(itemId);
      const deletedPrompt = await buildPrompt(makeContext({ project_id: projectId, project_dir: `/tmp/${projectId}` }), { type: "user.message", text: "iterate" });
      expect(deletedPrompt).not.toContain("<burnguard-learning-context-v1>");
      db.prepare("UPDATE learning_items SET deleted_at=NULL WHERE id=?").run(itemId);
    } finally {
      db.prepare("UPDATE learning_items SET deleted_at=NULL WHERE id=?").run(itemId);
    }
  });

  test("Given stale digest schema and project identity When prompts are built Then no incompatible context is injected", async () => {
    const db = getSqlite();
    const suffix = `${process.pid}-${Date.now()}`;
    const projectId = `prompt-reject-project-${suffix}`;
    const wrongProjectId = `prompt-wrong-project-${suffix}`;
    const itemId = `prompt-reject-item-${suffix}`;
    db.prepare("INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(projectId, "Prompt reject", "prototype", `/tmp/${projectId}`, "codex", 5, "current-digest", 1, 1);
    db.prepare("INSERT INTO projects (id,name,type,dir_path,backend_id,current_revision,current_digest,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(wrongProjectId, "Wrong", "prototype", `/tmp/${wrongProjectId}`, "codex", 5, "current-digest", 1, 1);
    db.prepare("INSERT INTO learning_items (id,kind,title,content_json,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(itemId, "lesson", "Reject", JSON.stringify({ schema_revision: 1, owner: "user", seed_key: null, revision: 0, content: { summary: "Reject" } }), 1, 1);
    db.prepare("INSERT INTO learning_progress (item_id,state,revision,feedback_draft,updated_at) VALUES (?,'in_progress',1,'draft',1)").run(itemId);
    const insert = db.prepare("INSERT INTO learning_checkpoints (id,item_id,project_id,parent_checkpoint_id,artifact_revision,artifact_digest,feedback,next_context_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
    insert.run(`stale-${suffix}`, itemId, projectId, null, 5, "stale-digest", "STALE", JSON.stringify({ kind: "iteration", parent_checkpoint_id: `stale-${suffix}`, schema_revision: 1, artifact_revision: 5, artifact_digest: "stale-digest" }), 2);
    insert.run(`schema-${suffix}`, itemId, projectId, null, 5, "current-digest", "SCHEMA", JSON.stringify({ kind: "iteration", parent_checkpoint_id: `schema-${suffix}`, schema_revision: 2, artifact_revision: 5, artifact_digest: "current-digest" }), 3);
    insert.run(`wrong-${suffix}`, itemId, wrongProjectId, null, 5, "current-digest", "WRONG_PROJECT", JSON.stringify({ kind: "iteration", parent_checkpoint_id: `wrong-${suffix}`, schema_revision: 1, artifact_revision: 5, artifact_digest: "current-digest" }), 4);

    try {
      const prompt = await buildPrompt(makeContext({ project_id: projectId, project_dir: `/tmp/${projectId}` }), { type: "user.message", text: "iterate" });

      expect(prompt).not.toContain("<burnguard-learning-context-v1>");
      expect(prompt).not.toContain("STALE");
      expect(prompt).not.toContain("SCHEMA");
      expect(prompt).not.toContain("WRONG_PROJECT");
      expect(prompt).toContain("<burnguard-learning-warning code=\"incompatible_checkpoint\" />");
    } finally {
      db.prepare("UPDATE learning_items SET deleted_at=NULL WHERE id=?").run(itemId);
    }
  });

  test("serializes open comments with slide scope for deck pins", async () => {
    const prompt = await buildPrompt(
      makeContext(
        { project_type: "slide_deck", entrypoint: "deck.html" },
        {
          openComments: [
            {
              id: "c1",
              rel_path: "deck.html",
              node_selector: '[data-bg-node-id="hero"]',
              x_pct: 25,
              y_pct: 30,
              body: "Tighten hero copy",
              slide_index: 2,
            },
            {
              id: "c2",
              rel_path: "deck.html",
              node_selector: "body",
              x_pct: 10,
              y_pct: 90,
              body: "  ",
              slide_index: null,
            },
          ],
        },
      ),
      { type: "user.message", text: "address comments" },
    );
    expect(prompt).toContain("## Open comments");
    expect(prompt).toContain("slide=3 (slide_index=2)");
    expect(prompt).toContain("Tighten hero copy");
    expect(prompt).toContain("file-wide");
    expect(prompt).toContain("(no note)");
  });

  test("omits attachments section when there are none", async () => {
    const prompt = await buildPrompt(makeContext(), {
      type: "user.message",
      text: "hi",
    });
    expect(prompt).not.toContain("## Attachments");
  });

  test("does not echo unmatched raw attachment paths", async () => {
    const prompt = await buildPrompt(makeContext(), {
      type: "user.message",
      text: "see files",
      attachments: ["/tmp/a.png", "/tmp/b.png"],
    });
    expect(prompt).toContain("## Attachments");
    expect(prompt).not.toContain("/tmp/a.png");
    expect(prompt).not.toContain("/tmp/b.png");
  });

  test("inlines compact summaries for pptx/pdf attachments and points Read to extracted text", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "bg-prompt-attachment-"));
    try {
      const filePath = path.join(tempDir, "deck.pptx");
      await writeFile(filePath, "");
      await writeFile(
        attachmentSummaryPath(filePath),
        JSON.stringify({
          kind: "pptx",
          brand_name: "Quarterly Review",
          page_count: 3,
          fonts: ["Inter"],
          colors: ["#112233", "#445566"],
          font_sizes: ["24pt"],
          font_weights: ["700"],
          spacing_values: [],
          radii: [],
          shadows: [],
          notes: ["Token-optimized upload summary generated via Python extractor."],
          headings: ["Quarterly Review"],
          bodies: ["Revenue expanded 22% year over year."],
          misc_lines: ["Get started", "Revenue expanded 22% year over year."],
          pages: [
            {
              index: 1,
              title: "Quarterly Review",
              summary: "Revenue expanded 22% year over year.",
              text_excerpt:
                "Quarterly Review\nRevenue expanded 22% year over year.",
            },
          ],
        }),
        "utf8",
      );
      await writeFile(
        attachmentExtractedTextPath(filePath),
        "# Extracted attachment text",
        "utf8",
      );

      const prompt = await buildPrompt(
        makeContext({ project_dir: tempDir }, {
          attachments: [
            {
              id: "a1",
              session_id: "s1",
              turn_id: null,
              file_path: filePath,
              mime_type:
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              original_name: "deck.pptx",
              size_bytes: 1024,
              sha256: null,
              source_role: "ordinary_content",
              source_role_explicit: false,
              created_at: Date.now(),
            },
          ],
        }),
        {
          type: "user.message",
          text: "Use this attachment as source material.",
          attachments: [filePath],
        },
      );

      expect(prompt).toContain(
        "source_path: deck.pptx (binary attachment; do not Read/Glob/Bash this file directly)",
      );
      expect(prompt).toContain(
        "extracted_text_path: deck.pptx.extracted.md (safe text version for Read)",
      );
      expect(prompt).toContain(
        "summary: PPTX | 3 page(s) | brand=Quarterly Review",
      );
      expect(prompt).toContain("colors: #112233, #445566");
      expect(prompt).toContain(
        "page 1: Quarterly Review -> Revenue expanded 22% year over year.",
      );
      expect(prompt).toContain("use this compact summary first for planning");
      expect(prompt).toContain(
        "if an extracted_text_path is listed and you need slide/page wording, Read that file instead of the original binary file.",
      );
      expect(prompt).toContain(
        "do not use Read, Glob, or Bash against the original .pptx/.pdf attachment path.",
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("Given a multi-page prototype and active page When full and compact prompts are built Then both contexts include one navigation contract", async () => {
    // Given
    const tempDir = await mkdtemp(path.join(tmpdir(), "burnguard-site-prompt-"));
    try {
      await writeFile(path.join(tempDir, "index.html"), '<title>Home</title><nav data-bg-shared="nav"><a href="about.html">About</a><a href="missing.html">Missing</a></nav><main data-bg-content><h1 data-bg-node-id="home-title">Home</h1></main>');
      await writeFile(path.join(tempDir, "about.html"), '<title>About</title><nav data-bg-shared="nav"><a aria-current="page" href="about.html">About</a></nav><main data-bg-content><h1 data-bg-node-id="about-title">About</h1></main>');
      const context = makeContext({ project_dir: tempDir }, { files: [
        { rel_path: "index.html", category: "html" },
        { rel_path: "about.html", category: "html" },
      ] });

      // When / Then
      for (const contextMode of ["full", "compact"] as const) {
        const prompt = await buildPrompt(context, { type: "user.message", text: "현재 페이지를 수정해줘", active_rel_path: "about.html" }, { contextMode });
        expect(prompt).toContain("## Active page: about.html");
        expect(prompt).toContain("## Site map");
        expect(prompt).toContain("- 1. index.html (home)");
        expect(prompt).toContain("MISSING: index.html -> missing.html");
        expect(prompt.split(PROTOTYPE_NAVIGATION_CONTRACT.trim())).toHaveLength(2);
        expect(prompt).toMatch(/## Active page: about\.html\nabout\.html —/u);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
