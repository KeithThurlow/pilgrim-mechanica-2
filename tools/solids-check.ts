// Solid bodies (src/game/solids.ts; Keith 2026-11-01: mechs walked through each other). Must never happen:
// - two mechs walking, sprinting or shoved into each other end a frame overlapping (beyond a few cm);
// - a vehicle drives through a mech, or two vehicles through each other;
// - a mech walking into a standing one shoves it as far as it walks (the mover takes most: mechShove);
// - a body that stopped stepping (parked, hanging from the crane) still blocks;
// - the shove breaks the legs (NaN, the hips off the ground, a leg out of reach far more often than walking alone).
// And with solidsOn 0 they pass through, as before.
import { WalkerSim, type MoveCommand } from "../src/mech/walker";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { CarSim, carValues, type CarKind } from "../src/vehicles/car";
import { Solids, SOLID_DEFAULTS, closestPoints, overlap, type Solid, type SolidShape, type SolidValues } from "../src/game/solids";
import { VEHICLE_MASS, TRAMPLE_DEFAULTS } from "../src/combat/trample";

let fails = 0;
const must = (ok: boolean, what: string) => { if (!ok) { fails++; console.log("  FAIL", what); } };
const flat = new DuneField({ ...TERRAIN_DEFAULTS, height: 0, swell: 0, bumps: 0 });
const WV = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values };
const dt = 1 / 60, SUB = 2;
const TOL = 0.05;

/** A mech as MechUnit makes it a solid (pillbox, mass from the ram sliders). */
class Mech implements Solid {
  sim = new WalkerSim({ ...WV }, flat);
  soft = false; team = 1;
  constructor(x: number, z: number, heading: number, private sv: SolidValues) { this.sim.reset(x, z, heading); }
  solidShape(o: SolidShape) {
    const s = this.sim;
    o.x = s.pos.x; o.z = s.pos.z; o.hx = 0; o.hz = 0; o.r = this.sv.bodyRadius;
    o.y0 = s.pelvis.y - WV.hipHeight; o.y1 = s.pelvis.y + 3; o.mass = TRAMPLE_DEFAULTS.ramMechMass; o.mech = true;
    o.soft = this.soft; o.team = this.team;
    return true;
  }
  solidShove(dx: number, dz: number, nx: number, nz: number) { this.sim.shove(dx, dz, nx, nz); }
  step(solids: Solids, cmd: MoveCommand) {
    for (let i = 0; i < SUB; i++) this.sim.update(dt / SUB, cmd);
    solids.resolve(this, dt, this.sv);
  }
}

/** A vehicle as the war band's Raider makes it a solid. */
const HALF: Record<string, [number, number]> = { technical: [2.5, 1.25], sixWheeler: [3.6, 1.6], warRig: [5.5, 1.9] };
class Car implements Solid {
  sim: CarSim;
  constructor(readonly kind: CarKind, x: number, z: number, heading: number) { this.sim = new CarSim(carValues(kind), flat); this.sim.reset(x, z, heading); }
  solidShape(o: SolidShape) {
    const s = this.sim, [half, r] = HALF[this.kind];
    o.x = s.pos.x; o.z = s.pos.z; o.hx = Math.sin(s.heading) * half; o.hz = Math.cos(s.heading) * half; o.r = r;
    o.y0 = s.pos.y - 0.5; o.y1 = s.pos.y + 4; o.mass = VEHICLE_MASS[this.kind]; o.mech = false;
    return true;
  }
  solidShove(dx: number, dz: number, nx: number, nz: number) {
    const s = this.sim;
    s.pos.x += dx; s.pos.z += dz;
    const fx = Math.sin(s.heading), fz = Math.cos(s.heading), lx = Math.cos(s.heading), lz = -Math.sin(s.heading);
    let vx = fx * s.speed + lx * s.lateral, vz = fz * s.speed + lz * s.lateral;
    const d = vx * nx + vz * nz;
    if (d >= 0) return;
    vx -= nx * d; vz -= nz * d;
    s.speed = vx * fx + vz * fz; s.lateral = vx * lx + vz * lz;
  }
  step(solids: Solids, throttle: number) {
    for (let i = 0; i < SUB; i++) this.sim.update(dt / SUB, throttle, 0);
    solids.resolve(this, dt);
  }
}

const shapes = () => [{ x: 0, z: 0, hx: 0, hz: 0, r: 0, y0: 0, y1: 0, mass: 1, mech: false }, { x: 0, z: 0, hx: 0, hz: 0, r: 0, y0: 0, y1: 0, mass: 1, mech: false }] as SolidShape[];
const depth = (a: Solid, b: Solid) => { const [p, q] = shapes(); a.solidShape(p); b.solidShape(q); return overlap(p, q, { depth: 0, nx: 0, nz: 0 }).depth; };
const legsOk = (m: Mech) => Number.isFinite(m.sim.pos.x) && Number.isFinite(m.sim.pelvis.y) && m.sim.pelvis.y > WV.hipHeight * 0.6 && m.sim.pelvis.y < WV.hipHeight * 1.4;

