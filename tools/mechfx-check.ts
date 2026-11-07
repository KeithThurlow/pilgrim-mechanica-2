// Stage 7c (docs/proposal-stage7.md): a mech's looks and sounds (src/game/mechFx.ts) never change its game. The same
// scripted mech as tools/mechfx-probe.ts (walk, sprint, dash, a drop landing, wading, firing, hits, death, a reset) runs
// with its looks on (MechFxView on a recording battlefield) and off (fx = null); every rules call it makes (rounds
// fired, stomps, landings, dash shoves, sprint steps) and its sim state every tick must be the same, bit for bit, and
// the looks must have been played (prints, dust, sounds, splashes, the gun loop). Run: npm test (or npx tsx
// tools/mechfx-check.ts).
import * as THREE from "three";
import { Battlefield } from "../src/game/battlefield";
import { MechUnit, MECH_DEFAULTS, type MechBody, type MechUnitValues } from "../src/game/mechUnit";
import { WALKER_DEFAULTS } from "../src/mech/walkerTuning";
import { LEG_TYPES } from "../src/mech/legTypes";
import { UPPER_DEFAULTS } from "../src/mech/upper";
import { DUST_DEFAULTS } from "../src/fx/dust";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";

function run(fxOn: boolean) {
  let h = 2166136261 >>> 0, calls = 0, looks = 0;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; };
  const show = (x: unknown): unknown => {
    if (x instanceof THREE.Vector3) return [x.x, x.y, x.z];
    if (typeof x === "function") return "fn";
    if (x && typeof x === "object") {
      if (x instanceof MechUnit) return "unit";
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x)) o[k] = show((x as Record<string, unknown>)[k]);
      return o;
    }
    return x;
  };
  // Rules calls go into the hash; looks are only counted.
  const rec = (path: string, ret: (...a: unknown[]) => unknown = () => undefined, noArgs = false) => (...a: unknown[]) => {
    if (noArgs) a = []; // the walker and torso sims: their state is hashed each tick (and they hold the ground's caches)
    feed(path + JSON.stringify(a.map(show))); calls++;
    return ret(...a);
  };
  const look = (_path: string, ret: (...a: unknown[]) => unknown = () => undefined) => (...a: unknown[]) => { looks++; return ret(...a); };
  const group = (name: string, methods: Record<string, ((...a: unknown[]) => unknown) | undefined>) => {
    const o: Record<string, unknown> = {};
    for (const m in methods) o[m] = look(`${name}.${m}`, methods[m]);
    return o;
  };

  const field = new DuneField({ ...TERRAIN_DEFAULTS });
  const v = { ...WALKER_DEFAULTS, ...LEG_TYPES.rampart.values, ...UPPER_DEFAULTS, ...DUST_DEFAULTS, ...MECH_DEFAULTS } as unknown as MechUnitValues;
  // Water in a strip: the wading and splashing paths.
  const wet = (x: number, z: number) => z > 60 && z < 80 && x > -50;
  const bf = {
    field, v, sinkSurface: null,
    inWater: (x: number, z: number) => wet(x, z),
    water: group("water", { splash: undefined, wake: (_x, _z, _m, acc) => (acc as number) + 0.37 }),
    dust: group("dust", { stomp: undefined, kick: undefined, slide: (_x, _y, _z, _a, _b, _dt, acc) => (acc as number) + 0.21, smoke: undefined }),
    marks: group("marks", { print: undefined, furrow: undefined, skid: undefined, dig: undefined }),
    sfx: group("sfx", { play: undefined, playSound: undefined }),
    gunAudio: group("gunAudio", { update: undefined, release: undefined }),
    nightLights: { streams: group("streams", { clear: undefined }) },
    fire: rec("fire"),
    sinkDepth(x: number, z: number) { return Battlefield.prototype.sinkDepth.call(this as unknown as Battlefield, x, z); },
  } as unknown as Battlefield;
  const at = (o: THREE.Vector3) => o.set(mech.sim.pelvis.x, mech.sim.pelvis.y + 1.5, mech.sim.pelvis.z);
  const body = {
    root: new THREE.Object3D(), armed: true, update: rec("body.update", undefined, true), paint: look("body.paint"), aimSensor: rec("body.aimSensor", undefined, true),
    footprint: () => null, printScale: () => 1,
    shoulderLine: (o = new THREE.Vector3()) => at(o), muzzle: (_s: number, o = new THREE.Vector3()) => at(o),
    barrel: (_s: number, o = new THREE.Vector3()) => o.set(0, 0, 1), eject: (_s: number, o = new THREE.Vector3()) => o.set(1, 2, 3),
  } as unknown as MechBody;
  const mech: MechUnit = new MechUnit(bf, v, body, {} as never, 2, 0, true);
  if (!fxOn) mech.fx = null;
  mech.onStomp = rec("onStomp");
  mech.onLanding = rec("onLanding");
  mech.onSprintStep = rec("onSprintStep");
  mech.onDash = rec("onDash");
  mech.reset(0, 0, 0);

  const state = () => {
    const s = mech.sim;
    return [s.pos.x, s.pos.z, s.pelvis.y, s.heading, s.vel.x, s.vel.z, mech.health, mech.alive ? 1 : 0, mech.upper.torsoYaw, mech.dash.active ? 1 : 0, mech.reactor.energy ?? 0,
      ...s.feet.flatMap((f) => [f.pos.x, f.pos.y, f.pos.z])].join(",");
  };
  const hit = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0);
  const dt = 1 / 60;
  for (let f = 0; f < 2400; f++) {
    const t = f * dt;
    // Walk ahead, sprint (Space held after a dash) through the water, a side dash, then a drop from 6 m.
    mech.dashHold = f >= 300 && f < 700;
    if (f === 300) mech.tryDash(0, 1);
    if (f === 900) mech.tryDash(1, 0);
    if (f === 1200) { const s = mech.sim; s.pelvis.y += 6; for (const ft of s.feet) ft.pos.y += 6; s.launch(0, 0, 3); }
    const fire = f % 200 < 120;
    mech.step(dt, { x: 0.2 * Math.sin(t * 0.5), z: 1, sprint: false }, { x: mech.sim.pos.x + 15 * Math.sin(t), y: 1, z: mech.sim.pos.z + 25 }, [fire, f % 300 < 100]);
    if (f % 97 === 0) mech.damage(40, hit, dir);
    if (f === 1700) mech.damage(1e6, hit, dir);
    if (f === 1900) mech.reset(0, 200, 1);
    feed(state());
  }
  return { h, calls, looks };
}

const on = run(true), off = run(false);
console.log(`  looks on: ${on.calls} rules calls, ${on.looks} looks played, hash ${on.h.toString(16)}; looks off: ${off.calls} rules calls, ${off.looks} looks, hash ${off.h.toString(16)}`);
const problems: string[] = [];
if (on.h !== off.h || on.calls !== off.calls) problems.push("the mech played a different game with its looks off");
if (on.looks < 500) problems.push(`only ${on.looks} looks played with fx on`);
if (off.looks !== 0) problems.push(`${off.looks} looks played with fx off`);
for (const p of problems) console.log("  FAIL " + p);
if (problems.length) { console.log(`mechfx-check: ${problems.length} problem(s)`); process.exit(1); }
console.log("mechfx-check: ok");
