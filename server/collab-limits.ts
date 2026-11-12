/**
 * How often one person may ask group work for something: so many calls
 * within a window of time, counted by participant id. In memory only, so a
 * restart forgets it.
 */
export class PersonLimit {
  /** When each person's counted calls were made, oldest first. */
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Counts a call. Undefined when it may go on; else the seconds until the
   * person's next one may, and the refused call is not counted.
   */
  take(participantId: string): number | undefined {
    const now = this.now();
    const recent = (this.calls.get(participantId) ?? []).filter((at) => now - at < this.windowMs);
    this.calls.set(participantId, recent);
    if (recent.length >= this.max)
      return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
    recent.push(now);
    return undefined;
  }
}
