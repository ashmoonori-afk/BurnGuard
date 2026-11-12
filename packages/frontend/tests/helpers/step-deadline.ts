/**
 * The limit for one awaited step in the suites that start real backend processes. Every such wait is for a named
 * event: a process exit, an IPC message, a page state. The deadline only stops a hang. A fixture server reports ready
 * in under a second on every CI runner, but a stalled disk or a busy runner has held one for more than 5 s, so the
 * limit sits far above the normal time.
 */
export const STEP_DEADLINE_MS = 20_000;
