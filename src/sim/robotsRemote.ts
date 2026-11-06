// The robot swarm in the sim worker (docs/proposal-simworker.md step 4; design in docs/handoff-simworker.md). Both sides:
// - main: robotsRemote() turns the convoy lab's RobotSwarm into a view. Its outside methods (spawn, damage, setFrozen...)
//   still act on the view at once, so same-frame readers (a hit's "killed", a camp's new slots) work, and are recorded as
//   commands in the ground's stream (GroundRecorder.command), in order with the ground's changes. update() hands out the
//   events the worker sent back and records the step. Each answer's snapshot overwrites the view; the commands recorded
//   since that answer's frame are then replayed on it, silently (their events were handed out when they happened).
// - worker: RobotsWorker holds the real swarm on the worker's ground, its own safe zone round the worker's convoy, and
//   the wrecks' reactor positions the main thread sends each frame (a frame late). It applies the commands as they come
//   and runs the frame's steps when the frame ends (after its other commands, as the view saw them), then packs the
//   events and a snapshot.
// The snapshot is every typed array the swarm owns (slot arrays cut to hi) and its plain number and boolean fields,
// found by name, so a field added to RobotSwarm goes across without code here. Ownership: host (enemies).
import { RobotSwarm, ROBOT_MAX, type RobotEvent, type RobotTarget, type RobotValues } from "../combat/robots";
import { WALK_LEGS } from "../combat/robotLegs";
import { SafeZone, type SafeValues } from "../convoy/safeZone";
import type { Convoy } from "../convoy/platform";
import type { DuneField } from "../world/terrain";
import type { GroundRecorder } from "./groundEvents";
import { TRAMPLE_DEFAULTS, type MechBody, type TrampleValues } from "../combat/trample";

/** The swarm's outside methods that change it: recorded on the view, applied in the worker. */
export const ROBOT_OPS = [
  "spawn", "remove", "damage", "hitAt", "hurtLeg", "hurtOwn", "trample", "stomp", "setTarget", "clearTarget",
  "setFrozen", "shakeOff", "scaleHp", "setHealth", "setPace", "setShooter", "primeAttacks",
] as const;

/** Fields never copied: the step's own flags and scratch, the view's settings. */
const SKIP = new Set(["stepping", "silent", "hideDead", "remote", "events", "v", "ground", "lookGround", "keepOut", "reactors"]);

export interface RobotSnapshot {
  hi: number;
  arrays: Record<string, ArrayBufferView>;
  scalars: Record<string, number | boolean>;
  cores: RobotSwarm["cores"];
}

/** The swarm as it is now: slot arrays cut to hi, the rest whole. */
export function packRobots(sw: RobotSwarm): RobotSnapshot {
  const o = sw as unknown as Record<string, unknown>, hi = sw.hi;
  const arrays: Record<string, ArrayBufferView> = {}, scalars: Record<string, number | boolean> = {};
  for (const k of Object.keys(o)) {
    if (SKIP.has(k)) continue;
    const x = o[k];
    if (typeof x === "number" || typeof x === "boolean") scalars[k] = x;
    else if (ArrayBuffer.isView(x) && !(x instanceof DataView)) {
      const a = x as unknown as { length: number; slice(a: number, b: number): ArrayBufferView };
      const per = a.length === ROBOT_MAX ? 1 : a.length === ROBOT_MAX * WALK_LEGS ? WALK_LEGS : 0;
      arrays[k] = per ? a.slice(0, hi * per) : a.slice(0, a.length);
    }
  }
  return { hi, arrays, scalars, cores: sw.cores.map((c) => ({ ...c })) };
}

export function snapshotTransfer(s: RobotSnapshot): Transferable[] {
  return Object.values(s.arrays).map((a) => a.buffer as ArrayBuffer);
}

/** A snapshot into a swarm (the view). */
export function applyRobots(sw: RobotSwarm, s: RobotSnapshot) {
  const o = sw as unknown as Record<string, unknown>;
  for (const k in s.arrays) (o[k] as unknown as { set(a: ArrayLike<number>): void }).set(s.arrays[k] as unknown as ArrayLike<number>);
  for (const k in s.scalars) o[k] = s.scalars[k];
  sw.cores = s.cores;
}

const pickTrample = (tv: TrampleValues): TrampleValues => {
  const out = {} as Record<string, number>;
  for (const k in TRAMPLE_DEFAULTS) out[k] = (tv as unknown as Record<string, number>)[k];
  return out as unknown as TrampleValues;
};

/** The worker's side: the swarm itself. */
export class RobotsWorker {
  sw: RobotSwarm | null = null;
  private zone: SafeZone;
  private steps: [number, RobotTarget][] = [];
  private wrecks = new Map<number, [number, number, number]>();
  /** ms the last frame's steps took. */
  ms = 0;

  constructor(private V: RobotValues & SafeValues, private field: DuneField, private convoy: () => Convoy | null) {
    this.zone = new SafeZone(V);
  }

