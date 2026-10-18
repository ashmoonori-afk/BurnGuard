# Presentation Escape failure remains unresolved

Status: open as of October 18, 2026 KST. The evidence collector's duplicate-record
bug is fixed separately; no presentation behavior fix is claimed.

## Captured failure

Main workflow run `39084315688`, at
`4ac996cd1a8a911e009cad29dcee9fc357b2838d`, retained one actual failed test:

`packages/frontend/tests/deck-sandbox.browser.test.ts`:
`presentation fullscreen fallback preserves authored input, composition and untrusted source isolation`.

Fresh execution reported 1177 passing tests, one skipped test and no failures.
Warm execution reported 1176 passing tests, one skipped test and one failure.
Both executed the same 1178 test identities. Bun repeated the failed test in its
summary; the collector wrongly attributed that repetition to the final file,
`theme-tokens.test.ts`. Clearing file attribution at recap headers corrects the
count and attribution. A fixed regression contains both skip and failure recaps.

The actual failure timed out while `settleFrameMessages` waited for the
presentation iframe's body. The iframe was no longer available. The retained
stack points to the editable-input loop, not the later author-cancellation or
forged-message checks.

## What the evidence establishes

Controlled removal of the iframe at two different Escape positions mapped their
failure stacks. Removal after the first input Escape matched the historical
stack; removal at the later body Escape did not. The historical run completed
seven fewer assertions than the fresh run, which independently matches stopping
after the three initial fallback assertions, before its first input-preservation
assertion.

This localizes the failure to the first input Escape. It does not establish which
native key target, frame lifecycle event, or fullscreen event removed the iframe.
The original retained log has no native event trace.

## Probes that did not reproduce the failure

All probes retained the original security assertions, sandbox permissions,
source checks and deadlines. Passing probes reject only their tested schedule;
they do not prove the intermittent defect is repaired.

- Hold an authored image response, focus the input before native iframe load,
  then release the response: the focused input survived parent iframe focus.
- Focus the input during child load before the parent's load handler: the
  fallback case passed. This diagnostic autofocus disturbed a separate
  fullscreen case, so that disturbance is not evidence for the captured failure.
- Delay a real fullscreen denial until after input focus: the first Escape still
  reached the input.
- Invoke parent iframe focus immediately before the first native Escape, without
  refocusing the child afterward: the first Escape still reached the input.
- Run the original four presentation cases with low-impact key observation on
  Bun 1.3.14, Node 24.13.0 and Chrome for Testing 155.0.8059.39: all four passed.
  This matches the browser version listed by the failed runner image, not a
  direct observation of the browser executable chosen in that failed run.
- Hosted fresh/warm diagnostic run `39086754997` passed both phases with
  1177 passes and one skip. A passing rerun is not a root-cause finding.

## Bounded replay and next evidence

A fixed experiment allows at most twenty executions of the original 144-file
manifest at the failed commit. It stops on the first failed process, incomplete
capture or changed identity count and preserves every full log privately. It
never retries a failed execution to obtain a green result. Its key-only observer
does not send pre-key focus/load console traffic. Exhausting the experiment
without failure is explicitly inconclusive.

The experiment completed all twenty executions without reproducing the failure.
It exited with its designated inconclusive status, not a passing repair verdict.
Diagnosis stopped at 11:36 KST on October 18, 2026, before the authorized
12:30 KST cutoff. The presentation defect remains open while the other follow-up
work proceeds.

The committed test-only observer retains bounded native key/focus/fullscreen,
frame-detachment and bridge-event context when a future case fails. It does not
change product behavior or relax a test. Raw captured logs and launch credentials
are not part of this document. A future fix needs a failing schedule that
identifies the actual dismiss path, then the same schedule passing after the
narrow repair. Do not add a retry, skip, timeout increase or speculative
production workaround.
