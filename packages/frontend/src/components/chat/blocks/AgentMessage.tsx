import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import { CheckCircle2, CircleMinus, CircleSlash, Loader2, OctagonX, PauseCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TurnDisposition } from "@/lib/turn-disposition";
import { useT, type MessageKey } from "@/i18n/t";
import { providerMessageHref, providerMessageText } from "@/lib/provider-message";

const DISPOSITION_COPY: Record<TurnDisposition, { readonly key: MessageKey; readonly icon: LucideIcon; readonly tone: string }> = {
  pending: { key: "chat.turn.pending", icon: Loader2, tone: "text-muted-foreground" },
  committed: { key: "chat.turn.committed", icon: CheckCircle2, tone: "text-muted-foreground" },
  unchanged: { key: "chat.turn.unchanged", icon: CircleMinus, tone: "text-muted-foreground" },
  not_applied: { key: "chat.turn.not_applied", icon: CircleSlash, tone: "text-destructive" },
  rejected: { key: "chat.turn.rejected", icon: OctagonX, tone: "text-destructive" },
  stopped: { key: "chat.turn.stopped", icon: PauseCircle, tone: "text-muted-foreground" },
};

/** A rendered node, typed only as far as the decoded-text masking pass reads it. */
type RenderedNode = { type: string; value?: string; children?: RenderedNode[] };

// Model Markdown becomes React elements only: raw HTML stays literal text, images are dropped rather
// than fetched, and code is the only monospace. Headings keep body size in the narrow chat column.
const HEADING = "text-sm font-semibold leading-6";
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className={HEADING}>{children}</h1>,
  h2: ({ children }) => <h2 className={HEADING}>{children}</h2>,
  h3: ({ children }) => <h3 className={HEADING}>{children}</h3>,
  h4: ({ children }) => <h4 className={HEADING}>{children}</h4>,
  h5: ({ children }) => <h5 className={HEADING}>{children}</h5>,
  h6: ({ children }) => <h6 className={HEADING}>{children}</h6>,
  // Providers write single line breaks as breaks; a paragraph keeps them.
  p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 [&>ol]:mt-1 [&>p+p]:mt-2 [&>ul]:mt-1">{children}</li>,
  blockquote: ({ children }) => <blockquote className="space-y-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="border-border" />,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  pre: ({ children }) => (
    <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-5 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[12px]">
      {children}
    </pre>
  ),
  // The URL transform has already removed every destination that may not leave the app; the label
  // of a removed one stays readable as plain text. Titles are never carried over.
  a: ({ href, children }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm font-medium underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/**
 * Provider text rendered as Markdown. Private references are masked before parsing, and decoded text
 * is masked again so a character reference cannot rebuild a path the first pass hid. Memoized so
 * only the bubble that is still streaming re-parses.
 */
const MessageMarkdown = memo(function MessageMarkdown({ text, projectDir }: { text: string; projectDir?: string }) {
  const maskDecodedText = () => (tree: RenderedNode) => {
    const visit = (node: RenderedNode): void => {
      if (node.type === "text" && node.value !== undefined) node.value = providerMessageText(node.value, projectDir);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
  return (
    <Markdown
      components={MARKDOWN_COMPONENTS}
      disallowedElements={["img"]}
      rehypePlugins={[maskDecodedText]}
      urlTransform={(url) => providerMessageHref(url, projectDir)}
    >
      {providerMessageText(text, projectDir)}
    </Markdown>
  );
});

/**
 * One agent message plus where its turn stands.
 *
 * The standing is always shown: a message whose turn has not published yet says so rather than
 * sitting on screen looking saved, and a refused turn's own text is kept but marked not applied.
 */
export default function AgentMessage({
  text,
  turnId,
  disposition,
  projectDir,
}: {
  text: string;
  turnId: string;
  disposition: TurnDisposition;
  projectDir?: string;
}) {
  const refused = disposition === "not_applied" || disposition === "rejected";
  return (
    <div
      data-qa="agent-message"
      data-turn-id={turnId}
      data-turn-disposition={disposition}
      className={refused ? "rounded-md border border-destructive/30 bg-destructive/5 p-3" : undefined}
    >
      <div className={`min-w-0 space-y-2 break-words text-sm leading-6 ${refused ? "text-muted-foreground" : "text-foreground"}`}>
        <MessageMarkdown text={text} projectDir={projectDir} />
      </div>
      <TurnStanding disposition={disposition} />
    </div>
  );
}

/** Where a turn stands; also shown on its own for a turn stopped before it wrote any message. */
export function TurnStanding({ disposition, turnId }: { disposition: TurnDisposition; turnId?: string }) {
  const t = useT();
  const { key, icon: Icon, tone } = DISPOSITION_COPY[disposition];
  return (
    <div
      data-qa={disposition === "not_applied" ? "turn-not-applied" : "turn-standing"}
      {...(turnId === undefined ? {} : { "data-turn-id": turnId, "data-turn-disposition": disposition })}
      className={`mt-1.5 flex items-start gap-1.5 text-[11px] leading-5 ${tone}`}
    >
      <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{t(key)}</span>
    </div>
  );
}
