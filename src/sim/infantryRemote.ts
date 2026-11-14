// The infantry swarm in the sim worker (stage 7b, docs/proposal-stage7.md; the robots' way, src/sim/robotsRemote.ts).
// Both sides:
// - main: InfantryView turns an InfantrySwarm (the convoy lab's bandit camps, with the war bands' riders) into a view.
//   Its outside methods (spawn, damage, setTarget, sleep...) still act on the view at once, so same-frame readers (a
//   hit's "killed", a camp's new slots, deaths for item drops) work, and are recorded as commands in the ground's stream
//   (GroundRecorder.command), in order with the ground's changes and the view's steps. update() hands the shots the
//   worker sent back to its onShot and records the step. Each answer's snapshot overwrites the view; the commands
//   recorded since that answer's frame are then replayed on it, silently (their deaths were raised when they happened).
// - worker: InfantryWorker holds the real swarm on the worker's ground and its own safe zone round the worker's convoy.
//   Commands and steps run in the stream's order (as on the main thread without the worker); at the frame's end it packs
//   the steps' shots and a snapshot.
// The snapshot: the swarm's block (stage 7a: Transform, Velocity, Health, Status, Infantry, one buffer each) and every
// other typed array the swarm owns (slot arrays cut to hi) and its plain number and boolean fields, found by name.
// Several swarms can go across, each by its id. Not yet: a swarm with a fence (a fortress's garrison: the walls would
// have to go across too). Ownership: host (enemies).
import { InfantrySwarm, INFANTRY_MAX, DEAD, type InfantryTarget, type InfantryValues } from "../combat/infantry";
import { SafeZone, type SafeValues } from "../convoy/safeZone";
import type { Convoy } from "../convoy/platform";
import type { DuneField } from "../world/terrain";
import type { GroundRecorder } from "./groundEvents";
import { blockBuffers, type BlockSnapshot } from "../ecs/snapshot";
import { TRAMPLE_DEFAULTS, type MechBody, type TrampleValues, type GroundThreat } from "../combat/trample";

/** The swarm's outside methods that change it: recorded on the view, applied in the worker. */
export const INFANTRY_OPS = [
  "spawn", "remove", "damage", "shove", "trample", "dodge", "stomp", "setTarget", "clearTarget",
  "setFrozen", "sleep", "setPace", "scaleHp", "setHeading",
] as const;

/**
 * Calls that would change nothing are not sent (a camp sets every bandit's freeze and post every frame). Safe for
 * fields only the outside methods write (the view's values are then the worker's at the same point in the stream);
 * `sleep` also zeroes the velocity, which the step leaves alone on a frozen bandit at rest.
 */
const UNCHANGED: Record<string, (sw: InfantrySwarm, a: unknown[]) => boolean> = {
  setFrozen: (sw, a) => sw.frozen[a[0] as number] === (a[1] ? 1 : 0),
  setPace: (sw, a) => sw.pace[a[0] as number] === Math.fround(a[1] as number),
  clearTarget: (sw, a) => sw.hasT[a[0] as number] === 0 && sw.calm[a[0] as number] === 0,
  sleep: (sw, a) => { const i = a[0] as number; return sw.frozen[i] === 1 && sw.vx[i] === 0 && sw.vz[i] === 0 && sw.hasT[i] === 0 && sw.calm[i] === 0; },
  setTarget: (sw, a) => {
    const i = a[0] as number, f = Math.fround;
    return sw.hasT[i] === 1 && sw.tgx[i] === f(a[1] as number) && sw.tgy[i] === f(a[2] as number) && sw.tgz[i] === f(a[3] as number)
      && sw.tgr[i] === f(a[4] as number) && sw.calm[i] === (a[5] ? 1 : 0);
  },
};

/** Fields never copied: the view's own flags and settings. */
const SKIP = new Set(["snapStamp", "silent", "hideDead", "remote", "v", "ground", "keepOut", "fence", "onDeath", "ko", "slotT"]);

