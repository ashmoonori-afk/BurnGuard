import { Check, Clipboard, Terminal } from "lucide-react";
import { useState } from "react";
import type { HandoffContinuation } from "@bg/shared";
import { useT } from "@/i18n/t";

type CliName = keyof HandoffContinuation["commands"];

export default function HandoffCommands({
  continuation,
}: {
  readonly continuation: HandoffContinuation;
}) {
  const t = useT();
  const [copied, setCopied] = useState<CliName | "failed" | null>(null);

  function copy(name: CliName): void {
    void navigator.clipboard.writeText(continuation.commands[name]).then(
      () => setCopied(name),
      () => setCopied("failed"),
    );
  }

  return (
    <div className="ml-6 space-y-2 rounded-md bg-muted/70 p-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-foreground">
        <Terminal className="h-3 w-3" aria-hidden="true" />
        {t("export.handoff.continue")}
      </div>
      <p className="text-pretty text-[10px] text-muted-foreground">
        {t("export.handoff.commandHint", {
          path: continuation.prompt_file,
        })}
      </p>
      {(["claude_code", "codex"] as const).map((name) => (
        <div key={name} className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-foreground">
              {name === "claude_code" ? "Claude Code" : "Codex"}
            </span>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-[10px] text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("export.handoff.copyCommand", {
                name: name === "claude_code" ? "Claude Code" : "Codex",
              })}
              onClick={() => copy(name)}
            >
              {copied === name
                ? <Check className="h-3 w-3" aria-hidden="true" />
                : <Clipboard className="h-3 w-3" aria-hidden="true" />}
              {copied === name
                ? t("export.handoff.copied")
                : t("export.handoff.copy")}
            </button>
          </div>
          <code className="block select-all overflow-x-auto whitespace-nowrap rounded bg-background px-2 py-1.5 text-[10px] text-foreground">
            {continuation.commands[name]}
          </code>
        </div>
      ))}
      {copied === "failed" && (
        <p role="alert" className="text-pretty text-[10px] text-destructive">
          {t("export.handoff.copyFailed")}
        </p>
      )}
    </div>
  );
}
