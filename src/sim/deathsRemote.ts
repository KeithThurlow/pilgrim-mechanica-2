// Death physics in the sim worker (perf 2026-11-07, after step 4; docs/handoff-simworker.md). Both sides:
// - main: deathsRemote() makes the convoy lab's DeathPhysics a view: a new body (ragdoll, mech wreck, vehicle wreck) is
//   placed there as it died and sent with an id as a command in the ground's stream; follow, groundChanged, step, burst
//   and remove go the same way. Each frame's answer writes the poses of the bodies still moving (and the one they froze
//   in), whether each is live or done, how far it has sunk, and the wrecks' thuds into the view's list, so the drawers,
//   reactor wrecks and mech wrecks read it unchanged, a frame late.
// - worker: DeathsWorker holds the real Rapier world on the worker's ground. Rapier loads asynchronously there, so
//   commands wait until it has.
// Ownership: cosmetic (rule 12), so no bit-for-bit check: the spin a body is thrown with is Math.random on each side.
import { Quaternion, Vector3 } from "three";
import { DeathPhysics, initPhysics, type Dead, type DeathValues, type HoldValues, type JointSpec, type PartSpec } from "../physics/deaths";
import type { DuneField } from "../world/terrain";
import type { GroundRecorder } from "./groundEvents";

const LIVE = 1, DONE = 2, POSE = 4;
type Vec = { x: number; y: number; z: number };

/** The worker's side: the real world. */
export class DeathsWorker {
  private phys: DeathPhysics | null = null;
  private queue: [string, unknown[]][] = [];
  private byId = new Map<number, Dead>();
  /** Ids that were live at the last snapshot (their freeze pose goes out once more). */
  private wasLive = new Set<number>();
  ms = 0;

  constructor(private V: DeathValues & HoldValues, private field: DuneField) {
    void initPhysics().then(() => {
      this.phys = new DeathPhysics(this.V, this.field);
      for (const [m, a] of this.queue) this.call(m, a);
      this.queue.length = 0;
    });
  }

  made(id: number, m: string, a: unknown[], o: unknown) { this.call("made", [id, m, a, o]); }
  keep(id: number, on: boolean) { this.call("keep", [id, on]); }
  follow(x: number, z: number) { this.call("follow", [x, z]); }
  groundChanged(x0?: number, z0?: number, x1?: number, z1?: number) { this.call("groundChanged", [x0, z0, x1, z1]); }
  step(dt: number) { this.call("step", [dt]); }
  burst(id: number, x: number, y: number, z: number, radius: number, speed: number) { this.call("burst", [id, x, y, z, radius, speed]); }
  remove(id: number) { this.call("remove", [id]); }

  private call(m: string, a: unknown[]) {
    const P = this.phys;
    if (!P) { this.queue.push([m, a]); return; }
    const t0 = performance.now();
    switch (m) {
      case "made": {
        const [id, kind, x] = a as [number, string, unknown[]];
        let d: Dead;
        if (kind === "ragdoll") {
          const [parts, joints, px, py, pz, yaw, vel, dx, dz, s, tip] = x as [PartSpec[], JointSpec[], number, number, number, number, { x: number; y: number; z: number }, number, number, number, number];
          d = P.ragdoll(parts, joints, px, py, pz, yaw, vel, dx, dz, s, tip);
        } else if (kind === "heavy") {
          const [parts, joints, lin, ang, o] = x as [PartSpec[], JointSpec[], { x: number; y: number; z: number }[], { x: number; y: number; z: number }, { damping: number; moveFor: number; thud: { part: number; at: [number, number, number] }[] }];
          d = P.heavy(parts, joints, lin, ang, { ...o, hold: this.V });
        } else {
          const [half, cab, pos, q, vel, dx, dz, lift, spin] = x as [[number, number, number], { half: [number, number, number]; at: [number, number, number] }, number[], number[], number[], number, number, number, number];
          d = P.wreck(half, cab, new Vector3(pos[0], pos[1], pos[2]), new Quaternion(q[0], q[1], q[2], q[3]), new Vector3(vel[0], vel[1], vel[2]), dx, dz, lift, spin);
        }
        // What the owner set on it after making it, before it went out (raider debris: its kind, kept, its spin).
        const o = a[3] as { keep: boolean; kind: Dead["kind"]; lin?: Vec[]; ang?: Vec[] };
        d.keep = o.keep; d.kind = o.kind;
        if (o.lin && o.ang) {
          if (d.pending) { d.pending.lin = o.lin; d.pending.ang = o.ang; }
          else d.bodies.forEach((b, k) => { if (o.lin![k]) b.setLinvel(o.lin![k], true); if (o.ang![k]) b.setAngvel(o.ang![k], true); });
        }
        d.id = id;
        this.byId.set(id, d);
        break;
      }
      case "keep": { const d = this.byId.get(a[0] as number); if (d) d.keep = a[1] as boolean; break; }
      case "follow": P.follow(a[0] as number, a[1] as number); break;
      case "groundChanged": P.groundChanged(...(a as [number?, number?, number?, number?])); break;
      case "step": P.step(a[0] as number); break;
      case "burst": { const d = this.byId.get(a[0] as number); if (d) P.burst(d, a[1] as number, a[2] as number, a[3] as number, a[4] as number, a[5] as number); break; }
      case "remove": { const id = a[0] as number, d = this.byId.get(id); if (d) { P.remove(d); this.byId.delete(id); this.wasLive.delete(id); } break; }
    }
    this.ms += performance.now() - t0;
  }