export interface InfantrySnapshot {
  hi: number;
  /** The swarm's block of the world: its simulated components, slots 0..hi. */
  block: BlockSnapshot;
  /** The swarm's other arrays, by field name. */
  arrays: Record<string, ArrayBufferView>;
  scalars: Record<string, number | boolean>;
}

/** The swarm as it is now: its block and slot arrays cut to hi, the rest whole. */
export function packInfantry(sw: InfantrySwarm): InfantrySnapshot {
  const o = sw as unknown as Record<string, unknown>, hi = sw.hi, block = sw.block;
  const arrays: Record<string, ArrayBufferView> = {}, scalars: Record<string, number | boolean> = {};
  for (const k of Object.keys(o)) {
    if (SKIP.has(k)) continue;
    const x = o[k];
    if (typeof x === "number" || typeof x === "boolean") scalars[k] = x;
    else if (ArrayBuffer.isView(x) && !(x instanceof DataView) && !block.isShipped(x)) {
      const a = x as unknown as { length: number; slice(a: number, b: number): ArrayBufferView };
      arrays[k] = a.slice(0, a.length === INFANTRY_MAX ? hi : a.length);
    }
  }
  return { hi, block: block.pack(hi), arrays, scalars };
}

export const infantryTransfer = (s: InfantrySnapshot): Transferable[] =>
  [...blockBuffers(s.block), ...Object.values(s.arrays).map((a) => a.buffer as ArrayBuffer)];

/** A snapshot into a swarm (the view). */
export function applyInfantry(sw: InfantrySwarm, s: InfantrySnapshot) {
  const o = sw as unknown as Record<string, unknown>;
  sw.block.apply(s.block);
  for (const k in s.arrays) (o[k] as unknown as { set(a: ArrayLike<number>): void }).set(s.arrays[k] as unknown as ArrayLike<number>);
  for (const k in s.scalars) o[k] = s.scalars[k];
  sw.block.relinkBandits(sw.hi, DEAD);
}

const pickTrample = (tv: TrampleValues): TrampleValues => {
  const out = {} as Record<string, number>;
  for (const k in TRAMPLE_DEFAULTS) out[k] = (tv as unknown as Record<string, number>)[k];
  return out as unknown as TrampleValues;
};

/** Apply a recorded call to a swarm (trample's hurt is the swarm's own damage: the view's adapter only counts kills). */
function call(sw: InfantrySwarm, m: string, a: unknown[]) {
  if (m === "trample") { sw.trample(a[0] as MechBody, a[1] as TrampleValues, (i, d, dx, dz, s) => sw.damage(i, d, dx, dz, s), null); return; }
  if (m === "dodge") { sw.dodge(a[0] as GroundThreat[]); return; }
  (sw as unknown as Record<string, (...x: unknown[]) => unknown>)[m](...a);
}

export interface InfantryFrame { id: number; shots: Float64Array; snap: InfantrySnapshot }

/** The worker's side: the swarms themselves. */
export class InfantryWorker {
  readonly swarms = new Map<number, { sw: InfantrySwarm; shots: number[] }>();
  private zone: SafeZone;
  /** ms the last frame's steps took. */
  ms = 0;
  private stepMs = 0;

  constructor(private V: InfantryValues & SafeValues, private field: DuneField, private convoy: () => Convoy | null) {
    this.zone = new SafeZone(V);
  }

  /** The view's swarm `id` was made (same values, same seed). */
  made(id: number, seed: number) {
    const sw = new InfantrySwarm(this.V, this.field, seed);
    sw.keepOut = this.zone;
    this.swarms.set(id, { sw, shots: [] });
  }

  /** A command from the view (INFANTRY_OPS), applied now. */
  op(id: number, m: string, a: unknown[]) { call(this.need(id).sw, m, a); }

