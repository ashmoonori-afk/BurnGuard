import type {
  FileInfo,
  NormalizedEvent,
  ProjectDetail,
  SessionInfo,
} from "@bg/shared";
import type { ArtifactTab } from "@/types/project";

const T0 = Date.now() - 5 * 60 * 1000;
const turn = "turn-01JFAKE0000000000";

/**
 * FE-S1-05 placeholder: one full turn exercising every NormalizedEvent type
 * so the renderer is visually complete before live SSE wiring in FE-S3-*.
 * Codex swaps this import for `fetch` + SSE subscription during wiring.
 */
export const mockEvents: NormalizedEvent[] = [
  { id: "e01", ts: T0, type: "status.running" },
  {
    id: "e02",
    ts: T0 + 400,
    type: "chat.thinking",
    turnId: turn,
    text: "Reading the design system and the brand voice rules...",
  },
  {
    id: "e03",
    ts: T0 + 600,
    type: "tool.started",
    turnId: turn,
    toolCallId: "tu1",
    tool: "Read",
    input: { file_path: "SKILL.md" },
  },
  {
    id: "e04",
    ts: T0 + 1200,
    type: "tool.finished",
    turnId: turn,
    toolCallId: "tu1",
    tool: "Read",
    ok: true,
  },
  {
    id: "e05",
    ts: T0 + 1400,
    type: "chat.thinking",
    turnId: turn,
    text: "Creating the slide deck structure with 15 slides...",
  },
  {
    id: "e06",
    ts: T0 + 1800,
    type: "tool.started",
    turnId: turn,
    toolCallId: "tu2",
    tool: "Write",
    input: { file_path: "deck.html" },
  },
  {
    id: "e07",
    ts: T0 + 2400,
    type: "tool.finished",
    turnId: turn,
    toolCallId: "tu2",
    tool: "Write",
    ok: true,
  },
  {
    id: "e08",
    ts: T0 + 2500,
    type: "file.changed",
    turnId: turn,
    action: "created",
    path: "deck.html",
  },
  {
    id: "e09",
    ts: T0 + 2600,
    type: "file.changed",
    turnId: turn,
    action: "created",
    path: "deck-stage.js",
  },
  {
    id: "e10",
    ts: T0 + 2700,
    type: "chat.delta",
    turnId: turn,
    text: "I built a 15-slide investor deck using the Northvale Capital design system. ",
  },
  {
    id: "e11",
    ts: T0 + 2800,
    type: "chat.delta",
    turnId: turn,
    text: "The hero slide uses Zen Serif at 220px for impact, and the rest of the deck follows the editorial-finance palette. ",
  },
  {
    id: "e12",
    ts: T0 + 2900,
    type: "chat.delta",
    turnId: turn,
    text: "Let me know if you want me to adjust the title size or the subtitle copy.",
  },
  { id: "e13", ts: T0 + 3000, type: "chat.message_end", turnId: turn },
  {
    id: "e14",
    ts: T0 + 3100,
    type: "usage.delta",
    input: 4231,
    output: 1827,
    cached: 12843,
  },
  {
    id: "e15",
    ts: T0 + 3200,
    type: "status.idle",
    stopReason: "end_turn",
  },
];

export const mockProject: ProjectDetail = {
  id: "01J8F9H1A0RECENTPROJ000002",
  name: "Quarterly Review Deck",
  type: "slide_deck",
  design_system_id: "northvale-capital",
  design_system_name: "Northvale Capital Design System",
  thumbnail_path: null,
  updated_at: 1713747600000,
  archived_at: null,
  dir_path: "C:/Users/user/.burnguard/data/projects/01J8F9H1A0RECENTPROJ000002",
  entrypoint: "deck.html",
  backend_id: "claude-code",
  options_json: JSON.stringify({ use_speaker_notes: false }),
  current_revision: 0,
  current_digest: null,
};

export const mockSession: SessionInfo = {
  id: "01SFAKE000000SESSIONID0001",
  project_id: mockProject.id,
  backend_id: "claude-code",
  status: "idle",
  usage: {
    input: 4231,
    output: 1827,
    cached: 12843,
    cache_write: 2048,
  },
  updated_at: T0 + 3200,
  last_active_at: T0 + 3200,
};

export const mockFileTree: FileInfo[] = [
  { rel_path: "assets", category: "folder", size_bytes: null },
  { rel_path: "fonts", category: "folder", size_bytes: null },
  { rel_path: "investor-deck", category: "folder", size_bytes: null },
  { rel_path: "preview", category: "folder", size_bytes: null },
  { rel_path: "ui_kits", category: "folder", size_bytes: null },
  { rel_path: "uploads", category: "folder", size_bytes: null },
  { rel_path: "colors_and_type.css", category: "stylesheet", size_bytes: 7649 },
  { rel_path: "deck-stage.js", category: "script", size_bytes: 4280 },
  { rel_path: "SKILL.md", category: "document", size_bytes: 1795 },
  { rel_path: "README.md", category: "document", size_bytes: 8866 },
  { rel_path: "deck.html", category: "html", size_bytes: 18200 },
];

export const mockArtifactTabs: ArtifactTab[] = [
  {
    id: "design-system",
    title: "Design System",
    kind: "design_system",
    closeable: false,
  },
  {
    id: "design-files",
    title: "Design Files",
    kind: "design_files",
    closeable: false,
  },
  {
    id: "deck",
    title: "Quarterly Review Deck.html",
    kind: "file",
    relPath: "deck.html",
    closeable: true,
  },
];
