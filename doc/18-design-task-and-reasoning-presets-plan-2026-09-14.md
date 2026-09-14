# Design Task Decomposition and Prompt Presets by Model and Reasoning Effort

- Date: 2026-09-14
- Status: **Planning draft for review. Product implementation and live model comparison experiments have not started.**
- Source baseline inspected: `74cd86c233cf08a9b46aa6096e570747a720b8b6` and the current working tree.
- Goal: Improve design requirement fulfillment and visual quality with less capable models and lower reasoning effort.
- Deliverable: Design principles, task structure, draft presets, change locations, implementation sequence, and validation and adoption criteria.

## 1. Proposed Approach

Review and incorporate the **task decomposition, design decision summaries, executable examples, and validation criteria** that stronger models use to produce good results. Adjust the amount and form of this guidance to the user's selected model and reasoning effort.

The design does not depend on extracting or replicating a model's private internal chain of thought (CoT). The requested CoT structure becomes an observable sequence of `requirements → design decisions → work units → validation evidence`. The length of a reasoning explanation is not a quality metric.

Apply this within the existing single generation turn initially. Use stronger models to develop and evaluate presets, rather than calling one before every user request. A separate planner service, multi-agent orchestrator, automatic model switching, and fine-tuning are outside the initial scope.

## 2. What the References Support and What Still Needs Validation

