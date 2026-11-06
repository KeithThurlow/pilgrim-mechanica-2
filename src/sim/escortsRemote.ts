// The convoy's escorts in the sim worker (docs/proposal-simworker.md step 3). Both sides of it:
// - worker: EscortsWorker runs a real EscortGroup beside the worker's own copy of the convoy, stepped by the commands
//   the main thread recorded in order with the ground's changes (src/sim/groundEvents.ts `command`), and packs a
//   snapshot of every escort (pose, wheels, distance moved) into one Float64Array with each frame's answer;
// - main: escortsRemote() makes the convoy lab's EscortGroup send its calls as those commands, and applyEscorts()
//   writes a snapshot into the group's list (plain Escorts whose sims are only written, never stepped), so the bodies,
//   ruts and dust, and the escorts' guns read them unchanged, a frame late.
// Ownership: host (the escorts are convoy state; the snapshot is what a co-op peer would get).
import { EscortGroup, makeEscort, type EscortRemote, type EscortValues } from "../convoy/escort";
import type { Convoy } from "../convoy/platform";
import type { DuneField } from "../world/terrain";
import type { GroundRecorder } from "./groundEvents";

/** Per escort: wheel count, then HEAD values, then WHEEL values per wheel. */
const HEAD = 21, WHEEL = 8;

export class EscortsWorker {
  readonly group: EscortGroup;
  /** Each escort's distance moved since the last snapshot (summed over the steps). */
  private moved: number[] = [];
  private spots: { x: number; z: number }[] = [];
  private mech = { x: 0, z: 0 };

  constructor(v: EscortValues, convoy: Convoy, field: DuneField) { this.group = new EscortGroup(v, convoy, field); }

  /** One fixed step: mech [x, z] or null, the other mechs' spots as x, z pairs. */
  update(dt: number, mech: [number, number] | null, mechs: number[]) {
    const s = this.spots;
    s.length = mechs.length / 2;
    for (let i = 0; i < s.length; i++) s[i] = { x: mechs[2 * i], z: mechs[2 * i + 1] };
    this.group.mechs = s;
    if (mech) { this.mech.x = mech[0]; this.mech.z = mech[1]; }
    this.group.update(dt, mech ? this.mech : null);
    const l = this.group.list;
    for (let i = 0; i < l.length; i++) this.moved[i] = (this.moved[i] ?? 0) + l[i].moved;
  }

  reset() { this.group.reset(); this.moved.length = 0; }

  invalidate(x0: number, z0: number, x1: number, z1: number) { this.group.memo.invalidate(x0, z0, x1, z1); }

  /** Every escort as it is now. */
  snapshot(): Float64Array {
    const l = this.group.list;
    let n = 1;
    for (const e of l) n += 1 + HEAD + WHEEL * e.sim.wheels.length;
    const out = new Float64Array(n);
    out[0] = l.length;
    let o = 1;
    for (let i = 0; i < l.length; i++) {
      const e = l[i], s = e.sim, p = s.pos, q = s.quat, v = s.vel;
      out[o++] = s.wheels.length;
      out[o++] = p.x; out[o++] = p.y; out[o++] = p.z; out[o++] = s.heading; out[o++] = s.speed; out[o++] = s.lateral;
      out[o++] = v.x; out[o++] = v.y; out[o++] = v.z; out[o++] = s.yawRate; out[o++] = s.pitch; out[o++] = s.roll;
      out[o++] = q.x; out[o++] = q.y; out[o++] = q.z; out[o++] = q.w; out[o++] = s.contacts; out[o++] = s.steerAngle;
      out[o++] = this.moved[i] ?? 0; out[o++] = e.s; out[o++] = e.out;
      this.moved[i] = 0;
      for (const w of s.wheels) {
        out[o++] = w.pos.x; out[o++] = w.pos.y; out[o++] = w.pos.z; out[o++] = w.slip; out[o++] = w.compress;
        out[o++] = w.steer; out[o++] = w.spin; out[o++] = w.grounded ? 1 : 0;
      }
    }
    return out;
  }
}

/** The lab's group from now on runs in the worker: its calls become commands, in order with the ground's changes. */
export function escortsRemote(rec: GroundRecorder): EscortRemote {
  return {
    update: (dt, mech, mechs) => {
      const m: number[] = [];
      for (const s of mechs) m.push(s.x, s.z);
      rec.command("escorts", "update", [dt, mech ? [mech.x, mech.z] : null, m]);
    },
    reset: () => rec.command("escorts", "reset", []),
    invalidate: (x0, z0, x1, z1) => rec.command("escorts", "invalidate", [x0, z0, x1, z1]),
  };
}

/**
 * A snapshot into the group's list (escorts made or dropped to match). `moved` adds up until the trail takes it
 * (takeMoved), so a frame that gets two snapshots, or none, lays the right amount of dust.
 */
export function applyEscorts(g: EscortGroup, d: Float64Array) {
  const n = d[0], l = g.list;
  while (l.length > n) l.pop();
  while (l.length < n) l.push(makeEscort(l.length, g.field));
  let o = 1;
  for (let i = 0; i < n; i++) {
    const e = l[i], s = e.sim, nw = d[o++];
    s.pos.set(d[o], d[o + 1], d[o + 2]); s.heading = d[o + 3]; s.speed = d[o + 4]; s.lateral = d[o + 5];
    s.vel.set(d[o + 6], d[o + 7], d[o + 8]); s.yawRate = d[o + 9]; s.pitch = d[o + 10]; s.roll = d[o + 11];
    s.quat.set(d[o + 12], d[o + 13], d[o + 14], d[o + 15]); s.contacts = d[o + 16]; s.steerAngle = d[o + 17];
    e.moved += d[o + 18]; e.s = d[o + 19]; e.out = d[o + 20];
    o += HEAD;
    // Wheels: the kind's count (a slider can change the layout); missing ones copied from the first.
    while (s.wheels.length < nw) s.wheels.push({ ...s.wheels[0], pos: s.wheels[0].pos.clone() });
    s.wheels.length = nw;
    for (const w of s.wheels) {
      w.pos.set(d[o], d[o + 1], d[o + 2]); w.slip = d[o + 3]; w.compress = d[o + 4]; w.steer = d[o + 5]; w.spin = d[o + 6]; w.grounded = d[o + 7] > 0.5;
      o += WHEEL;
    }
  }
}

/** The convoy's poses: x, y, z, heading per platform, then the plough's x, z (the parity check's numbers). */
export function convoyPoses(c: Convoy, out = new Float64Array(c.platforms.length * 4 + 2)): Float64Array {
  let o = 0;
  for (const p of c.platforms) { out[o++] = p.x; out[o++] = p.y; out[o++] = p.z; out[o++] = p.heading; }
  out[o++] = c.plough.x; out[o++] = c.plough.z;
  return out;
}
