import {
  Folder,
  FileCode,
  FileText,
  Image as ImageIcon,
  File,
} from "lucide-react";
import type { FileInfo } from "@bg/shared";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER: FileInfo["category"][] = [
  "folder",
  "stylesheet",
  "script",
  "html",
  "asset",
  "document",
  "other",
];

const CATEGORY_LABEL: Record<FileInfo["category"], string> = {
  folder: "폴더",
  stylesheet: "스타일시트",
  script: "스크립트",
  html: "HTML",
  asset: "에셋",
  document: "문서",
  other: "기타",
};

function iconFor(category: FileInfo["category"]) {
  switch (category) {
    case "folder":
      return Folder;
    case "stylesheet":
    case "script":
    case "html":
      return FileCode;
    case "document":
      return FileText;
    case "asset":
      return ImageIcon;
    default:
      return File;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

export default function FileTree({
  files,
  activePath,
  onOpen,
}: {
  files: FileInfo[];
  activePath: string | null;
  onOpen: (file: FileInfo) => void;
}) {
  const byCategory = new Map<FileInfo["category"], FileInfo[]>();
  for (const f of files) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  return (
    <nav aria-label="프로젝트 파일 탐색" className="space-y-5 p-3 text-sm">
      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory.get(cat);
        if (!list || list.length === 0) return null;
        return (
          <section key={cat}>
            <div className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-muted-foreground">
              <span>{CATEGORY_LABEL[cat]}</span>
              <span className="tabular-nums" aria-label={`${list.length}개`}>{list.length}</span>
            </div>
            <ul className="space-y-1">
              {list.map((f) => {
                const Icon = iconFor(f.category);
                const active = activePath === f.rel_path;
                return (
                  <li key={f.rel_path}>
                    <button
                      type="button"
                      onClick={() => onOpen(f)}
                      aria-current={active ? "page" : undefined}
                      title={f.rel_path}
                      className={cn(
                        "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        active
                          ? "border-accent/25 bg-accent/10 font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", active && "text-accent")} />
                      <span className="min-w-0 flex-1 truncate">{f.rel_path}</span>
                      {f.size_bytes != null && (
                        <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground">
                          {formatSize(f.size_bytes)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
