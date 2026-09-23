import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NormalizedEvent, SequencedEventEnvelope, SessionInfo, SessionSnapshot } from "@bg/shared";
import MessageStream from "../src/components/chat/MessageStream";
import AgentMessage from "../src/components/chat/blocks/AgentMessage";
import ErrorCard from "../src/components/chat/blocks/ErrorCard";
import { LOCALES, useLocaleStore } from "../src/i18n/locale";
import { t } from "../src/i18n/t";
import { mergeSessionEvents } from "../src/lib/session-event-state";
import { TURN_DISPOSITIONS, projectTurnStates } from "../src/lib/turn-disposition";

const SESSION: SessionInfo = {
  id: "session-1",
  project_id: "project-1",
  backend_id: "codex",
  status: "idle",
  usage: { input: 0, output: 0, cached: 0, cache_write: 0 },
  updated_at: 10,
  last_active_at: 10,
};

const FIRST = "turn-first";
const SECOND = "turn-second";

let nextId = 0;
const id = () => {
  nextId += 1;
  return `event-${nextId}`;
};

/** A turn that finished and published: its terminal message_end is only sent after the commit. */
function committedTurn(turnId: string, text: string): NormalizedEvent[] {
  return [
    { id: id(), ts: 1, type: "chat.user_message", turnId, text: "make the mark", attachmentCount: 0 },
    { id: id(), ts: 2, type: "status.running" },
    { id: id(), ts: 3, type: "chat.delta", turnId, text },
    { id: id(), ts: 4, type: "chat.message_end", turnId },
    { id: id(), ts: 5, type: "status.idle", stopReason: "end_turn" },
  ];
}

/** A turn that ran to completion and was then refused by the publication gate. */
function refusedTurn(turnId: string, text: string): NormalizedEvent[] {
  return [
    { id: id(), ts: 6, type: "chat.user_message", turnId, text: "finalize it", attachmentCount: 0 },
    { id: id(), ts: 7, type: "status.running" },
    { id: id(), ts: 8, type: "chat.delta", turnId, text },
    {
      id: id(), ts: 9, type: "status.error", code: "logo_deliverables_missing",
      reason: "logo_svg_invalid", notApplied: { turnId, operationId: "operation-9", repairs: 1 },
      message: "turn_failed", recoverable: true,
    },
    { id: id(), ts: 10, type: "status.idle", stopReason: "error" },
  ];
}

function envelopes(events: readonly NormalizedEvent[]): SequencedEventEnvelope[] {
  return events.map((event, index) => ({ sequence: index + 1, event }));
}

const snapshot = (sequence: number): SessionSnapshot => ({ session: SESSION, sequence, pending_permissions: [] });

test("Given a refused turn after a committed one When projected Then only the refused turn is not applied and the notice names that exact turn", () => {
  const events = [...committedTurn(FIRST, "first mark delivered"), ...refusedTurn(SECOND, "second mark delivered")];

  const states = projectTurnStates(events);

  expect(states.get(FIRST)?.disposition).toBe("committed");
  expect(states.get(SECOND)?.disposition).toBe("not_applied");
  expect(states.get(SECOND)?.reason).toBe("logo_svg_invalid");
  expect(states.get(SECOND)?.notApplied).toEqual({ turnId: SECOND, operationId: "operation-9", repairs: 1 });
  expect(states.get(FIRST)?.notApplied).toBeUndefined();
});

