# BurnGuard design craft

BurnGuard's independently written generation guidance lives in `packages/backend/src/harness/design-craft.ts`. It derives concrete layout, copy, type, color and interaction checks from the user's purpose and the existing project. No external instructions, executable, agent skill or pattern collection are shipped by this integration.

The shared prompt builder includes these rules for every project type in both full and compact modes, including projects without a design system. The editable Three.js scene contract and the native data chart contract are not part of that fixed block: the builder adds them only when the request, the design brief or an existing project file names 3D or charts (a slide deck always receives the chart contract), and otherwise emits a one-line pointer naming the withheld contract and what unlocks it. Vanilla mode changes adapter configuration flags, not this product-owned prompt. Ordinary AI edit requests pass through the same builder as initial generation. Existing selected directions, project-specific skills and font tokens remain authoritative.

Before completion, the generating agent must inspect the rendered target, exercise applicable interactions, correct observed failures and report any unavailable verification. This is runtime guidance, not an automatic visual-quality certification. The prompt test verifies inclusion and ordering across project types and context modes; it does not establish that a particular generated artifact looks good or improves business results.

The current product scope covers UX diagnosis, improvement requests and an internal pattern library. Competitor monitoring and measured conversion or revenue claims are outside that scope.

A model-dependent "execution focus" wording exists only as a QA comparison arm (`scripts/qa/task-preset-conditions.ts`); production turns pass no task-guidance condition, so no execution focus ships in the prompt. LOW remains the default and explicit generation settings are preserved.