// Geometry.
{
  const [a, b] = shapes(); const pts = [0, 0, 0, 0];
  Object.assign(a, { x: 0, z: 0, hx: 0, hz: 3 }); Object.assign(b, { x: 2, z: 0, hx: 0, hz: 3 });
  closestPoints(a, b, pts);
  must(Math.abs(Math.hypot(pts[0] - pts[2], pts[1] - pts[3]) - 2) < 1e-6, "parallel segments 2 m apart");
  Object.assign(b, { x: 0, z: 0, hx: 3, hz: 0 });
  closestPoints(a, b, pts);
  must(Math.hypot(pts[0] - pts[2], pts[1] - pts[3]) < 1e-6, "crossing segments touch");
  Object.assign(a, { r: 1, y0: 0, y1: 5 }); Object.assign(b, { x: 0, z: 10, hx: 0, hz: 0, r: 1, y0: 0, y1: 5 });
  must(overlap(a, b, { depth: 0, nx: 0, nz: 0 }).depth === 0, "apart: no overlap");
  Object.assign(b, { z: 4.5 });
  const o = overlap(a, b, { depth: 0, nx: 0, nz: 0 });
  must(Math.abs(o.depth - 0.5) < 1e-6 && o.nz < -0.99, `segment end 1.5 m from a circle: 0.5 m deep, out along -z (${o.depth.toFixed(3)}, ${o.nz.toFixed(2)})`);
  Object.assign(b, { y0: 6, y1: 9 });
  must(overlap(a, b, { depth: 0, nx: 0, nz: 0 }).depth === 0, "apart in height: no overlap");
}

const sv: SolidValues = { ...SOLID_DEFAULTS };
const R = sv.bodyRadius;

// 1. Head on: two mechs walking at each other for 6 s.
{
  const solids = new Solids();
  const a = new Mech(0, -10, 0, sv), b = new Mech(0, 10, Math.PI, sv);
  let worst = 0, ok = true;
  for (let f = 0; f < 360; f++) {
    a.step(solids, { x: 0, z: 1, sprint: false }); b.step(solids, { x: 0, z: -1, sprint: false }); solids.tick(dt);
    worst = Math.max(worst, depth(a, b)); ok &&= legsOk(a) && legsOk(b);
  }
  const gap = b.sim.pos.z - a.sim.pos.z;
  console.log(`head on: centres ${gap.toFixed(2)} m apart (pillboxes ${(2 * R).toFixed(2)}), worst overlap ${worst.toFixed(3)} m, overreach ${a.sim.stats.overreach}/${b.sim.stats.overreach}`);
  must(worst < TOL, `head on: overlap ${worst.toFixed(3)} m`);
  must(Math.abs(a.sim.pos.z + b.sim.pos.z) < 0.5, "head on: they meet in the middle");
  must(ok, "head on: legs broke");
}

// 2. Walking into a standing mech: the mover stops; the standing one is nudged, not carried.
{
  const solids = new Solids();
  const a = new Mech(0, -8, 0, sv), b = new Mech(0, 0, Math.PI, sv);
  let worst = 0;
  for (let f = 0; f < 300; f++) {
    a.step(solids, { x: 0, z: 1, sprint: false }); b.step(solids, { x: 0, z: 0, sprint: false }); solids.tick(dt);
    worst = Math.max(worst, depth(a, b));
  }
  const pushed = b.sim.pos.z, walked = a.sim.pos.z + 8;
  console.log(`walk into a standing mech: walker went ${walked.toFixed(2)} m, the standing one shoved ${pushed.toFixed(2)} m, walker speed ${a.sim.speed.toFixed(2)} m/s, worst overlap ${worst.toFixed(3)}`);
  must(worst < TOL, `walk in: overlap ${worst.toFixed(3)} m`);
  must(pushed > 0.05 && pushed < walked * 0.5, `walk in: shove ${pushed.toFixed(2)} m of ${walked.toFixed(2)} (mechShove ${sv.mechShove})`);
  must(a.sim.speed < 3, `walk in: the walker keeps walking at ${a.sim.speed.toFixed(2)} m/s into it`);
  // A mechShove of 0: it stands like a wall.
  const s0 = new Solids(), w = { ...sv, mechShove: 0 };
  const c = new Mech(0, -8, 0, w), d = new Mech(0, 0, Math.PI, w);
  for (let f = 0; f < 300; f++) { c.step(s0, { x: 0, z: 1, sprint: false }); d.step(s0, { x: 0, z: 0, sprint: false }); s0.tick(dt); }
  must(Math.abs(d.sim.pos.z) < 0.15, `mechShove 0: the standing mech moved ${d.sim.pos.z.toFixed(2)} m`);
}