  /** The view's step, at its place in the stream. */
  update(id: number, dt: number, base: InfantryTarget) {
    const t0 = performance.now(), s = this.need(id), c = this.convoy();
    if (c) this.zone.update(c.platforms);
    s.sw.update(dt, base, (fx, fy, fz, tx, ty, tz, i) => { s.shots.push(fx, fy, fz, tx, ty, tz, i); });
    this.stepMs += performance.now() - t0;
  }

  /** End of a frame: each swarm's shots since the last and a snapshot. */
  frame(): InfantryFrame[] {
    const out: InfantryFrame[] = [];
    for (const [id, s] of this.swarms) {
      out.push({ id, shots: Float64Array.from(s.shots), snap: packInfantry(s.sw) });
      s.shots.length = 0;
    }
    this.ms = this.stepMs;
    this.stepMs = 0;
    return out;
  }

  private need(id: number) {
    const s = this.swarms.get(id);
    if (!s) throw new Error(`infantry ${id}: a command before the swarm was made`);
    return s;
  }
}

export const infantryFrameTransfer = (f: InfantryFrame[]): Transferable[] => f.flatMap((x) => [x.shots.buffer as ArrayBuffer, ...infantryTransfer(x.snap)]);

/** The main side: the view and the commands it recorded since each frame. */
export class InfantryView {
  private log: { frame: number; m: string; a: unknown[] }[] = [];
  private inbox: number[] = [];
  private depth = 0;
  /** The frame being built (the host's next frame id). */
  frameId = 1;
  /** Snapshots taken, commands replayed on the view after one (a late answer), shots handed out, calls sent, worker ms. */
  stats = { snapshots: 0, replayed: 0, shots: 0, ops: 0, ms: 0 };

  constructor(readonly sw: InfantrySwarm, readonly id: number, rec: GroundRecorder, seed: number) {
    if (sw.hi > 0) console.warn("infantry remote: the swarm already has bandits; the worker's copy won't");
    if (sw.fence) console.warn("infantry remote: the swarm has a fence, which doesn't go to the worker");
    rec.command("infantry", "made", [id, seed]);
    const o = sw as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of INFANTRY_OPS) {
      const orig = o[m], same = UNCHANGED[m];
      o[m] = (...args: unknown[]) => {
        if (this.depth === 0 && !sw.silent && !(same && same(sw, args))) {
          const a = m === "trample" ? [{ ...(args[0] as MechBody) }, pickTrample(args[1] as TrampleValues)]
            : m === "dodge" ? [(args[0] as GroundThreat[]).map((t) => ({ ...t }))]
            : args.map((x) => (typeof x === "function" ? null : x));
          this.log.push({ frame: this.frameId, m, a });
          rec.command("infantry", "op", [id, m, a]);
          this.stats.ops++;
        }
        this.depth++;
        try { return orig.apply(sw, args); } finally { this.depth--; }
      };
    }
    sw.remote = {
      step: (dt, base) => rec.command("infantry", "update", [id, dt, { x: base.x, y: base.y, z: base.z, radius: base.radius }]),
      shots: () => { const s = this.inbox; this.inbox = []; this.stats.shots += s.length / 7; return s; },
    };
  }

  /** The worker's answer for frame id: the snapshot onto the view, the commands since replayed, the shots queued. */
  take(id: number, shots: ArrayLike<number>, snap: InfantrySnapshot, ms: number) {
    const sw = this.sw;
    applyInfantry(sw, snap);
    let k = 0;
    while (k < this.log.length && this.log[k].frame <= id) k++;
    this.log.splice(0, k);
    if (this.log.length) {
      sw.silent = true;
      this.depth++;
      try { for (const c of this.log) { call(sw, c.m, c.a); this.stats.replayed++; } } finally { this.depth--; sw.silent = false; }
    }
    for (let j = 0; j < shots.length; j++) this.inbox.push(shots[j]);
    sw.snapStamp++;
    this.stats.snapshots++;
    this.stats.ms = ms;
  }
}
