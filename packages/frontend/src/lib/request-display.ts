import { LOCALES } from "@/i18n/locale";
import { messages } from "@/i18n/messages";
import { t, type MessageKey } from "@/i18n/t";

type RequestKind = "quality" | "platform" | "ux";

/** The first line of each app-built request, in every locale it may have been sent under. */
const REQUEST_HEADERS: readonly { readonly key: MessageKey; readonly kind: RequestKind }[] = [
  { key: "modes.quality.fixRequest.intro", kind: "quality" },
  { key: "export.fixRequest.intro", kind: "platform" },
  { key: "modes.ux.request.intro", kind: "ux" },
];

function headerPattern(template: string): RegExp {
  return new RegExp(`^${template.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\n]*")}$`);
}

function recognizeHeader(line: string): RequestKind | null {
  for (const header of REQUEST_HEADERS) {
    for (const locale of LOCALES) {
      const template = messages[header.key][locale];
      if (typeof template === "string" && headerPattern(template).test(line)) return header.kind;
    }
  }
  return null;
}

/** Keep the sent request intact in history/provider input; only simplify the chat bubble. */
export function requestDisplayText(text: string): string {
  const newline = text.indexOf("\n");
  if (newline < 0) return text;
  const kind = recognizeHeader(text.slice(0, newline));
  if (kind === null) return text;
  const rest = text.slice(newline + 1);
  const second = rest.slice(0, rest.indexOf("\n") < 0 ? rest.length : rest.indexOf("\n"));
  if (kind === "ux") return second ? t("workspace.ux.fixDisplay", { title: second }) : text;
  try {
    const payload: unknown = JSON.parse(second);
    if (!Array.isArray(payload)) return text;
    return t(kind === "quality" ? "workspace.quality.fixDisplay" : "workspace.export.fixDisplay", { count: payload.length });
  } catch {
    return text;
  }
}
