import { decodeContract, requiredString, requiredNumber, UpgradeContractError } from "./contract-parser";

export interface UxReviewFinding {
  readonly id: string;
  readonly code: string;
  readonly priority: "high" | "medium";
  readonly title: string;
  readonly evidence: string;
  readonly proposal: string;
  readonly node_bg_id: string | null;
  readonly pattern_id: string;
}

export interface UxReviewReport {
  readonly schema_version: 1;
  readonly project_id: string;
  readonly artifact_revision: number;
  readonly artifact_digest: string;
  readonly source_path: string;
  readonly basis: "local_html_heuristics";
  readonly limitations: readonly string[];
  readonly findings: readonly UxReviewFinding[];
}

/** Original guidance; cards invite review and do not claim measured UX outcomes. */
export const UX_PATTERNS = [
  { id: "heading", title: "읽는 순서", description: "페이지의 목적과 정보 위계를 먼저 드러냅니다.", guidance: "주요 제목과 하위 제목을 내용의 관계에 맞게 배치하고 제목 단계가 의미 없이 건너뛰지 않는지 확인하세요. 슬라이드는 장별 구성을 존중하세요." },
  { id: "action", title: "결과가 보이는 행동", description: "버튼을 누르면 무엇이 일어나는지 설명합니다.", guidance: "버튼 이름에 행동과 대상을 담고 중요한 행동 하나가 자연스럽게 눈에 들어오도록 우선순위를 조정하세요." },
  { id: "form", title: "입력 전에 설명", description: "필드의 이름과 입력 이유를 알려 줍니다.", guidance: "각 입력에 지속적으로 보이는 레이블을 연결하고 오류는 문제와 해결 방법을 해당 필드 가까이에 설명하세요." },
  { id: "link", title: "목적지가 있는 링크", description: "링크만 읽어도 목적을 알 수 있게 만듭니다.", guidance: "여기나 더 보기 대신 이동할 정보의 이름을 쓰세요. 아이콘 링크도 접근 가능한 이름을 제공하세요." },
  { id: "image", title: "이미지의 역할", description: "정보 이미지와 장식 이미지를 구분합니다.", guidance: "의미 있는 이미지에는 문맥에 필요한 대체 텍스트를 쓰고 순수 장식에는 빈 alt를 사용하세요. 이미지 내용을 추측해서 쓰지 마세요." },
  { id: "reading", title: "짧은 읽기 단위", description: "긴 설명을 결정에 필요한 단위로 나눕니다.", guidance: "핵심을 먼저 쓰고 서로 다른 내용을 문단이나 목록으로 나누세요. 전문 문서의 정확성과 필요한 설명은 유지하세요." },
  { id: "feedback", title: "행동 뒤의 상태", description: "대기·완료·실패와 다음 행동을 알려 줍니다.", guidance: "사용자 행동 이후의 진행 상태와 결과를 구분하고 실패했을 때 입력을 보존하며 재시도 방법을 제공하세요. 실제 동작을 직접 확인하세요." },
  { id: "typography", title: "타이포그래피와 읽는 위계", description: "읽는 순서와 중요도를 글자 크기와 간격으로 표현합니다.", guidance: "제목·본문·보조 정보의 역할을 구분하고 실제 화면에서 대비, 줄 길이, 줄 간격과 확대 시 읽기 편의성을 확인하세요." },
  { id: "mobile", title: "모바일에서 읽는 흐름", description: "작은 화면에서도 정보와 행동을 놓치지 않게 합니다.", guidance: "좁은 화면에서 읽는 순서, 가로 넘침, 누르기 쉬운 영역과 고정 요소의 가림을 직접 확인하세요. 슬라이드와 그래픽은 지정 캔버스 비율을 존중하세요." },
  { id: "anti-slop", title: "맥락에 맞는 디자인", description: "반복되는 장식 대신 제품의 내용과 목적을 검토합니다.", guidance: "사람의 시각적 판단이 필요한 검토입니다. 관성적인 카드 격자, 장식 배지, 과도한 그라디언트와 반복 문구를 점검하고 실제 콘텐츠의 위계와 브랜드 맥락에 필요한 요소만 남기세요. 스타일 취향을 자동 결함으로 단정하지 마세요." },
] as const;

export function parseUxReviewReport(input: unknown): UxReviewReport {
  const value = decodeContract(input);
  const checkKeys = (record: Readonly<Record<string, unknown>>, keys: readonly string[]) => { if (Object.keys(record).some((key) => !keys.includes(key))) throw new UpgradeContractError("invalid_field", "ux_review"); };
  checkKeys(value, ["schema_version", "project_id", "artifact_revision", "artifact_digest", "source_path", "basis", "limitations", "findings"]);
  if (value.schema_version !== 1 || value.basis !== "local_html_heuristics") throw new UpgradeContractError("unknown_discriminant", "ux_review");
  const string = (record: Readonly<Record<string, unknown>>, key: string, max = 2000) => { const result = requiredString(record, key); if (result.length > max) throw new UpgradeContractError("invalid_field", key); return result; };
  const artifact_digest = string(value, "artifact_digest", 64);
  const source_path = string(value, "source_path", 512);
  if (!/^[a-f0-9]{64}$/.test(artifact_digest) || !/\.html?$/i.test(source_path) || source_path.split("/").some((part) => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part))) throw new UpgradeContractError("invalid_field", "ux_review_identity");
  if (!Array.isArray(value.limitations) || value.limitations.length > 10 || !value.limitations.every((item): item is string => typeof item === "string" && item.length <= 2000) || !Array.isArray(value.findings) || value.findings.length > 40) throw new UpgradeContractError("invalid_field", "ux_review_items");
  const findings = value.findings.map((item): UxReviewFinding => {
    const finding = decodeContract(item);
    checkKeys(finding, ["id", "code", "priority", "title", "evidence", "proposal", "node_bg_id", "pattern_id"]);
    if ((finding.priority !== "high" && finding.priority !== "medium") || !(finding.node_bg_id === null || typeof finding.node_bg_id === "string" && finding.node_bg_id.length > 0 && finding.node_bg_id.length <= 160)) throw new UpgradeContractError("invalid_field", "ux_review_finding");
    const pattern_id = string(finding, "pattern_id", 100);
    if (!UX_PATTERNS.some((pattern) => pattern.id === pattern_id)) throw new UpgradeContractError("invalid_field", "pattern_id");
    return { id: string(finding, "id", 100), code: string(finding, "code", 100), priority: finding.priority, title: string(finding, "title"), evidence: string(finding, "evidence"), proposal: string(finding, "proposal"), node_bg_id: finding.node_bg_id, pattern_id };
  });
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length) throw new UpgradeContractError("invalid_field", "finding_id");
  return { schema_version: 1, project_id: string(value, "project_id", 200), artifact_revision: requiredNumber(value, "artifact_revision"), artifact_digest, source_path, basis: "local_html_heuristics", limitations: value.limitations, findings };
}
