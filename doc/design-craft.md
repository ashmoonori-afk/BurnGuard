# BurnGuard design craft

BurnGuard's independently written generation guidance lives in `packages/backend/src/harness/design-craft.ts`. It derives concrete layout, copy, type, color and interaction checks from the user's purpose and the existing project. No external instructions, executable, agent skill or pattern collection are shipped by this integration.

The shared prompt builder includes these rules for every project type in both full and compact modes, including projects without a design system. Vanilla mode changes adapter configuration flags, not this product-owned prompt. Ordinary AI edit requests pass through the same builder as initial generation. Existing selected directions, project-specific skills and font tokens remain authoritative.

Before completion, the generating agent must inspect the rendered target, exercise applicable interactions, correct observed failures and report any unavailable verification. This is runtime guidance, not an automatic visual-quality certification. The prompt test verifies inclusion and ordering across project types and context modes; it does not establish that a particular generated artifact looks good or improves business results.

The current product scope covers UX diagnosis, improvement requests and an internal pattern library. Competitor monitoring and measured conversion or revenue claims are outside that scope.

The resolved model also selects a short execution focus: direct artifact acceptance for Codex, an inspect/edit/check sequence for Claude, and bounded exploration for Opus. CommandCode follows its selected Claude model. LOW remains the default and explicit generation settings are preserved; this routing has no measured speed or quality guarantee.