  /** The bodies that changed: id, flags, sink, part count, then the poses (x y z, qx qy qz qw per part) when sent. */
  frame(): { poses: Float64Array; thuds: Float64Array; ms: number } {
    const out: number[] = [], th: number[] = [];
    for (const [id, d] of this.byId) {
      const pose = d.live || this.wasLive.has(id);
      out.push(id, (d.live ? LIVE : 0) | (d.done ? DONE : 0) | (pose ? POSE : 0), d.sink, d.pos.length);
      if (pose) for (let k = 0; k < d.pos.length; k++) { const p = d.pos[k], q = d.quat[k]; out.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w); }
      if (d.live) this.wasLive.add(id); else this.wasLive.delete(id);
      const hits = d.thud?.impacts;
      if (hits?.length) { for (const h of hits) th.push(id, h.x, h.y, h.z, h.speed); hits.length = 0; }
      if (d.done) { this.byId.delete(id); this.wasLive.delete(id); }
    }
    const ms = this.ms;
    this.ms = 0;
    return { poses: new Float64Array(out), thuds: new Float64Array(th), ms };
  }
}

/** The main side: the lab's DeathPhysics as a view of the worker's. */
export class DeathsView {
  private byId = new Map<number, Dead>();
  private next = 1;
  stats = { bodies: 0, ms: 0 };

  constructor(private phys: DeathPhysics, private rec: GroundRecorder) {
    if (phys.dead.length) console.warn("deaths remote: bodies made before the worker took over stay frozen here");
    // A new body goes out with the next command (the frame's step at the latest), so what its owner sets on it
    // straight after making it goes too; kept flags the owners flip later go with each step.
    phys.remote = {
      made: (d, m, a) => { d.id = this.next++; this.byId.set(d.id, d); this.fresh.push([d, m, a]); },
      cmd: (m, a) => {
        this.flush();
        if (m === "step") for (const [id, d] of this.byId) if (!!d.keep !== this.kept.has(id)) { this.rec.command("deaths", "keep", [id, !!d.keep]); if (d.keep) this.kept.add(id); else this.kept.delete(id); }
        if (m === "remove") this.kept.delete(a[0] as number);
        this.rec.command("deaths", m, a);
      },
    };
  }
  private fresh: [Dead, string, unknown[]][] = [];
  private kept = new Set<number>();

  private flush() {
    for (const [d, m, a] of this.fresh) {
      const p = d.pending;
      this.rec.command("deaths", "made", [d.id, m, a, { keep: !!d.keep, kind: d.kind, lin: p?.lin, ang: p?.ang }]);
      if (d.keep) this.kept.add(d.id!);
    }
    this.fresh.length = 0;
  }

  take(poses: Float64Array, thuds: Float64Array, ms: number) {
    let o = 0;
    while (o < poses.length) {
      const id = poses[o], flags = poses[o + 1], sink = poses[o + 2], n = poses[o + 3];
      o += 4;
      const d = this.byId.get(id);
      if (d) { d.live = (flags & LIVE) !== 0; d.sink = sink; }
      if (flags & POSE) {
        if (d) for (let k = 0; k < n && k < d.pos.length; k++) { const b = o + k * 7; d.pos[k].set(poses[b], poses[b + 1], poses[b + 2]); d.quat[k].set(poses[b + 3], poses[b + 4], poses[b + 5], poses[b + 6]); }
        o += n * 7;
      }
      if (d && flags & DONE) {
        d.done = true;
        this.byId.delete(id);
        this.kept.delete(id);
        const i = this.phys.dead.indexOf(d);
        if (i >= 0) this.phys.dead.splice(i, 1);
      }
    }
    for (let k = 0; k + 4 < thuds.length; k += 5) {
      const d = this.byId.get(thuds[k]);
      d?.thud?.impacts.push({ x: thuds[k + 1], y: thuds[k + 2], z: thuds[k + 3], speed: thuds[k + 4] });
    }
    // Removed here (an owner's remove): gone from the map too.
    for (const [id, d] of this.byId) if (d.done) { this.byId.delete(id); this.kept.delete(id); }
    this.stats.bodies = this.byId.size;
    this.stats.ms = ms;
  }
}