| Reference | Findings reviewed | Hypothesis for BurnGuard |
|---|---|---|
| [Post Reasoning paper](https://arxiv.org/html/2605.06165v1) | Conditions non-thinking models to give an answer before its explanation. Reports improvements in 88.19% of 117 evaluated model–benchmark combinations. Stopping generation before the additional explanation matters to the cost claim; the paper also includes separate training experiments. | Test a prompt requesting a short design rationale after the result as a separate condition. Its effectiveness for design and tool execution, and any reduction in total cost, remain unproven. |
| [The Problem Solver](https://medium.com/tutai-ai/reasoning-capabilities-unlock-smaller-models-the-problem-solver-bf684236ce2c) | The author's experiment uses 25 questions each from MMLU Marketing and Professional Law. It reports cases where examples helped and cases where complex prompting worsened performance and latency. | Compare task examples first. Do not make self-ask, repeated voting, or long CoT a universal default. Do not generalize small multiple-choice experiments to design performance. |
| [OpenAI reasoning guidance](https://developers.openai.com/api/docs/guides/reasoning-best-practices) | Recommends simple, direct goals and constraints for reasoning models, starting with zero-shot and adding examples when needed. Describes instructions to explain internal reasoning at length as unnecessary. | Do not attach the same long reasoning instructions to every model. Keep the output contract and observable validation central, including at low effort. |

Post-Reasoning does not use a later explanation to revise an answer already generated. Evaluate **the effect of prompt conditioning**, **an explanation of the result**, and **defect correction after rendering** separately. Current CLI turns include file writes and tool calls, so terminating the process early upon seeing a text marker is not proposed.

Neither reference establishes that transferring a stronger model's CoT into design work guarantees equivalent quality. The presets and numerical targets below are product hypotheses to validate in BurnGuard.

## 3. Starting Point in the Current Code

| Current behavior | Evidence | Implication for this plan |
|---|---|---|
| Model, effort, provider, and vanilla selections already exist. The default effort is low. | [generation.ts](../packages/shared/src/generation.ts), [GenerationControls.tsx](../packages/frontend/src/components/settings/GenerationControls.tsx) | Reuse the existing selections to choose a preset automatically instead of building a new settings system. |
| The server validates supported model–effort combinations. Codex model listings come from local metadata. | [generation-options.ts](../packages/backend/src/services/generation-options.ts), [backends.ts](../packages/backend/src/services/backends.ts) | The preset registry must not replace model availability checks or authentication. |
| Current guidance distinguishes codex / claude / claude-opus. Effort appears only in metadata and does not select different execution instructions. | [prompt-model-context.ts](../packages/backend/src/harness/prompt-model-context.ts) | Use this shared insertion point to select guidance by model and effort. |
| Prompt assembly includes the project, design brief, selected direction, file structure, project skill, craft rules, model hints, delivery rules, and request. | [prompt-builder.ts](../packages/backend/src/harness/prompt-builder.ts) | Insert presets at the relevant positions while preserving the existing order and versioned tags. |
| The brief already contains the objective, audience, language, brand, density, dimensions, and page/section information. | [design-brief.ts](../packages/shared/src/design-brief.ts), [prompt-design-brief.ts](../packages/backend/src/harness/prompt-design-brief.ts) | Do not ask the model to infer information already available. |
| Shared craft guidance enforces some specific aesthetic choices, including background depth treatments, light/dark blocks, and default Paper/Ink palettes. | [visual-craft-skill.ts](../packages/backend/src/harness/skills/visual-craft-skill.ts) | Resolve stylistic instructions that conflict with the user's brief before evaluating preset effectiveness. |
| Compact skills contain instructions to read files only once and avoid rereading between edits. | [prompt-compact-skills.ts](../packages/backend/src/harness/prompt-compact-skills.ts) | Reduce unnecessary full-file rereads while allowing inspection of changed regions and failure diagnosis. |
| preview-report provides DOM feedback for the current page, not a complete visual review. A separate design audit contract already exists. | [prompt-builder.ts](../packages/backend/src/harness/prompt-builder.ts), [design-audit.ts](../packages/shared/src/design-audit.ts) | Reuse existing feedback and audits. Do not mark unmeasured checks as complete. |
| The prompt and execution options use the same generation value when passed to the CLI inside the stage directory. | [turns.ts](../packages/backend/src/services/turns.ts), [Codex adapter](../packages/backend/src/adapters/codex/index.ts), [Claude runner](../packages/backend/src/adapters/claude-code/runner.ts) | Keep the selected model, effort, and preset consistent. Do not duplicate prompt policy inside adapters. |

`vanilla` excludes personal plugins and instructions; `compact` controls how context is supplied. Neither becomes an option for disabling design presets. Graphic generation currently requires authenticated Codex, and presets must not bypass that restriction.

## 4. Design Task Structure

Each task has a **target + inputs + deliverable + constraints + completion evidence**, rather than a list of verbs. Exact page, slide, and banner counts come from the brief. The number of stages below must not reduce the requested scope.

| Stage | Decisions and work | Deliverables and observations |
|---|---|---|
| 1. Establish requirements | Confirm the objective, audience, primary action, elements to preserve, required content, specifications, and target. | Scope derived from the existing brief and request. Distinguish assumptions from confirmed facts. |
| 2. Define information structure | Set the reading order and the role of each page, slide, or artboard. | A one-line purpose and key content for each unit. Avoid unnecessary duplicate sections. |
| 3. Make visual decisions | Choose a composition appropriate to the information, selected direction, and brand tokens. | Short decision summaries covering layout, emphasis, typography roles, and image placement. |
| 4. Implement | Save a complete, renderable first result early, then finish the necessary units. | Actual HTML/CSS/assets and working links. Keep edits within the authorized scope. |
| 5. Check and correct | Use available means to verify requirements, specifications, images, reading order, responsiveness, and interactions. | Measurements and observations tied to the latest files, defect fixes, and recheck results. |
| 6. Deliver | Briefly report what changed and what remains unverified. | A result-first response and a summary of actual validation. Preserve the existing requirement to end with a one-sentence change summary. |

These stages do not require six model calls or six planning documents per request. Compress small edits to `inspect target → edit → verify`. Distinguish creation from modification using the user's request and explicit target; file existence alone does not establish that a request is an edit. New projects may already contain starter files.

### Work Units by Deliverable Type

| Type | Small execution unit | Required associated checks |
|---|---|---|
| Web prototype | Page role → sections → shared navigation and linked routes | Real subpages, active page, primary CTA, keyboard operation, narrow screens, Korean text wrapping |
| Slide deck | Overall narrative → claim and evidence per slide → composition that communicates the claim | Count and order, specified dimensions, projection typography, chart units, overflow including hidden slides |
| Graphics and banner sets | Message → composition for each format → individual image and copy placement | Dimensions, aspect ratio, and order of every frame; text safe areas; duplicate imagery; substantive content through the final CTA |
| Existing design edit | Specified file/element → preservation constraints → targeted edit | Regressions outside the request, correct target identification, preservation of shared brand tokens |
| Reference-based work | Verifiable document/image content → new information structure → authored result | Preservation of source facts, immutable original underlays, exclusion of private paths |

When diagrams are needed, explicitly determine the applicable project contract. Do not solve this by stacking conflicting full deck/prototype/diagram skills.

## 5. CoT Structure: Transfer Reviewable Design Summaries

Request the following six development outputs from a stronger model:

1. `brief_facts`: A short summary of requirements and constraints.
2. `work_units`: Tasks connecting inputs, targets, deliverables, and completion evidence.
3. `decisions`: Important design choices and why they meet the requirements, in 1–2 sentences each.
4. `artifact`: The actual implementation.
5. `checks`: Observed results and checks that could not be performed.
6. `failure_lesson`: If a failure occurred, a short correction principle that can apply to other tasks.

This is a review format for development examples, not an internal reasoning log or runtime JSON to expose directly in the user's conversation. Compare model-generated claims that checks passed against execution and rendering evidence. Do not accept an example as a reference solution solely on a confidence score or the stronger model's self-assessment.

Condense reviewed cases into a form such as:

> Request: Make an existing product comparison table readable on mobile. Preserve the brand and prices.
>
> Decision summary: Preserve column headings and product names so users retain the same comparison dimensions. On small screens, allow horizontal scrolling within the table area while preventing page-wide overflow.
>
> Work: Inspect the existing table structure → update the relevant CSS and accessible names → verify narrow-screen behavior and keyboard navigation.
>
> Completion evidence: Prices match the original, the table remains operable, the page has no horizontal overflow, and unrelated sections are unchanged.

The above is **an illustrative example written to demonstrate the format**, not a successful case obtained from a live stronger-model experiment. Keep experimental examples separate from evaluation briefs, and avoid teaching every result to copy a specific layout or wording.

## 6. Preset Composition and Selection Rules

Assemble the final guidance from `shared mandatory contract + deliverable-specific contract + model-specific wording + effort-specific task support + reviewed example when needed`. Give each block one owner rather than copying the entire prompt for every model.

Select using the server-validated `backend + provider + model + effort`. Prefer explicitly reviewed model ID settings, then known alias mappings, then conservative provider defaults. Do not classify an unknown ID as a less capable model merely because its name contains mini/small. Distinguish unvalidated presets in observation records.

Model capability, reasoning effort, and task difficulty are separate dimensions. This plan does not establish a model performance ranking. The following are **initial wording hypotheses to compare**.

### Drafts by Model

| Model or alias currently identified | Proposed preset distinction | Initial evaluation role |
|---|---|---|
| `gpt-5.6-luna` | Small work units with explicit targets and deliverables. Test adding one example for task types with frequent failures. | First candidate for improving LOW quality |
| `gpt-5.3-codex-spark` | Tightly specify edit locations, content to preserve, and completion conditions. Reduce broad exploration instructions. | Candidate for localized design edits |
| `gpt-5.6-terra` | Emphasize page/component execution and checks of shared tokens and linked routes. | Candidate for multi-page and UI work |
| `gpt-5.6-sol` | Connect deliverable-level plans with completion criteria, and direct rechecks to dependent areas. | Candidate for general generation and editing comparisons |
| `gpt-5.5` | Start with concise goals, constraints, and completion evidence. | Earlier-generation comparison candidate |
| `gpt-6-astra` | Focus on important design judgments and success criteria without prescribing excessive procedure. | Candidate for generating development examples at HIGH or above |
| `sonnet`, `claude-sonnet-4-6` | A clear sequence: inspect necessary material → build the relevant composition → verify checklist items. | Candidate for LOW generation and editing comparisons |
| `opus`, `claude-opus-4-6` | Summarize major decisions while preserving the selected direction. Discourage unrequested exploration of alternatives. | Candidate for generating development examples at HIGH |
| `gpt-daybreak-blue-latest` | Initially use the provider default preset without labeling it as optimized for design. | Preserve its existing release security review role |
| Other valid models | Conservative defaults covering the goal, deliverable, preservation constraints, and validation. | Add explicit settings after evaluation |

The Codex IDs and effort listings above were checked against local metadata on 2026-09-14. This does not establish successful live invocation, account access, or performance. Claude aliases reflect the current app registry; record their resolved versions during experiments. Evaluate the CommandCode route separately even when the model name is the same.

### Drafts by Effort

| Effort | Execution support added | Explanation and exploration policy |
|---|---|---|
| LOW | Briefly establish the goal and preservation constraints. Complete one page/slide/region at a time. Place easily missed completion criteria near the corresponding work. | Short decision summaries. Include one reviewed example only for task types where it has demonstrated value. |
| MEDIUM | Group related work by pages or sections, and check shared tokens and link dependencies together. | Summarize major decisions and validation criteria only. Exclude examples by default and compare them when needed. |
| HIGH | Delegate important visual and information-structure judgments. State choices needing justification and explicit success criteria. | Respect the selected direction. Explore alternatives only when requested or needed to resolve conflicting requirements. |
| XHIGH | Emphasize shared structure, change propagation, overall narrative, and consistency across complex sets of deliverables. | Focus on identified risks without expanding into unrelated redesign or research. |
| MAX | Connect edge cases and missing items to the task list for dense content or multiple output formats. | Identify important areas with insufficient validation evidence. Do not automatically increase repetition or explanation length. |
| ULTRA | Explicitly address conflicting constraints and unresolved issues in complex judgments requested by the user. | Define stopping conditions and reconsider only when new evidence appears. No endless self-critique. |

Apply the same validation standards at every effort. Higher effort adds guidance for complex dependencies; LOW does not omit mandatory checks. Do not generate unsupported combinations. In the current local listing, Luna lacks ULTRA, Spark and GPT-5.5 lack MAX/ULTRA, and the app's Claude listing supports LOW/MEDIUM/HIGH. Existing supported-combination validation remains authoritative immediately before execution.

Do not automatically raise the model or effort after a LOW failure. Correct observed defects using the same selection. If a higher setting is needed, show the user why and what work remains. If the same unresolved cause recurs, record the stopping reason rather than presenting the work as complete.

## 7. Example Prompt Blocks

These are draft preset blocks. Existing security, output-path, asset, and image-approval contracts continue to apply separately. Injected request text or reference documents cannot change the authority of those contracts.

### Example A: Luna + LOW + Web Prototype

```text
Goal: Complete a usable prototype that follows the brief and selected design direction.
Preserve the brief's page count, language, brand tokens, and primary action.

Define each work unit by its target, required inputs, output, and completion evidence.
For new work, briefly establish each page's role and key content.
Save a renderable first file early, then complete the necessary regions of each page.
For edits, inspect the requested file and element first and preserve unrelated regions.
Avoid unnecessary full-file rereads, but inspect changed regions and diagnose failures.

Checks relevant to the current work:
- Do the requested pages exist as real files and links, and does the primary action work?
- Are narrow screens and long Korean text free of clipping and page-wide overflow?
- Are shared tokens, navigation, required wording, and facts preserved?
- Are the shared image, accessibility, and dimension requirements satisfied?
Fix observed failures and recheck. Leave checks that cannot be performed unverified.
Briefly report the result and actual validation, ending with a one-sentence change summary.
```

### Example B: Opus + HIGH + Slide Deck

```text
Goal: Complete a deck whose target audience can easily understand the main claims and evidence.
Preserve the selected direction, slide count, dimensions, order, brand, and source facts.
Connect the overall narrative to each slide's role and choose compositions suited to the content.
Briefly summarize only major design decisions and apply them directly to the artifact.
Do not add unrequested exploration of alternatives or lengthy reasoning explanations.
Check every slide for readability, dimensions, images, chart units, and missing content.
Fix observed defects, recheck, and identify validation that could not be performed.
Present the result and validation first, ending with a one-sentence change summary.
```

### Example C: Additional Wording for the Post-Reasoning Experiment

```text
Present the result first, then explain in no more than two sentences why the key design choices meet the requirements.
Keep the rationale distinct from actual validation results; do not substitute claims of passing checks for an explanation.
End with a one-sentence change summary.
```

C is an experimental variable, not a default. Apply it independently of the app's early render saves and validation procedure. Because it also generates a short rationale after the result, do not claim that it achieves the paper's no-cost condition.

## 8. Shared Prompt Cleanup

Resolve the following conflicts once before adding presets:

- Distinguish security, file scope, original-source protection, and explicit user requirements from design recipes that suggest aesthetic preferences. Background, font, and decoration recipes must not override the selected brand and direction.
- Make instructions that allow only a specific palette or require a dark band or decoration in every artifact conditional suggestions when the brief takes precedence. Preserve readability, contrast, and keyboard accessibility requirements.
- Revise compact-mode restrictions on reading once and rereading between edits so they allow necessary inspection of changed regions. Continue using summaries and bounded reads.
- Check that fixed viewport dimensions or layout instructions inappropriate to a project type do not spill into other deliverables.
- Preserve the comparison and approval of original/revised prompts for comment-driven image regeneration, and the display behavior that hides internal IDs. Do not request approval again for an already approved request.
- Keep mandatory rules in one shared block. Avoid creating different safety or quality requirements through model-specific copies.

Propose an initial combined budget of **no more than 4,000 characters** for additional presets and examples. This is neither a token count nor a quality guarantee. Reduce optional examples and duplicate wording before trimming anything mandatory. Determine whether a shorter LOW prompt is actually better using total input/output and quality measurements.

## 9. Implementation Scope and TODOs

The current phase adds only this document. Implementation starts after the user reviews the plan.

| Order | Work | Candidate changes | Acceptance criteria |
|---|---|---|---|
| P0-1 | Freeze existing behavior as a control and resolve conflicting wording | Harness files: `prompt-builder.ts`, `design-craft.ts`, `skills/visual-craft-skill.ts`, `prompt-compact-skills.ts` | Preserve mandatory contracts, prioritize the selected direction and brand, and allow post-edit checks. Retain the original prompt baseline for comparison. |
| P0-2 | Select and assemble presets with a pure function | Start in `prompt-model-context.ts`; split out one data module only if size warrants it | Deterministic selection from validated options. Test distinct model/effort presets. Provide an explicit fallback for valid, unregistered models. |
| P0-3 | Connect project-specific work units to existing context | `prompt-builder.ts` and, if needed, `prompt-design-brief.ts` | Use existing data for pages, frames, dimensions, and preservation constraints. Preserve the original request and existing versioned tags. |
| P0-4 | Run minimal regression checks | `prompt-builder.test.ts`, `generation-options.test.ts`, existing visual-craft/generation-rules tests | Cover compact/full, provider, supported efforts, fallback, original request preservation, a single copy of shared mandatory rules, and example length. |
| P1-1 | Generate stronger-model development examples and verify actual results | Opt-in QA execution and a small set of reviewed example data | Connect model, effort, CLI version, prompt hash, artifact, and validation evidence. Do not accept failed or unverified examples as reference solutions. |
| P1-2 | Compare LOW presets | Reuse existing QA tools and design audits, adding one comparison runner if needed | Distinguish original LOW, shared-cleanup LOW, task-preset LOW, the Post variant, and the HIGH reference. |
| P1-3 | Add observation metadata | Existing session trace insertion point | Record preset ID/version, model, effort, block hash, and size. Exclude raw prompts, private paths, and secrets. |
| P1-4 | Apply qualifying combinations by default based on results | Model-specific preset data and existing generation settings | Mark only combinations meeting adoption criteria as validated. Allow reverting the preset alone if a regression occurs. |
| P2 | Explain the applied guidance in the UI if needed | Existing `GenerationControls.tsx` and shared contracts | Example: “Task guidance is adapted to your selected model.” Do not expose internal CoT or JSON in the UI. |

The initial implementation does not need a DB migration, new provider, general-purpose task engine, or new settings page. Add an `@bg/shared` contract only if internal preset metadata needs to be exposed through the API. Do not silently change the existing `<burnguard-model-guidance-v1>` schema.

Runtime tasks initially remain prompt guidance. Model-generated task lists and self-assessments do not become server authority for approval, completion, or publication. Existing code continues to own staging, canonical publication, cancellation, and recovery.

## 10. Quality Evaluation Design

### Separate Comparison Conditions

1. **Original baseline**: Current shared prompt + current model guidance + LOW.
2. **Conflict cleanup effect**: Cleaned-up shared prompt + default guidance + LOW.
3. **Task and example effect**: The same shared prompt + new task preset + LOW. Also separate example presence/absence in the development set.
4. **Post effect**: Identical to condition 3, with only the instruction for a short design rationale after the result added.
5. **Effort reference**: HIGH results from the same model. Keep HIGH results from a different, stronger model as a separate expert reference.

Do not combine within-model LOW/HIGH comparisons and cross-model comparisons when attributing effects. Select useful variants on the initial development set, then compare original LOW, best LOW, and same-model HIGH on a fixed holdout set.

### Cases and Repetitions

- Separate 12 development briefs from 12 evaluation briefs. Each set initially contains four web, four deck, and four graphic cases, covering new creation, localized edits, multiple deliverables, and source/brand constraints.
- Include short and long Korean text, real subpages, comparison tables/charts, mixed banner sizes, and strongly specified brand requirements. Include missing information and incomplete feedback as failure cases.
- Start with one Codex LOW candidate, then expand to Sonnet and others. Evaluate Claude on currently permitted web and deck tasks; do not bypass the graphic-generation restriction.
- Repeat each holdout condition twice. For a model that can execute all 12 cases, this means `12 × 3 conditions × 2 repetitions = 72 runs`. Compare models with different supported scopes on common cases and record exclusions.
- The 72-run design is a small-scale validation proposal. If variation or confidence intervals prevent a conclusion, leave validation incomplete and decide whether to run more. Do not begin by invoking every model × every effort.

Do not include briefs or artifacts used in development examples in the holdout set. Review stronger-model results against the same criteria rather than treating them as ground truth. Live model calls and image generation **have not been performed during this planning phase**.

### Scoring and Mandatory Pass Conditions

| Evaluation dimension | Points | What to observe |
|---|---:|---|
| Requirement and content accuracy | 25 | Requested counts, scope, dimensions, source facts and numbers, primary objective and CTA |
| Information structure | 20 | Reading order, page/slide roles, comparison and explanation formats suited to the content |
| Visual quality | 25 | Hierarchy, typography, alignment, spacing, brand consistency, image relevance and duplication |
| Behavior, accessibility, and output | 20 | Real links, keyboard operation, narrow screens, dimensions, clipping, and image loading |
| Edit scope and truthful validation | 10 | Unrequested changes, observation evidence, explicit unverified items, unsupported completion claims |

Score results with model and effort names hidden. Review automated audit results alongside the rendered screens and primary user flows. Model evaluators are supplementary; a human verifies the final visual judgment. Fix examples of unmet/partially met/met criteria using the development set before evaluation.

Regardless of the score, privacy, authority, or original-source protection violations; missing required pages/deliverables; broken primary actions; important content clipping; and claims to have generated assets that were not generated are failures. If mandatory observations are `skipped` or `unmeasurable`, leave validation incomplete rather than counting them as passes. An audit status of `ready` alone does not establish that all dimension and visual checks are complete.

### Adoption Targets — Hypotheses Before Measurement

- New LOW should improve quality over original LOW without reducing completion rate. If there is no difference, reconsider retaining the additional prompt.
- Set an initial acceptable mean quality difference of **-5 points on a 100-point scale** relative to the same model at HIGH. Report paired differences grouped by task and their 95% confidence interval. Do not claim established non-inferiority if the lower bound is below -5 points.
- Require zero mandatory failures in the evaluated cases. Observing zero failures does not establish a product-wide failure rate of 0%.
- Measure time to the first complete render separately from time to final validation completion. Set an initial target for median final completion time of **75% or less** of HIGH. Also report p95, interruptions, and retries.
- Record input, output, and reasoning tokens only when actually supplied by the provider. Missing values are unknown, not zero. Do not arbitrarily convert CLI subscription usage into API charges.
- If examples increase LOW's total tokens or duration, disclose that alongside quality improvements. A longer prompt is not itself evidence of reduced reasoning cost.

Use the same supplied assets in the baseline comparison to separate image costs from reasoning effects. Then validate workflows involving image generation separately, including image-tool costs, failures, and time in those results. Distinguish evidence from source declarations, DOM feedback, screenshots, actual link behavior, and measurements of every artboard.

## 11. Post-Implementation Validation and Rollout Sequence

1. Run focused prompt and selection-function tests in the repository-root Bun test environment. Check rejection of unsupported model/effort combinations, original request preservation, tag/path boundaries, and mandatory rules in compact/full modes.
2. Run `bun run typecheck`, relevant generation/image/comment/visual-rule regressions, and `bun run lint`. Simply updating existing test wording to match new wording is not a substitute for validation.
3. Verify rendering and interactions through the existing opt-in QA paths. Use the existing Chromium capability/child-process path and run in an owned work directory and QA_HOME isolated from user data.
4. After live model comparisons, pin preset versions/hashes and validated combinations. Report static test success separately from actual model design-performance validation.
5. If a regression occurs, revert only that model's preset or the new example. Do not change the user's model, effort, or brand settings.

If a later request includes publishing a release, apply the existing Daybreak security review gate. This plan and focused tests do not replace that gate.

## 12. Proposal for This Review

The recommended sequence is **resolve shared instruction conflicts → add model/effort presets to the existing path → create reviewed stronger-model examples → compare LOW results → apply passing combinations**.

The initial product flow preserves model and effort selection while adapting task guidance automatically. It adds no separate stronger-model planner call. Keep Post-Reasoning as an independent experimental condition. Apply LOW presets that meet the quality criteria first, and retain clear default guidance and validation status for untested models and efforts.
