import type { Scorer } from './scorer';

/** The plan and a rider-marked detail use one runtime. Finish the entire photo, including a
 * scheduled unload, before starting either kind of request for the next photo. */
export class InspectionLane {
  private tail: Promise<void> = Promise.resolve();
  private processed = 0;
  constructor(
    private readonly recycleEvery: number,
    private readonly unload: () => Promise<void>,
  ) {}
  wrap(inner: Scorer): Scorer {
    return {
      id: inner.id,
      model: inner.model,
      score: (photo, questions, signal) => {
        const work = this.tail.then(async () => {
          if (signal.aborted) throw signal.reason;
          try {
            return await inner.score(photo, questions, signal);
          } finally {
            this.processed++;
            if (this.recycleEvery > 0 && this.processed % this.recycleEvery === 0)
              await this.unload();
          }
        });
        this.tail = work.then(
          () => undefined,
          () => undefined,
        );
        return work;
      },
    };
  }
}
