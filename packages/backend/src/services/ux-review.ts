import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse, type HTMLElement } from "node-html-parser";
import type { ProjectType, UxReviewFinding, UxReviewReport } from "@bg/shared";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { assertSafeName, PathBoundaryError, resolveWithin } from "../security/path-boundary";
import { CanonicalTreeManifestError, inspectCanonicalTree } from "./canonical-tree-manifest";
import { htmlWithEditableIds } from "./file-patch";

export class UxReviewError extends Error {
  constructor(readonly code: "project_not_found" | "invalid_review_path" | "review_unavailable" | "stale_artifact_identity", message: string) { super(message); }
}

/** ponytail: bounded static HTML heuristics; rendered behavior and visual judgment require a separate review. */
export function reviewHtml(html: string, kind: ProjectType): readonly UxReviewFinding[] {
  if (Buffer.byteLength(html) > 1024 * 1024) throw new UxReviewError("review_unavailable", "HTML exceeds review limits");
  const root = parse(htmlWithEditableIds(html));
  root.querySelectorAll("script,style,template,noscript,head").forEach((node) => node.remove());
  const nodes = root.querySelectorAll("*");
  if (nodes.length > 5000) throw new UxReviewError("review_unavailable", "HTML exceeds review limits");
  for (const node of nodes) { let depth = 0; for (let parent = node.parentNode; parent; parent = parent.parentNode) if (++depth > 100) throw new UxReviewError("review_unavailable", "HTML exceeds review limits"); }
  const visible = (node: HTMLElement): boolean => {
    for (let current: HTMLElement | null = node; current; current = current.parentNode) {
      if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(current.getAttribute("style") ?? "")) return false;
    }
    return true;
  };
  const text = (node: HTMLElement) => node.textContent.replace(/\s+/g, " ").trim();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ariaName = (node: HTMLElement): string => (node.getAttribute("aria-label") ?? "").trim() || (node.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => { const label = byId.get(id); return label ? text(label) : ""; }).join(" ").trim();
  const name = (node: HTMLElement): string => ariaName(node) || text(node) || node.querySelectorAll("img[alt]").map((image) => image.getAttribute("alt") ?? "").join(" ").trim();
  const anchorCounts = new Map<string, number>();
  for (const node of nodes) { const id = node.getAttribute("data-bg-node-id"); if (id) anchorCounts.set(id, (anchorCounts.get(id) ?? 0) + 1); }
  const labeledIds = new Set(nodes.filter((node) => node.tagName === "LABEL" && text(node)).map((node) => node.getAttribute("for")));
  const findings: UxReviewFinding[] = [];
  const add = (code: string, node: HTMLElement | null, title: string, evidence: string, proposal: string, pattern_id: string, priority: "high" | "medium" = "medium") => {
    if (findings.length >= 40) return;
    const rawId = node?.getAttribute("data-bg-node-id");
    const node_bg_id = rawId && rawId.length <= 160 && anchorCounts.get(rawId) === 1 ? rawId : null;
    findings.push({ id: `${code}:${findings.length}`, code, priority, title, evidence: evidence.slice(0, 240), proposal, node_bg_id, pattern_id });
  };
  const headings = nodes.filter((node) => /^H[1-6]$/.test(node.tagName) && visible(node));
  if (kind === "prototype" && headings.filter((node) => node.tagName === "H1").length !== 1) add("page_heading", null, "페이지 제목 구조 검토", "보이는 H1이 정확히 하나가 아닙니다.", "페이지의 주목적을 나타내는 제목을 정하고 문서 구조에 맞는지 검토하세요.", "heading");
  let previous = 0;
  for (const node of headings) { const level = Number(node.tagName.slice(1)); if (previous && level > previous + 1) add("heading_jump", node, "제목 단계 검토", `${previous}단계 제목 다음에 ${level}단계 제목이 있습니다.`, "내용의 상하 관계에 맞도록 제목 단계를 조정하세요.", "heading"); previous = level; }
  for (const node of nodes.filter(visible)) {
    if (node.tagName === "BUTTON" || node.getAttribute("role") === "button") {
      const label = name(node);
      if (!label || /^(ok|submit|click here|확인|클릭|보내기)$/i.test(label)) add("action_name", node, "버튼의 행동을 구체화", label ? `일반적인 버튼 이름: ${label}` : "버튼의 접근 가능한 이름을 찾지 못했습니다.", "문맥에서 행동과 결과를 알 수 있는 버튼 이름을 작성하세요.", "action", label ? "medium" : "high");
    }
    if (["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName) && !/^(hidden|submit|button|reset|image)$/i.test(node.getAttribute("type") ?? "")) {
      const explicitLabel = node.id && labeledIds.has(node.id);
      let wrapped = false; for (let parent = node.parentNode; parent; parent = parent.parentNode) if (parent.tagName === "LABEL" && text(parent)) wrapped = true;
      if (!explicitLabel && !wrapped && !ariaName(node)) add("input_label", node, "입력 레이블 연결", "연결된 레이블 또는 접근 가능한 이름을 찾지 못했습니다.", "보이는 label을 입력 id와 연결하고 필요한 입력 예시를 설명하세요.", "form", "high");
    }
    if (node.tagName === "A" && node.hasAttribute("href") && (!name(node) || /^(here|more|read more|click here|여기|더 보기|자세히)$/i.test(name(node)))) add("link_name", node, "링크의 목적 명시", name(node) ? `일반적인 링크 이름: ${name(node)}` : "링크의 접근 가능한 이름을 찾지 못했습니다.", "이동할 정보나 목적지를 설명하는 이름으로 바꾸세요.", "link");
    if (node.tagName === "IMG" && !node.hasAttribute("alt")) add("image_alt", node, "이미지 대체 텍스트 검토", "img 요소에 alt 속성이 없습니다.", "정보 이미지에는 문맥에 맞는 대체 텍스트를 쓰고 장식 이미지에는 빈 alt를 지정하세요.", "image", "high");
    if (node.tagName === "P" && text(node).length > (kind === "slide_deck" || kind === "graphic" ? 180 : 500)) add("long_paragraph", node, "문단의 읽기 부담 검토", `문단 길이가 ${text(node).length}자입니다.`, "필요한 내용을 보존하면서 핵심 문장과 세부 설명을 나눌지 검토하세요.", "reading");
  }
  return findings;
}