  /** The view's swarm was made (same values, same seed). */
  made(seed: number) {
    const sw = (this.sw = new RobotSwarm(this.V, this.field, seed));
    sw.keepOut = this.zone;
    sw.reactors = {
      at: (id, out) => { const p = this.wrecks.get(id); if (!p) return false; out.x = p[0]; out.y = p[1]; out.z = p[2]; return true; },
      blow: () => {},
    };
  }

  /** A command from the view (ROBOT_OPS), applied now. */
  op(m: string, a: unknown[]) {
    const sw = this.need();
    if (m === "trample") { sw.trample(a[0] as MechBody, a[1] as TrampleValues, (i, d, dx, dz) => sw.damage(i, d, dx, dz), null); return; }
    (sw as unknown as Record<string, (...x: unknown[]) => unknown>)[m](...a);
  }

  /** The view's step: run when the frame ends. */
  update(dt: number, base: RobotTarget) { this.steps.push([dt, base]); }

  /** The wrecks' hull positions (id, x, y, z per tracked reactor) from the main thread's death physics. */
  reactorsAt(flat: number[]) {
    this.wrecks.clear();
    for (let k = 0; k + 3 < flat.length; k += 4) this.wrecks.set(flat[k], [flat[k + 1], flat[k + 2], flat[k + 3]]);
  }

  /** End of a frame: the steps, their events and the swarm as it is after them. */
  frame(): { events: RobotEvent[]; snap: RobotSnapshot } | null {
    if (!this.sw) return null;
    const t0 = performance.now(), sw = this.sw, events: RobotEvent[] = [], c = this.convoy();
    if (c) this.zone.update(c.platforms);
    for (const [dt, base] of this.steps) for (const e of sw.step(dt, base)) events.push(e);
    this.steps.length = 0;
    const snap = packRobots(sw);
    this.ms = performance.now() - t0;
    return { events, snap };
  }

  private need(): RobotSwarm {
    if (!this.sw) throw new Error("robots: a command before the swarm was made");
    return this.sw;
  }
}

/** The main side: the view and the commands it recorded since each frame. */
export class RobotsView {
  private log: { frame: number; m: string; a: unknown[] }[] = [];
  private inbox: RobotEvent[] = [];
  private out: RobotEvent[] = [];
  private depth = 0;
  /** The frame being built (the host's next frame id). */
  frameId = 1;
  /** Snapshots taken, commands replayed on the view after one (a late answer), events handed out. */
  stats = { snapshots: 0, replayed: 0, events: 0, ops: 0, ms: 0 };

  constructor(readonly sw: RobotSwarm, rec: GroundRecorder, private reactors: () => RobotSwarm["reactors"], seed: number) {
    if (sw.hi > 0) console.warn("robots remote: the swarm already has robots; the worker's copy won't");
    rec.command("robots", "made", [seed]);
    const o = sw as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of ROBOT_OPS) {
      const orig = o[m];
      o[m] = (...args: unknown[]) => {
        if (this.depth === 0 && !sw.silent) {
          const a = m === "trample" ? [{ ...(args[0] as MechBody) }, pickTrample(args[1] as TrampleValues)] : args.map((x) => (typeof x === "function" ? null : x));
          this.log.push({ frame: this.frameId, m, a });
          rec.command("robots", "op", [m, a]);
          this.stats.ops++;
        }
        this.depth++;
        try { return orig.apply(sw, args); } finally { this.depth--; }
      };
    }
    sw.remote = {
      step: (dt, base) => {
        // The wrecks' reactors where the death physics has them now, then the step itself.
        const R = this.reactors(), flat: number[] = [], at = { x: 0, y: 0, z: 0 };
        if (R) for (const c of sw.cores) if (R.at(c.id, at)) flat.push(c.id, at.x, at.y, at.z);
        if (flat.length) rec.command("robots", "reactorsAt", [flat]);
        rec.command("robots", "update", [dt, { x: base.x, y: base.y, z: base.z, radius: base.radius, vx: base.vx, vz: base.vz, latchLow: base.latchLow, latchHigh: base.latchHigh }]);
      },
      events: () => {
        const e = this.inbox;
        this.inbox = this.out; this.out = e;
        this.inbox.length = 0;
        this.stats.events += e.length;
        return e;
      },
    };
  }

  /** The worker's answer for frame id: the snapshot onto the view, the commands since replayed, the events queued. */
  take(id: number, events: RobotEvent[], snap: RobotSnapshot, ms: number) {
    const sw = this.sw;
    applyRobots(sw, snap);
    let k = 0;
    while (k < this.log.length && this.log[k].frame <= id) k++;
    this.log.splice(0, k);
    if (this.log.length) {
      sw.silent = true;
      const o = sw as unknown as Record<string, (...a: unknown[]) => unknown>;
      this.depth++;
      try {
        for (const c of this.log) {
          if (c.m === "trample") sw.trample(c.a[0] as MechBody, c.a[1] as TrampleValues, (i, d, dx, dz) => sw.damage(i, d, dx, dz), null);
          else o[c.m](...c.a);
          this.stats.replayed++;
        }
      } finally { this.depth--; sw.silent = false; }
    }
    for (const e of events) this.inbox.push(e);
    this.stats.snapshots++;
    this.stats.ms = ms;
  }
}
