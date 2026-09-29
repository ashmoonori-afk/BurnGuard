# Pre-release app UX QA (exploratory, with HAR)

Stage prompt for an agent run before every release publication, right before the release security gate (root
`AGENTS.md`). Adapted from an external exploratory UX QA prompt ("UXHAR") for BurnGuard: a local app with no login,
a per-launch capability instead of an account, and model-backed generation turns.

## 1. Role and goal

You are a first-time BurnGuard user and a UX QA reviewer. In a real browser, explore the journeys below as widely and
deeply as the build allows. You are not only checking that features work: you are finding where a person looking at
the screen cannot tell what is happening, what to do next, or whether their action worked - confusion, anxiety,
waiting without feedback, lost work and unnecessary effort.

Keep asking: "Could someone who has never used this understand the current state from this screen alone, choose the
next action, and be sure their action was processed?"

Investigate only. Do not change product code or implement designs unless separately asked.

### Environment
- Build under test: the release candidate commit or packaged build (record the commit and version).
- Launch: an isolated profile (`BG_APP_ROOT` set to a fresh directory owned by this run, never `~/.burnguard`), backend
  on `127.0.0.1`, opened through the normal browser or desktop entry so `/api/bootstrap` mints the capability.
- Provider: the generation backend available on this machine; record which one. When none is available, generation
  journeys are blocked, not passed.

## 2. Exploration rules: look at the screen, operate the real UI

- Work through the UI the way a user finds it: click, type, scroll. Do not skip flows with direct URLs, API calls or
  database edits, except to verify revisits and deep links of screens you already reached.
- The DOM and accessibility tree may help you find elements. Layout, readability, overlap, clipping, feedback and
  state changes are judged only from the rendered screen.
- A screen that only makes sense with knowledge of the implementation is not fine because you can explain it.
- A click is not success. The expected result must appear, and where it matters it must survive a reload or revisit.
- Set no quota. Do not split one problem into several or present a preference as a defect.

## 3. Setup and journey map

Start HAR recording before the first page load so the capability bootstrap, API calls and SSE streams are all in it.
Record: date, time and time zone; build and commit; browser and version; viewport sizes and scale; provider and model;
network conditions you applied.

Explore at a normal desktop size first (1440x900), then check the main journeys at a narrow desktop width (1024) and
at a phone width (390) where the screen supports it. Report the sizes you actually used.

Journeys (apply only what exists in the build; do not assume features):

| ID | Goal | Entry | Success end state |
|----|------|-------|-------------------|
| J01 | Extract a design system from a website | Home, new design system | System listed with tokens, layout and preview; reopening it shows the same result |
| J02 | Create a project with that system | Home, new project | Project opens with the chosen system pinned |
| J03 | Generate a page | Project chat | Page renders in the canvas; the turn shows as finished; files listed |
| J04 | Read the review and let it repair | Quality panel / review badge | Findings visible with their status; a repair turn changes the page; badge updates |
| J05 | Update the design-system pin | Project, system update notice | New revision pinned; next turn uses it; the change is explained |
| J06 | Export | Export panel | File produced and downloadable; progress and failure states are clear |
| J07 | Recover a failed or interrupted turn | Interrupt a running turn, or a provider failure | The failure is explained; retry works; no half-written output is shown as done |

For each journey record: goal, entry, main actions and branches, success end state, preconditions and test data, and
status: verified / partly verified / blocked / not applicable.

Beyond J01-J07, map every screen you can reach - Settings, the design-system view, menus, dialogs, drawers, help -
including secondary and collapsed actions, cancel, back and re-entry paths, and explore them in the passes below.
Note every point where you had to rely on memory or guess to interpret a screen. Record video or a browser trace for
short transitions when the tool supports it. Also restart the backend mid-session (the capability rotates) and check
how the open app recovers.

## 4. Passes

1. First use. Before acting on each screen: is its purpose and your location clear, do the most important information
   and next action stand out, can you tell what is done and what is left, can you predict what a button will do?
2. Full journeys. Observe before the action -> right after the click -> while processing -> success or failure ->
   later revisit. Do not click through quickly and look only at the end. Note immediate acknowledgement, whether you
   can double-submit or leave mid-process, whether anything looks finished before it is, and whether lists, detail
   views, badges and counts agree. Long generation turns deserve special attention: streaming progress, the stop
   control, and what the canvas shows while files are half-written.
3. Mistakes, interruptions and recovery, within safe limits: empty, malformed, long and boundary input; cancel, back,
   closing dialogs, re-entering the same screen; leaving before saving, reload, revisit after saving; double clicks
   and duplicate submits; no results and filter combinations; long names and missing images; errors followed by
   correction, retry and recovery. Add slow network, offline or failed requests only when you can reproduce them
   safely. Keep deliberately induced failures apart from ones that happened on their own. What you could not
   reproduce is "unverified", not "fine".

## 5. Checklist (not a limit)

A. Visibility of state: selected item, step, saved or not, processing, done, failed, what is left.
B. Loading and progress: first load, partial load, upload, extraction, generation, export; spinners without
   explanation, apparent hangs, partial completion shown as complete.
C. Layout shift and stability: content or buttons moving as images, fonts, data, banners or validation messages
   arrive; toasts or dialogs covering key information. Record the movement you saw and its effect; never invent a
   layout-shift number you did not measure.
D. Clarity of actions: primary vs secondary, clickable things that look clickable and vice versa, labels that predict
   the result, disabled controls that say why.
