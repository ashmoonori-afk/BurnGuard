export interface PlainLayoutNote {
  readonly plain: string;
  readonly differs: boolean;
}

const TOKEN_PATTERN = /--[a-z][a-z0-9-]*/gi;
const FILE_PATTERN = /\b[\w./-]+\.(?:css|json|scss|ts|js)\b/gi;

export function plainLayoutNote(text: string, labelFor: (token: string) => string | null, fallbackToken: string, fallbackFile: string): PlainLayoutNote {
  const plain = text
    .replace(TOKEN_PATTERN, (token) => labelFor(token) ?? fallbackToken)
    .replace(FILE_PATTERN, fallbackFile);
  return { plain, differs: plain !== text };
}
