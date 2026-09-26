/**
 * The Quality panel lock follows the turn itself: a flag left behind by a
 * missed `status.idle` (snapshot reconnect, backend restart) releases as
 * soon as no send is pending and the session is not running.
 */
export function deriveAutoFixRunning(input: {
  readonly autoFixPending: boolean;
  readonly sendPending: boolean;
  readonly sessionStatus: string | undefined;
}): boolean {
  return input.autoFixPending && (input.sendPending || input.sessionStatus === "running");
}