E. Success, failure and empty states are distinguishable, each with a next step; errors never look like an empty or
   successful screen. Backend errors appear only as mapped, human copy - never raw diagnostics or private paths.
F. Input and validation: format and limits explained before input, errors next to the field, input kept after a
   failure.
G. Save, confirm, cancel, undo: draft vs saved vs published; reversible vs irreversible; nothing silently lost or
   silently applied.
H. Navigation and context: search, filters, scroll and selection kept on return; current location and way back
   obvious.
I. Information and wording: hierarchy, consistent status names, button names and date/time formats; no internal
   jargon; the three UI languages (ko, en, zh-CN) show complete copy with no untranslated keys.
J. Responsive and basic accessibility: clipping, overlap, sideways scroll, controls or dialogs off screen at narrow
   widths; colour-only status; small targets; weak contrast; invisible keyboard focus. Check Tab, Enter and Escape
   in the main inputs and dialogs.
K. Perceived performance: delay after a click, repeated loading, input lag, late state updates, janky scrolling.
   Many or repeated requests are not by themselves a UX problem; keep what the user sees apart from the suspected
   technical cause.

## 6. Evidence: HAR and screens

- Connect network records to what was on screen; HAR alone never explains a UX problem.
- Record HAR from the first load through the end; split per journey if large and state any gap. Link each journey ID
  to its start and end time and HAR file. For problem requests note time, method, path, status and duration.
- Export HAR at the end and check the file exists and covers the expected span.
- Capture key screens and transitions; before/after pairs for layout shift, loading and inconsistent state. Put the
  journey or finding ID in file names. Do not claim a single still image proves a transient behaviour.
- Masking is mandatory before anything is shared. Run
  `bun scripts/qa/har-mask.ts <raw.har> <shared.har> --root <qa-home>=<qa-home-placeholder>` on every HAR. It masks
  the `x-burnguard-capability` header, the `burnguard_capability` cookie and every other occurrence of its value,
  authorization headers, cookies, secret query parameters and local absolute paths, and refuses to write output that
  still contains a collected secret. Keep raw HAR files inside the run's private directory and delete them when the
  report is accepted. Apply the same care to screenshots and traces: no capability, token, provider diagnostic or
  private path may be visible.
- The tool masks what it can recognise; it cannot know provider diagnostics or personal content. After masking, scan the
  masked HAR (URLs, request and response bodies) for provider diagnostics, prompts or personal data and remove them by
  hand, or keep that HAR private.
- If a tool cannot record HAR, video or a network condition, say what is missing and what replaced it. Never call a
  network summary a HAR, or report files, screens or actions that were not produced.

## 7. Test data and safety

- Use data this run created and can identify (names prefixed `QA-`). Do not change or delete anything else.
- No external side effects: no publishing or sharing to external services (for example Vercel sharing) unless it is
  an isolated test target explicitly allowed for this run. Stop before such a final step and report it as blocked.
- Stay inside the isolated profile; never point the app at a real user profile.
- At the end list the data you created, what you cleaned up and what you left, and stop every server and browser you
  started.

## 8. Finding format

### UX-001. [Title stating the problem the user meets]

- Type: functional defect / usability / visual / accessibility
- Severity: P0 / P1 / P2 / P3
- Journey and location: journey ID, screen, route, element
- Conditions: data state, viewport, network condition, provider
- Steps: numbered, exactly as performed
- Observed: what appeared on screen
- Expected: what the user should be able to know or do
- User impact: confusion, re-checking, delay, wrong action, data loss (an estimate unless observed with real users)
- Reproduction: reproduced / intermittent / seen once / needs verification
- Evidence: screenshot, video, trace or HAR file with time or request
- Suspected cause: only if useful, marked as a hypothesis, separate from the observation
- Suggested direction: how to reduce the problem
- Verification criterion: which action and screen show it is fixed

Severity:
- P0: data loss or wrong real-world processing, happening or imminent. Stop the risky action and report first.
- P1: a core journey cannot be completed or invites a serious wrong action, with no practical workaround.
- P2: completion is possible but with real confusion, repeated actions, re-checking or delay.
- P3: minor readability, consistency or micro-interaction issues with small task impact.

Group one cause that repeats across screens into one finding with its locations. Do not merge different causes or
impacts. Never stop at "slow", "confusing" or "inconvenient": say what appeared after which action and what the user
could not know or had to do. Separate observation, estimated impact and technical hypothesis.

## 9. Report and completion

1. Summary: the main obstacles and what to fix first; functional failures apart from "works but hard to use".
2. Scope and coverage: screens and journeys found, and per journey a table of: normal completion, loading/processing
   states, empty states, validation/error/retry, cancel/back/leave, reload/re-entry, narrow or phone width, evidence -
   each verified / partly verified / blocked / not applicable. Keep "not applicable" apart from "not checked".
3. Findings: a summary table by severity and journey, then each finding in the format above.
4. Recurring patterns across journeys.
5. Not verified and limits: access, data, external-action limits, tool limits, failed reproduction.
6. Evidence and data: paths of the masked HAR files, screenshots, videos and traces, mapped to journeys; QA data
   created and cleaned up; remaining processes (should be none).

Finish the core journeys to their end states before stopping. When time or tools run out, prioritise the core
journeys and the highest-impact problems and mark the rest unverified. Never conclude "no problems in any journey"
for scope you did not check.

The report is the release input: a P0 or P1 finding blocks publication until it is fixed or the owner explicitly
accepts it. Store the report and masked evidence under the ignored `.omo/evidence/release-<version>/ux-qa/` next to
the security review evidence.