test("Given repair child output When the parent commits or is not applied Then the child bubble inherits only that parent standing", () => {
  const committedChild = `${FIRST}-design-repair-1`;
  const refusedChild = `${SECOND}-logo-repair`;
  const events: NormalizedEvent[] = [
    { id: id(), ts: 1, type: "chat.user_message", turnId: FIRST, text: "make the mark", attachmentCount: 0 },
    { id: id(), ts: 2, type: "chat.delta", turnId: committedChild, text: "contrast repaired" },
    { id: id(), ts: 3, type: "chat.message_end", turnId: FIRST },
    { id: id(), ts: 4, type: "status.idle", stopReason: "end_turn" },
    { id: id(), ts: 5, type: "chat.user_message", turnId: SECOND, text: "finalize it", attachmentCount: 0 },
    { id: id(), ts: 6, type: "chat.delta", turnId: refusedChild, text: "vector repaired" },
    { id: id(), ts: 7, type: "status.error", code: "logo_deliverables_missing", reason: "logo_svg_invalid", notApplied: { turnId: SECOND, operationId: "operation-7", repairs: 1 }, message: "turn_failed", recoverable: true },
    { id: id(), ts: 8, type: "status.idle", stopReason: "error" },
  ];

  const states = projectTurnStates(events);

  expect(states.get(committedChild)?.disposition).toBe("committed");
  expect(states.get(refusedChild)?.disposition).toBe("not_applied");
  expect(states.get(refusedChild)?.notApplied).toEqual({ turnId: SECOND, operationId: "operation-7", repairs: 1 });
  expect(states.get(refusedChild)?.reason).toBe("logo_svg_invalid");
});

test("Given an independent turn whose id resembles a repair child When projected Then it is not joined to another turn", () => {
  const independent = `${FIRST}-logo-repair`;
  const events: NormalizedEvent[] = [
    ...committedTurn(FIRST, "first mark delivered"),
    { id: id(), ts: 6, type: "chat.user_message", turnId: independent, text: "independent request", attachmentCount: 0 },
    { id: id(), ts: 7, type: "chat.delta", turnId: independent, text: "still working" },
  ];

  expect(projectTurnStates(events).get(independent)?.disposition).toBe("pending");
});

test("Given a turn whose work is still streaming When projected Then it is pending rather than committed", () => {
  const streaming: NormalizedEvent[] = [
    { id: id(), ts: 1, type: "chat.user_message", turnId: FIRST, text: "make the mark", attachmentCount: 0 },
    { id: id(), ts: 2, type: "status.running" },
    { id: id(), ts: 3, type: "chat.delta", turnId: FIRST, text: "working on the mark" },
  ];

  expect(projectTurnStates(streaming).get(FIRST)?.disposition).toBe("pending");
  // Text that has been generated but has no terminal yet must never be projected as committed,
  // whichever non-terminal event follows it.
  expect(projectTurnStates([...streaming, { id: id(), ts: 4, type: "chat.thinking", turnId: FIRST, text: "checking" }]).get(FIRST)?.disposition).toBe("pending");
});

test("Given an interrupted turn and a provider failure When projected Then neither claims a not-applied project", () => {
  const interrupted: NormalizedEvent[] = [
    { id: id(), ts: 1, type: "chat.user_message", turnId: FIRST, text: "make the mark", attachmentCount: 0 },
    { id: id(), ts: 2, type: "chat.delta", turnId: FIRST, text: "partial work" },
    { id: id(), ts: 3, type: "status.idle", stopReason: "interrupted" },
  ];
  const providerFailure: NormalizedEvent[] = [
    { id: id(), ts: 4, type: "chat.user_message", turnId: SECOND, text: "retry", attachmentCount: 0 },
    { id: id(), ts: 5, type: "chat.delta", turnId: SECOND, text: "partial work" },
    { id: id(), ts: 6, type: "status.error", message: "turn_failed", recoverable: true },
    { id: id(), ts: 7, type: "status.idle", stopReason: "error" },
  ];

  const states = projectTurnStates([...interrupted, ...providerFailure]);

  expect(states.get(FIRST)?.disposition).toBe("stopped");
  expect(states.get(FIRST)?.notApplied).toBeUndefined();
  expect(states.get(SECOND)?.disposition).toBe("rejected");
  expect(states.get(SECOND)?.notApplied).toBeUndefined();
});

