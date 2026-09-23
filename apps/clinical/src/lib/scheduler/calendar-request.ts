/** Ensures only the latest calendar request can publish a result, even if abort is ignored. */
export class CalendarRequestGate {
  private generation = 0;
  private controller: AbortController | null = null;

  start(): { signal: AbortSignal; isCurrent: () => boolean } {
    this.controller?.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.controller = controller;
    return { signal: controller.signal, isCurrent: () => !controller.signal.aborted && generation === this.generation };
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation++;
  }
}
