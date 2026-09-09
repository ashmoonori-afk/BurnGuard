import { useMemo } from "react";
import { FileImage } from "lucide-react";
import type { FileInfo } from "@bg/shared";
import { listExistingVisualSources } from "./visual-source-selection";

export function VisualSourceCandidates({ files }: { readonly files: readonly FileInfo[] }) {
  const sources = useMemo(() => listExistingVisualSources(files), [files]);
  return (
    <details className="mt-3 text-xs leading-relaxed text-muted-foreground">
      <summary className="cursor-pointer rounded py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        PDF · PPTX 첨부 안내{sources.length > 0 ? ` · 기존 자료 ${sources.length}개` : ""}
      </summary>
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
      <p>최대 8개, 파일당 10MB, 전체 25MB까지 첨부할 수 있어요. 파일마다 일반 자료 또는 수정하지 않는 시각 참조를 선택해 주세요.</p>
      {sources.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-foreground">프로젝트 안의 시각 파일</p>
          <ul className="max-h-28 space-y-1 overflow-y-auto overscroll-contain pr-1" aria-label="기존 프로젝트 시각 파일">
            {sources.map((source) => (
              <li key={source.rel_path} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <FileImage className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={source.rel_path}>{source.rel_path}</span>
                <span className="shrink-0 text-[10px]">편집 가능</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">기존 파일은 수정할 수 있어요. 원본을 유지할 시각 참조는 별도로 업로드해 주세요.</p>
        </div>
      )}
      <p>URL·웹·스톡 이미지는 첨부할 수 없어요. 로컬 PDF 또는 PPTX 파일을 사용해 주세요.</p>
    </div>
    </details>
  );
}
