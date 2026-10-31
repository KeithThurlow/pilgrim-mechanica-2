// The watchdog behind every looping sound (Keith 2026-10-31: "if you die while firing your minigun, the audio never
// stops, you have to refresh the page"). A loop's owner has to refresh it (touch) every frame it wants it; one that
// goes unrefreshed for `ttl` seconds is handed back by sweep() to be faded out and stopped, so no owner that dies,
// is removed or stops updating can leave a sound running forever. Pure bookkeeping (no WebAudio): tested headless.
export class LoopWatch<T> {
  private seen = new Map<T, number>();
  constructor(public ttl = 0.3) {}

  /** The owner wants this loop now. */
  touch(loop: T, now: number) { this.seen.set(loop, now); }
  /** The loop was stopped on purpose. */
  drop(loop: T) { this.seen.delete(loop); }
  /** Loops unrefreshed for longer than ttl: forgotten here, returned to be stopped. */
  sweep(now: number): T[] {
    let out: T[] | null = null;
    for (const [l, t] of this.seen) if (now - t > this.ttl) (out ??= []).push(l);
    if (out) for (const l of out) this.seen.delete(l);
    return out ?? [];
  }
  get size() { return this.seen.size; }
}