export async function getProjectUxReview(projectId: string, requestedPath?: string): Promise<UxReviewReport> {
  const project = await getProjectDetail(projectId);
  if (!project) throw new UxReviewError("project_not_found", "Project not found");
  const source_path = requestedPath ?? project.entrypoint;
  try {
    if (!source_path || source_path.length > 512 || !/\.html?$/i.test(source_path)) throw new PathBoundaryError("invalid_path", "Invalid HTML path");
    source_path.split("/").forEach(assertSafeName);
  } catch { throw new UxReviewError("invalid_review_path", "A canonical HTML path is required"); }
  try {
    const dir = resolveManagedPath(projectsDir, project.dir_path);
    const manifest = await inspectCanonicalTree(dir);
    if (!project.current_digest || manifest.tree_digest !== project.current_digest) throw new UxReviewError("stale_artifact_identity", "Artifact changed; refresh before reviewing");
    const entry = manifest.files.find((file) => file.path === source_path);
    if (!entry || entry.size > 1024 * 1024) throw new UxReviewError("review_unavailable", "Review requires a canonical HTML file no larger than 1 MB");
    const bytes = await readFile(resolveWithin(dir, source_path));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new UxReviewError("stale_artifact_identity", "Artifact changed during review");
    const findings = reviewHtml(new TextDecoder("utf-8", { fatal: true }).decode(bytes), project.type);
    const after = await getProjectDetail(projectId);
    if (after?.current_revision !== project.current_revision || after.current_digest !== project.current_digest || (await inspectCanonicalTree(dir)).tree_digest !== project.current_digest) throw new UxReviewError("stale_artifact_identity", "Artifact changed during review");
    return { schema_version: 1, project_id: projectId, artifact_revision: project.current_revision, artifact_digest: project.current_digest, source_path, basis: "local_html_heuristics", findings, limitations: ["정적 HTML 규칙에 따른 검토 후보이며 사용성 점수나 완료 판정이 아닙니다.", "최대 40개 항목을 표시합니다. CSS·렌더링·상호작용·전환 성과·시각적 완성도는 직접 확인해야 합니다."] };
  } catch (error) {
    if (error instanceof UxReviewError) throw error;
    if (error instanceof PathBoundaryError || error instanceof CanonicalTreeManifestError || error instanceof Error) throw new UxReviewError("review_unavailable", "Canonical HTML is unavailable for review");
    throw error;
  }
}