test("Given a reloaded conversation When the durable events are merged Then the dispositions match the live stream exactly", () => {
  const events = [...committedTurn(FIRST, "first mark delivered"), ...refusedTurn(SECOND, "second mark delivered")];
  const all = envelopes(events);

  // Live: the client held the stream from the first event onwards.
  let live = mergeSessionEvents(null, all.slice(0, 3), snapshot(0));
  for (const envelope of all.slice(3)) live = mergeSessionEvents(live, [envelope]);

  // Reload: a durable snapshot at the refusal plus the backfill the client asks for.
  const reloaded = mergeSessionEvents(null, all, snapshot(all.length));

  const liveStates = projectTurnStates(live.envelopes.map((envelope) => envelope.event));
  const reloadedStates = projectTurnStates(reloaded.envelopes.map((envelope) => envelope.event));

  expect([...reloadedStates.entries()]).toEqual([...liveStates.entries()]);
  expect(reloadedStates.get(SECOND)?.disposition).toBe("not_applied");
  expect(reloadedStates.get(FIRST)?.disposition).toBe("committed");
});

test("Given every disposition When an agent message renders Then its state is machine-readable and localized in all three locales", () => {
  const initial = useLocaleStore.getInitialState();
  const originalInitial = initial.locale;
  const original = useLocaleStore.getState().locale;
  try {
    for (const locale of LOCALES) {
      Object.assign(initial, { locale });
      useLocaleStore.setState({ locale });
      for (const disposition of TURN_DISPOSITIONS) {
        const html = renderToStaticMarkup(createElement(AgentMessage, { text: "the mark is ready", turnId: FIRST, disposition }));
        expect(html).toContain(`data-turn-disposition="${disposition}"`);
        expect(html).toContain(`data-turn-id="${FIRST}"`);
        if (disposition === "pending") continue;
        const shipped = renderToStaticMarkup(createElement("span", null, t(`chat.turn.${disposition}` as never)));
        expect(html).toContain(shipped.replace(/^<span>|<\/span>$/g, ""));
      }
      // Generated-but-unsaved work and committed work never share their copy.
      const pending = renderToStaticMarkup(createElement(AgentMessage, { text: "x", turnId: FIRST, disposition: "pending" as const }));
      const committed = renderToStaticMarkup(createElement(AgentMessage, { text: "x", turnId: FIRST, disposition: "committed" as const }));
      expect(pending).not.toBe(committed);
      expect(t("chat.turn.pending")).not.toBe(t("chat.turn.committed"));
      expect(t("chat.turn.not_applied")).not.toBe(t("chat.turn.committed"));
    }
  } finally {
    Object.assign(initial, { locale: originalInitial });
    useLocaleStore.setState({ locale: original });
  }
});

test("Given a refusal with a machine reason When the error card renders Then the not-applied notice appears without ids or raw diagnostics", () => {
  const raw = "logo.svg failed at /private/Users/alice/stage/logo.svg";
  const html = renderToStaticMarkup(createElement(ErrorCard, {
    message: raw,
    code: "logo_deliverables_missing" as const,
    reason: "logo_svg_invalid" as const,
    notApplied: { turnId: SECOND, operationId: "operation-9", repairs: 1 },
    recoverable: true,
  }));

  expect(html).toContain(t("chat.turn.not_applied"));
  expect(html).toContain(t("chat.reason.logo_svg_invalid"));
  expect(html).not.toContain(raw);
  expect(html).not.toContain("/private/");
  expect(html).not.toContain("operation-9");
});

test("Given the rendered stream When a turn is refused Then its own bubble is marked not applied and the earlier turn stays committed", () => {
  const events = [...committedTurn(FIRST, "first mark delivered"), ...refusedTurn(SECOND, "second mark delivered")];

  const html = renderToStaticMarkup(createElement(MessageStream, { events, session: SESSION }));

  expect(html).toContain(`data-turn-id="${FIRST}" data-turn-disposition="committed"`);
  expect(html).toContain(`data-turn-id="${SECOND}" data-turn-disposition="not_applied"`);
  expect(html).toContain('data-qa="turn-not-applied"');
  // The streamed text of the refused turn is still shown; only its standing changed.
  expect(html).toContain("second mark delivered");
});
