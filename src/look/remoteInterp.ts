// A swarm stepped in the sim worker, drawn on the game's clock (Keith 2026-11-16: "the swarm robots can be a bit jumpy
// on the phone"). Pure: no three, so tools/remoteinterp-check.ts runs it headless.
//
// The worker's snapshots land on the main thread a little after their tick, and unevenly: when the main thread is busy
// (a 15 ms tick on the phone) two land in one gap and the one before is never seen, or none lands for 60 ms. The old
// blend timed itself on when they landed, so the robots sped up, froze and jumped with the phone's load.
// This keeps the last few snapshots, each stamped with its tick (the sim host's frame id: one a tick), and draws the
// swarm at a fixed time behind the newest tick sent, blending the two snapshots either side of it. Every snapshot is
// captured as it lands (RobotsView.take), so none is skipped however they bunch. The delay follows the worst recent
// lateness (the newest tick sent minus the newest answered), so it is as short as the worker allows: it rises quickly
// when answers come later and eases back slowly. Ownership: cosmetic.
//
// Values per slot are blended between the two snapshots only where the slot's keys (generation, state) are the same in
// both and in the arrays now; otherwise the slot shows what the arrays hold now (a spawn, a death).
export type Num = Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array | Int32Array;
export interface Channel {
  a: Float32Array;
  /** Floats per slot (4 feet × 1: stride 4). */
  stride?: number;
  /** An angle: blended the short way round. */
  angle?: boolean;
  /** A step bigger than this isn't blended (a wrapped phase). */
  jump?: number;
}

export const REMOTE_INTERP = {
  /** Snapshots kept (the delay can't pass this many ticks less one). */
  keep: 6,
  /** Ticks drawn behind the worst recent lateness. */
  margin: 0.3,
  /** The least delay (ticks). */
  minDelay: 0.5,
  /** The most delay (ticks). */
  maxDelay: 3,
  /** How fast the delay rises to a later answer, and eases back (ticks a second). */
  rise: 14,
  fall: 0.4,
  /** How fast the worst lateness seen is forgotten (ticks a second). Lateness past maxDelay is a stall, not followed. */
  forget: 0.25,
};

interface Snap { id: number; hi: number; ch: Float32Array[]; keys: Num[] }

export class RemoteInterp {
  private ring: Snap[] = [];
  private n = 0;
  private head = -1;
  private saved: Float32Array[];
  private applied = false;
  private appliedN = 0;
  /** The delay drawn at now (ticks behind the newest tick sent). */
  delay = 1;
  private peak = 1;
  /** Frames drawn holding the newest snapshot because the next wasn't in yet (a stall: the robots stand). */
  holds = 0;
  /** The drawn time (ticks) of the last apply. */
  drawnAt = 0;

  constructor(private channels: Channel[], private keys: Num[], private o = REMOTE_INTERP) {
    for (let k = 0; k < o.keep; k++) {
      this.ring.push({
        id: -1, hi: 0,
        ch: channels.map((c) => new Float32Array(c.a.length)),
        keys: keys.map((x) => new (x.constructor as new (n: number) => Num)(x.length)),
      });
    }
    this.saved = channels.map((c) => new Float32Array(c.a.length));
  }

  /** A snapshot just landed on the arrays: tick id, slots below hi live. */
  capture(id: number, hi: number) {
    this.restore();
    const newest = this.n ? this.ring[this.head] : null;
    if (newest && id <= newest.id) { this.fill(newest, id, hi); return; }
    this.head = (this.head + 1) % this.ring.length;
    this.n = Math.min(this.n + 1, this.ring.length);
    this.fill(this.ring[this.head], id, hi);
  }

  private fill(s: Snap, id: number, hi: number) {
    s.id = id; s.hi = hi;
    for (let j = 0; j < this.channels.length; j++) { const st = this.channels[j].stride ?? 1; s.ch[j].set(this.channels[j].a.subarray(0, hi * st)); }
    for (let j = 0; j < this.keys.length; j++) s.keys[j].set(this.keys[j].subarray(0, hi));
  }

  private at(back: number): Snap { return this.ring[(this.head - back + this.ring.length * 2) % this.ring.length]; }

  /**
   * A drawn frame: sent is the newest tick sent to the worker, alpha how far the frame is past it (0..1), dt the frame's
   * real time (s), hi the arrays' live slots now. Blends into the arrays; call restore() right after drawing.
   */
  apply(sent: number, alpha: number, dt: number, hi: number) {
    if (this.applied || this.n === 0) return;
    const o = this.o, newest = this.ring[this.head];
    // How late answers are: the newest tick sent less the newest answered, at its worst lately.
    const late = sent - newest.id + Math.max(0, Math.min(1, alpha));
    // A stall longer than the delay can cover (the page loading, a hitch) isn't followed: the swarm just stands.
    this.peak = Math.max(late <= o.maxDelay ? late : 0, this.peak - o.forget * dt);
    const want = Math.min(o.maxDelay, Math.max(o.minDelay, this.peak + o.margin));
    const step = (want > this.delay ? o.rise : o.fall) * dt;
    this.delay += Math.max(-step, Math.min(step, want - this.delay));
    // The time drawn, kept inside the snapshots held.
    let t = sent + alpha - this.delay;
    const oldest = this.at(this.n - 1).id;
    if (t >= newest.id) { if (t > newest.id + 1e-6) this.holds++; t = newest.id; }
    if (t < oldest) t = oldest;
    this.drawnAt = t;
    if (this.n < 2 || t >= newest.id) return; // the arrays already hold the newest
    let b = 0;
    while (b + 1 < this.n && this.at(b + 1).id > t) b++;
    const B = this.at(b), A = this.at(Math.min(b + 1, this.n - 1));
    if (A === B) return;
    const f = (t - A.id) / Math.max(1e-6, B.id - A.id);
    const m = Math.min(A.hi, B.hi, hi);
    for (let j = 0; j < this.channels.length; j++) {
      const ch = this.channels[j], s = ch.stride ?? 1, out = ch.a, pa = A.ch[j], pb = B.ch[j], jump = ch.jump ?? Infinity;
      this.saved[j].set(out.subarray(0, m * s));
      for (let i = 0; i < m; i++) {
        if (!this.same(A, B, i)) continue;
        for (let k = i * s, e = k + s; k < e; k++) {
          let d = pb[k] - pa[k];
          if (ch.angle) d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) > jump) continue;
          out[k] = pa[k] + d * f;
        }
      }
    }
    this.appliedN = m;
    this.applied = true;
  }

  /** Back to the values the arrays held before apply(). */
  restore() {
    if (!this.applied) return;
    this.applied = false;
    for (let j = 0; j < this.channels.length; j++) { const s = this.channels[j].stride ?? 1; this.channels[j].a.set(this.saved[j].subarray(0, this.appliedN * s)); }
  }

  private same(A: Snap, B: Snap, i: number) {
    for (let j = 0; j < this.keys.length; j++) {
      const live = this.keys[j][i];
      if (A.keys[j][i] !== live || B.keys[j][i] !== live) return false;
    }
    return true;
  }
}
