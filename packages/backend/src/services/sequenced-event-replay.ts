import type { SequencedEventEnvelope } from "@bg/shared/events";

type ReplayInput = {
  readonly afterSequence: number;
  readonly subscribe: (listener: (item: SequencedEventEnvelope) => Promise<void>) => () => void;
  readonly backfill: (afterSequence: number) => Promise<readonly SequencedEventEnvelope[]>;
  readonly emit: (item: SequencedEventEnvelope) => Promise<void>;
};

export async function subscribeBeforeBackfill(input: ReplayInput): Promise<() => void> {
  const queued: SequencedEventEnvelope[] = [];
  let replaying = true;
  let cursor = input.afterSequence;
  let liveDelivery = Promise.resolve();
  const deliver = async (item: SequencedEventEnvelope): Promise<void> => {
    if (item.sequence <= cursor) return;
    await input.emit(item);
    cursor = item.sequence;
  };
  const unsubscribe = input.subscribe(async (item) => {
    if (replaying) {
      queued.push(item);
      return;
    }
    liveDelivery = liveDelivery.then(() => deliver(item)).catch((error) => { unsubscribe(); throw error; });
    await liveDelivery;
  });
  try {
    const historical = await input.backfill(input.afterSequence);
    queued.push(...historical);
    while (queued.length > 0) {
      const batch = queued.splice(0).sort((left, right) => left.sequence - right.sequence);
      for (const item of batch) await deliver(item);
    }
    replaying = false;
    return unsubscribe;
  } catch (error) {
    unsubscribe();
    throw error;
  }
}
