// The breach cannon's shell bursts where it strikes (Keith 2026-11-02: "piercing objects and then exploding afterwards").
// On the real Arsenal with a stand-in battlefield: a shell fired at a body (a thin one it could tear through, and a fat
// one) must burst at the body's near face, never behind it, and the body takes the direct hit once. A shell at open
// sand bursts on the sand.
//   npx tsx tools/breach-check.ts
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { newMag } from "../src/weapons/magazine";
import { resolveSheet } from "../src/game/sheetFire";
import { sheetCircle, PEN_DEFAULTS, type Sheet, type SheetHit } from "../src/game/sheet";
import type { Resolved } from "../src/items/loadout";

globalThis.fetch = (async () => ({ ok: false })) as never;
console.warn = () => {};
const { Arsenal } = await import("../src/weapons/arsenal");

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const DT = 1 / 120;
const V = { ...WEAPON_DEFAULTS, laserDay: 0, laserNight: 0, cannonSpread: 0, cannonGravity: 0 };
const out: string[] = [];

function shoot(radius: number | null, v = V) {
  const blasts: THREE.Vector3[] = [], hits: number[] = [];
  const noop = () => {};
  const field = { height: () => 0 };
  // A round body standing 30 m ahead on the line of fire.
  const body = {
    team: 2, alive: true, surface: "metal" as const, x: 0, z: 30, r: radius ?? 0,
    hitRay: () => -1, damage: (d: number) => { hits.push(d); },
    sheet(s: Sheet, o: SheetHit<unknown>[]) {
      const c = sheetCircle(s, this.x, this.z, this.r);
      if (c) o.push({ target: this, key: 0, along: c.along, chord: c.chord, material: "scrapper", x: this.x, y: 1.5, z: this.z });
    },
  };
  const targets = radius === null ? [] : [body];
  const bf = {
    field, targets, wrecks: null, nightLights: null, v: {}, sunDir: { y: 1 },
    sfx: { addSound: noop, playSound: noop, play: noop },
    dust: { smoke: noop, hit: noop }, waves: null, gunFx: { sparksAt: noop }, marks: { crater: noop }, water: null, inWater: () => false,
    blast: (_team: number, at: THREE.Vector3) => { blasts.push(at.clone()); },
    resolveSheet: (team: number, s: Sheet, damage: number, f: never, dir: THREE.Vector3, apply = true, skip?: never) =>
      resolveSheet(field, targets as never, null, team, s, damage, f, dir, { ...PEN_DEFAULTS } as never, apply, skip),
  };
  const gun = () => ({ enabled: true, mag: newMag(6, 1), rateMul: 1, spinCut: 0, ammoMul: 1, stats: null });
  const unit = {
    team: 1, alive: true, gunsOff: false, cursor: new THREE.Vector3(0, radius === null ? -1 : 1.5, 30) as THREE.Vector3 | null, lock: null, keys: [false, false, false],
    sim: { pelvis: new THREE.Vector3(0, 3, 0), pos: new THREE.Vector3(), inDash: false }, dash: { refillMul: 1 }, reactor: { refillMul: 1 },
    body: { barrel: (_s: number, o: THREE.Vector3) => o.set(0, 0, 1), muzzle: (_s: number, o: THREE.Vector3) => o.set(0, 1.5, 1) },
    upper: { guns: [gun(), gun()], sizeMag: noop },
  };
  const a = new Arsenal(bf as never, unit as never, v, {} as never, () => []);
  a.configure({ guns: { left: { cls: "cannon", light: false, own: null }, right: null }, shoulders: [] } as unknown as Resolved);
  a.shot(1);
  for (let i = 0; i < 360 && !blasts.length; i++) a.step(DT, null, [false, false] as never);
  return { blasts, hits };
}

for (const r of [0.4, 1.2, 3]) {
  const { blasts, hits } = shoot(r);
  const at = blasts[0];
  must(blasts.length === 1, `r ${r}: ${blasts.length} blasts (want 1)`);
  if (!at) continue;
  const face = 30 - r;
  // Within a step's travel (cannonSpeed / 120 Hz) of the near face, never past the body's centre.
  must(at.z >= face - 0.2 && at.z <= face + V.cannonSpeed * DT + 0.2 && at.z < 30, `r ${r}: burst at z ${at.z.toFixed(2)} (near face ${face.toFixed(2)}, centre 30)`);
  must(hits.length === 1 && Math.abs(hits[0] - V.cannonDamage) < 1e-6, `r ${r}: the body took ${hits.join(", ") || "nothing"} (want one direct hit of ${V.cannonDamage})`);
  out.push(`r ${r}: burst ${at.z.toFixed(2)} (face ${face.toFixed(2)})`);
}
{
  // With its drop, a shell at open sand (the cursor 30 m out) comes down on it.
  const { blasts } = shoot(null, { ...V, cannonGravity: WEAPON_DEFAULTS.cannonGravity, cannonDamage: 0, cannonBlast: 4 });
  must(blasts.length === 1 && Math.abs(blasts[0].y) < 0.6, `open sand: ${blasts.length} blasts at y ${blasts[0]?.y.toFixed(2)}`);
  out.push(`sand: burst at ${blasts[0]?.z.toFixed(1)} m`);
}

console.log("breach: " + out.join(" · "));
if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); process.exit(1); }
console.log("breach check passed");
