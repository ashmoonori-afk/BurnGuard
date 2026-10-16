import type { ProjectType } from "@bg/shared";
import { INITIAL_BRIEF_FORM, type BriefForm } from "@/lib/project-creation";

/** The brief that would produce one bundled example: what "See the brief" shows and "Start from this" pre-fills. */
export type ExampleBrief = {
  readonly type: Extract<ProjectType, "prototype" | "slide_deck" | "graphic">;
  readonly designSystemId: string;
  readonly name: string;
  readonly audience: string;
  readonly objective: string;
};

type Sample = { readonly slug: string; readonly brand: string; readonly audience: string; readonly web: string; readonly slides: string; readonly graphic: string };

const SAMPLES: readonly Sample[] = [
  { slug: "sonnel", brand: "SONNEL", audience: "Musicians and sound designers looking for precise hardware",
    web: "A product website for a cobalt sound-synthesis lab: hero with the instrument, three feature columns, specifications and a pre-order call to action.",
    slides: "A launch deck for a sound-synthesis instrument: the problem, the instrument, how it sounds, specifications and availability.",
    graphic: "A social launch poster for a sound-synthesis instrument with the product name, one line of copy and the release date." },
  { slug: "foliover", brand: "FOLIOVER", audience: "Readers interested in materials, craft and culture",
    web: "A website for an independent journal of materials and culture: current issue, featured essays, archive and subscription.",
    slides: "A deck presenting the new issue of an independent journal: theme, featured essays, contributors and how to subscribe.",
    graphic: "A cover-style poster announcing the new issue of an independent journal with its theme and issue number." },
  { slug: "oddward", brand: "ODDWARD", audience: "Prospective clients of an experimental creative studio",
    web: "A portfolio website for an experimental creative studio with expressive typography: selected work, services and contact.",
    slides: "A credentials deck for an experimental creative studio: approach, selected projects, services and team.",
    graphic: "A typographic poster for an experimental creative studio's open studio night." },
  { slug: "velune", brand: "VELUNE", audience: "Interior designers and homeowners choosing lighting",
    web: "A product website for moonlit glass lighting in deep plum and opal mint: collection, materials, room views and stockists.",
    slides: "A collection deck for a glass lighting brand: the collection, materials, rooms it suits and ordering.",
    graphic: "A product poster for a new glass pendant light with the product name and one line of copy." },
  { slug: "halide", brand: "HALIDE", audience: "Clients who need optical design and lens engineering",
    web: "A website for an optics studio built on refracting liquid-glass rings: what the studio designs, process, selected work and a consultation request.",
    slides: "A capabilities deck for an optics studio: what it designs, process, selected work and how to start a project.",
    graphic: "A poster for an optics studio with a refracting glass ring as the key visual and one line about what it designs." },
];

const FORMATS = { prototype: "web", slide_deck: "slides", graphic: "graphic" } as const;
const LABELS = { prototype: "Web", slide_deck: "Slides", graphic: "Graphic" } as const;

/** The starter brief for a bundled example card, or null for anything that is not a bundled sample. */
export function exampleBrief(card: { readonly kind?: string; readonly designSystemId?: string | null }): ExampleBrief | null {
  const type = card.kind === "prototype" || card.kind === "slide_deck" || card.kind === "graphic" ? card.kind : null;
  const slug = card.designSystemId?.startsWith("sample-system-original-") ? card.designSystemId.slice("sample-system-original-".length) : null;
  const sample = SAMPLES.find((entry) => entry.slug === slug);
  if (type === null || !sample || !card.designSystemId) return null;
  return { type, designSystemId: card.designSystemId, name: `My ${sample.brand} ${LABELS[type]}`, audience: sample.audience, objective: sample[FORMATS[type]] };
}

/**
 * The creation draft "Start from this" writes: the example's brief on an otherwise empty form. Nothing is sent, and the
 * sample's own design system is not preselected because choosing it copies the finished example instead of generating.
 */
export function exampleBriefForm(brief: ExampleBrief): BriefForm {
  return { ...INITIAL_BRIEF_FORM, name: brief.name, audience: brief.audience, objective: brief.objective };
}
