// Gun streams (Keith 2026-10-31, after playing at night: "maybe we can literally just have a light, a tube light that
// goes out along there"). Pure and cosmetic: every peer makes its own from the rounds it draws.
//
// Rounds from one gun (the same family, a muzzle within `join` metres, flying within `cone` degrees of the stream)
// feed one stream: a line from the muzzle to where the rounds land. Its strength is the rounds' rate times their power
// (damage × (1 + pierce)), as a running average with time constant tau: it swells over tau when the trigger goes down
// and dies away over a few tau after it comes up. A pulsing gun (the autocannon) uses its own, shorter tau, so each
// shell flares the line. The night lights (src/world/nightLights.ts) draw each stream as a faked tube of light and feed
// a few points along it into the light clusters.

export interface GunStream {
  /** Muzzle (latest round's). */
  x0: number; y0: number; z0: number;
  /** Where the rounds land (eased toward each new hit, so spread doesn't make it jitter). */
  x1: number; y1: number; z1: number;
  /** Unit direction muzzle -> landing. */
  dx: number; dy: number; dz: number;
  /** Rounds, decaying with tau: rate ≈ r / tau. */
  r: number;
  /** Running power per round, and how many of the recent rounds were ignited (0..1). */
  power: number;
  hot: number;
  fam: number;
  pulse: boolean;
  /** Seconds since its last round. */
  age: number;
}

export const STREAM_MAX = 64;

export interface StreamOpts {
  /** Running-average time (s) of a steady gun and of a pulsing one. */
  tau: number;
  pulseTau: number;
  /** A round joins a stream whose muzzle is this close (m) and whose line is within this many degrees. */
  join: number;
  cone: number;
}

export const STREAM_OPTS: StreamOpts = { tau: 0.18, pulseTau: 0.1, join: 1.4, cone: 22 };

export class GunStreams {
  readonly list: GunStream[] = [];
  n = 0;
  constructor(public o: StreamOpts = STREAM_OPTS) {
    for (let i = 0; i < STREAM_MAX; i++) this.list.push({ x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, dx: 0, dy: 0, dz: 1, r: 0, power: 0, hot: 0, fam: 0, pulse: false, age: 0 });
  }

  /** One round from (x0..) landing at (x1..). */
  round(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, power: number, fam: number, hot = false, pulse = false) {
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, L = Math.hypot(ex, ey, ez);
    if (L < 0.5 || !(power > 0)) return;
    const dx = ex / L, dy = ey / L, dz = ez / L;
    const J2 = this.o.join * this.o.join, cosC = Math.cos((this.o.cone * Math.PI) / 180);
    let best = -1, bd = J2;
    for (let i = 0; i < this.n; i++) {
      const s = this.list[i];
      if (s.fam !== fam || s.pulse !== pulse) continue;
      const mx = s.x0 - x0, my = s.y0 - y0, mz = s.z0 - z0, d2 = mx * mx + my * my + mz * mz;
      if (d2 > bd || s.dx * dx + s.dy * dy + s.dz * dz < cosC) continue;
      best = i; bd = d2;
    }
    let s: GunStream;
    if (best >= 0) {
      s = this.list[best];
      // The landing point eases toward the new hit (a third of the way per round).
      s.x1 += (x1 - s.x1) * 0.35; s.y1 += (y1 - s.y1) * 0.35; s.z1 += (z1 - s.z1) * 0.35;
      s.power += (power - s.power) * 0.3;
      s.hot += ((hot ? 1 : 0) - s.hot) * 0.3;
    } else {
      if (this.n < STREAM_MAX) s = this.list[this.n++];
      else { // full: take the faintest
        let w = 0;
        for (let i = 1; i < this.n; i++) if (this.list[i].r * this.list[i].power < this.list[w].r * this.list[w].power) w = i;
        s = this.list[w];
      }
      s.x1 = x1; s.y1 = y1; s.z1 = z1; s.r = 0; s.power = power; s.hot = hot ? 1 : 0; s.fam = fam; s.pulse = pulse;
    }
    s.x0 = x0; s.y0 = y0; s.z0 = z0;
    const fx = s.x1 - x0, fy = s.y1 - y0, fz = s.z1 - z0, fl = Math.hypot(fx, fy, fz) || 1;
    s.dx = fx / fl; s.dy = fy / fl; s.dz = fz / fl;
    s.r += 1; s.age = 0;
  }

  /** Decay every stream; drop the ones gone dark. */
  step(dt: number) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const s = this.list[i];
      s.r *= Math.exp(-dt / (s.pulse ? this.o.pulseTau : this.o.tau));
      s.age += dt;
      if (s.r < 0.02) continue;
      if (w !== i) { const t = this.list[w]; this.list[w] = s; this.list[i] = t; }
      w++;
    }
    this.n = w;
  }

  /** Rounds per second × power per round, now. */
  intensity(s: GunStream) { return (s.r / (s.pulse ? this.o.pulseTau : this.o.tau)) * s.power; }
  /** Length of its line. */
  static length(s: GunStream) { return Math.hypot(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0); }
}
