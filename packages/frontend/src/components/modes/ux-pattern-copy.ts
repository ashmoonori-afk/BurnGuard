import type { UX_PATTERNS } from "@bg/shared";
import type { MessageKey } from "@/i18n/t";

/** UI-only copy. AI requests retain the shared pattern's original guidance. */
export const UX_PATTERN_COPY = {
  heading: { title: "modes.ux.pattern.heading.title", description: "modes.ux.pattern.heading.description", guidance: "modes.ux.pattern.heading.guidance" },
  action: { title: "modes.ux.pattern.action.title", description: "modes.ux.pattern.action.description", guidance: "modes.ux.pattern.action.guidance" },
  form: { title: "modes.ux.pattern.form.title", description: "modes.ux.pattern.form.description", guidance: "modes.ux.pattern.form.guidance" },
  link: { title: "modes.ux.pattern.link.title", description: "modes.ux.pattern.link.description", guidance: "modes.ux.pattern.link.guidance" },
  image: { title: "modes.ux.pattern.image.title", description: "modes.ux.pattern.image.description", guidance: "modes.ux.pattern.image.guidance" },
  reading: { title: "modes.ux.pattern.reading.title", description: "modes.ux.pattern.reading.description", guidance: "modes.ux.pattern.reading.guidance" },
  feedback: { title: "modes.ux.pattern.feedback.title", description: "modes.ux.pattern.feedback.description", guidance: "modes.ux.pattern.feedback.guidance" },
  typography: { title: "modes.ux.pattern.typography.title", description: "modes.ux.pattern.typography.description", guidance: "modes.ux.pattern.typography.guidance" },
  mobile: { title: "modes.ux.pattern.mobile.title", description: "modes.ux.pattern.mobile.description", guidance: "modes.ux.pattern.mobile.guidance" },
  "anti-slop": { title: "modes.ux.pattern.anti-slop.title", description: "modes.ux.pattern.anti-slop.description", guidance: "modes.ux.pattern.anti-slop.guidance" },
} as const satisfies Record<typeof UX_PATTERNS[number]["id"], Record<"title" | "description" | "guidance", MessageKey>>;
