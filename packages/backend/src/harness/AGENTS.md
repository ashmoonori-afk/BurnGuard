# PROMPT HARNESS KNOWLEDGE BASE

## OVERVIEW

Prompt construction, structural summaries, and shipped generation skills; earned this guide at score 9 for a distinct high-fan-in domain and widely referenced prompt exports. 16 root prompt/rule/extractor modules, 5 `skills/*-skill.ts`, 1 generated Lucide asset module (~2.3k LOC).

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Change prompt order | `prompt-builder.ts` | Machine-tagged contexts precede skills and user request |
| Design-system context | `prompt-design-system.ts` | Enforces bounded skill/token inclusion; selects the surface from the project type |
| Per-surface tokens and prose | `../services/design-system-surface.ts` | Resolves `surfaces/<surface>.css` with bundled and derived fallbacks; `@bg/shared` `design-surface.ts` is the contract |
| Attachments | `prompt-attachments.ts`, `prompt-visual-sources.ts` | Original binary paths remain private |
| Reference layouts | `prompt-reference-layout.ts` | Immutable underlay and exporter constraints |
| Existing artifact map | `structure-extractor.ts` | Summarize HTML instead of embedding full files |
| Project skills | `skills/*-skill.ts` | Five separate skills: deck, prototype, diagram, reference-layout, visual-craft |
| Compact mode | `prompt-compact-skills.ts` | Stable contract references replace full prose |
| Lucide assets | `assets/lucide/icons.ts`, `assets/lucide/reference.md` | Generated inline reference shipped with the harness; no CDN |

## CONVENTIONS

- Keep prompt order: project/research/design context, sources, structural map, skills, delivery rules, request.
- Emit machine-consumed contexts inside versioned sentinel tags with stable JSON shapes.
- Select exactly the project-type skill; do not cross-inject deck, prototype, and diagram guidance.
- Select exactly one design surface from `project_type` (`website`/`slides`/`content`). A fixed surface receives the brand half of the layout contract - the `composition` section and `--family-*` - and never its grid, regions or responsive rules; see `doc/22-design-system-surfaces-2026-09-15.md`.
- In compact mode, point the agent to exact files and summaries rather than pasting large artifacts.
- Bound excerpts, file lists, attachment summaries, and skill content explicitly.
- Preserve Korean and multilingual text bytes; grapheme-sensitive behavior belongs in renderers.
- Treat skill text as shipped runtime behavior even though it is stored as TypeScript strings.

## ANTI-PATTERNS

- Do not expose original PPTX/PDF paths or ask the agent to read private upload directories.
- Do not paste entire HTML, CSS, extracted text, or binary-derived documents into the prompt.
- Do not infer immutable-reference role from filename alone when explicit request metadata exists.
- Do not silently change sentinel names, section ordering, or fixed output contracts consumed downstream.
- Do not introduce external icon URLs, sprite references, icon fonts, or network dependencies.
- Do not duplicate project-wide instructions inside every skill; keep project-type rules scoped.
- Do not test incidental prose wording; test machine tags, parsed fields, and shipped-copy equality when required.