// 3. Sprinting into a standing mech (the run's own speed, held on Space).
{
  const solids = new Solids();
  const a = new Mech(0, -30, 0, sv), b = new Mech(0, 0, Math.PI, sv);
  let worst = 0, ok = true, top = 0;
  for (let f = 0; f < 480; f++) {
    a.sim.bound = true;
    a.step(solids, { x: 0, z: 1, sprint: true }); b.step(solids, { x: 0, z: 0, sprint: false }); solids.tick(dt);
    worst = Math.max(worst, depth(a, b)); ok &&= legsOk(a) && legsOk(b); top = Math.max(top, a.sim.speed);
  }
  console.log(`sprint into a standing mech: top ${top.toFixed(1)} m/s, worst overlap ${worst.toFixed(3)} m, standing one shoved ${b.sim.pos.z.toFixed(2)} m`);
  must(worst < 0.25, `sprint in: overlap ${worst.toFixed(3)} m`);
  must(ok, "sprint in: legs broke");
}

// 4. A truck driving at a standing mech, and two trucks head on.
{
  const solids = new Solids();
  const m = new Mech(0, 0, 0, sv), t = new Car("sixWheeler", 0, -40, 0);
  let worst = 0;
  for (let f = 0; f < 480; f++) { t.step(solids, 1); m.step(solids, { x: 0, z: 0, sprint: false }); solids.tick(dt); worst = Math.max(worst, depth(m, t)); }
  console.log(`truck into a mech: worst overlap ${worst.toFixed(3)} m, mech shoved ${m.sim.pos.z.toFixed(2)} m, truck at ${t.sim.speed.toFixed(1)} m/s`);
  must(worst < 0.3, `truck in: overlap ${worst.toFixed(3)} m`);
  must(legsOk(m), "truck in: mech legs broke");

  const s2 = new Solids();
  const p = new Car("technical", 0.6, -30, 0), q = new Car("warRig", 0, 30, Math.PI);
  let w2 = 0;
  for (let f = 0; f < 480; f++) { p.step(s2, 1); q.step(s2, 1); s2.tick(dt); w2 = Math.max(w2, depth(p, q)); }
  console.log(`technical into a war rig head on: worst overlap ${w2.toFixed(3)} m`);
  must(w2 < 0.3, `trucks: overlap ${w2.toFixed(3)} m`);
}

// 5. A mech that stops stepping (parked) stops blocking; with solidsOn 0 they pass through.
{
  const solids = new Solids();
  const a = new Mech(0, -8, 0, sv), b = new Mech(0, 0, Math.PI, sv);
  b.step(solids, { x: 0, z: 0, sprint: false });
  for (let f = 0; f < 300; f++) { a.step(solids, { x: 0, z: 1, sprint: false }); solids.tick(dt); }
  must(a.sim.pos.z > 2, `a parked mech still blocks (walker at ${a.sim.pos.z.toFixed(2)})`);

  const off = { ...sv, solidsOn: 0 }, s3 = new Solids();
  const c = new Mech(0, -8, 0, off), d = new Mech(0, 0, Math.PI, off);
  for (let f = 0; f < 300; f++) { c.step(s3, { x: 0, z: 1, sprint: false }); d.step(s3, { x: 0, z: 0, sprint: false }); s3.tick(dt); }
  must(c.sim.pos.z > 2, "solidsOn 0: they should pass through");
}

// 6. Summons (Keith 2026-11-02): the player walks through its own replica, which is nudged aside, without slowing;
// an enemy mech (another team) still blocks the replica.
{
  const solids = new Solids();
  const a = new Mech(0, -8, 0, sv), rep = new Mech(0.4, 0, Math.PI, { ...sv, bodyRadius: 1.2 });
  rep.soft = true;
  let moved = 0;
  for (let f = 0; f < 300; f++) { a.step(solids, { x: 0, z: 1, sprint: false }); rep.step(solids, { x: 0, z: 0, sprint: false }); solids.tick(dt); }
  moved = Math.hypot(rep.sim.pos.x - 0.4, rep.sim.pos.z);
  const alone = new Mech(0, -8, 0, sv), s0 = new Solids();
  for (let f = 0; f < 300; f++) { alone.step(s0, { x: 0, z: 1, sprint: false }); s0.tick(dt); }
  console.log(`walk through your replica: you at z ${a.sim.pos.z.toFixed(2)} (alone ${alone.sim.pos.z.toFixed(2)}), replica nudged ${moved.toFixed(2)} m`);
  must(a.sim.pos.z > alone.sim.pos.z - 0.3, "your replica blocked you");
  must(moved > 0.5, "your replica wasn't nudged aside");
  must(legsOk(rep), "replica legs broke from the nudge");

  const s2 = new Solids();
  const foe = new Mech(0, -8, 0, sv), rep2 = new Mech(0, 0, Math.PI, { ...sv, bodyRadius: 1.2 });
  foe.team = 3; rep2.soft = true;
  let worst = 0;
  for (let f = 0; f < 300; f++) { foe.step(s2, { x: 0, z: 1, sprint: false }); rep2.step(s2, { x: 0, z: 0, sprint: false }); s2.tick(dt); if (f > 200) worst = Math.max(worst, depth(foe, rep2)); }
  console.log(`enemy mech into a replica: worst overlap ${worst.toFixed(3)} m`);
  must(worst < 0.2, "an enemy mech walked through a replica");
}

console.log(fails ? `solids-check: ${fails} failed` : "solids-check: ok");
process.exit(fails ? 1 : 0);
