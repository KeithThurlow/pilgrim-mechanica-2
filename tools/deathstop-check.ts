// Nothing keeps running after its owner is gone (Keith 2026-10-31: "if you destroy an enemy mech while it's firing, or
// if you die while firing your minigun, it gets stuck: the audio never stops"). Headless, on the real code with
// stand-ins where it needs the browser:
// - Gun loops (src/audio/minigunAudio.ts) are per mech: one mech's death or silence stops only its own loops; a mech that
//   just stops updating is released after VOICE_TTL; two mechs don't share loops.
// - The sound player's watchdog (src/audio/loopWatch.ts): a loop nobody refreshes is handed back to be stopped after
//   its ttl, one refreshed every frame never is.
// - Weapons cold (Arsenal.stop, run when a mech dies, gets out, or a round starts over): with both triggers and the
//   shoulder keys held, a rail charge, an arm pod channel, a painted shoulder shot, a feed's overdrive and the lasers all
//   drop at once and fire nothing; a dead owner stepped with everything "held" stays cold and fires nothing; rockets
//   already in the air keep flying.
// - MechUnit calls it on death, reset (a duel round starting over) and getting out; gun streams clear.
// Run: npm test (or npx tsx tools/deathstop-check.ts).
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { newMag, magStep, type Mag } from "../src/weapons/magazine";
import { LoopWatch } from "../src/audio/loopWatch";
import { MinigunAudio, VOICE_TTL, type GunSfx } from "../src/audio/minigunAudio";
import { GunStreams } from "../src/fx/gunStreams";
import type { Resolved } from "../src/items/loadout";
import type { Gun } from "../src/mech/upper";

globalThis.fetch = (async () => ({ ok: false })) as never;
console.warn = () => {};
const { Arsenal } = await import("../src/weapons/arsenal");

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };

// ---- The watchdog ----
{
  const w = new LoopWatch<string>(0.3);
  w.touch("orphan", 0); w.touch("kept", 0);
  let swept: string[] = [];
  for (let t = 0.05; t < 1; t += 0.05) { w.touch("kept", t); swept = swept.concat(w.sweep(t)); }
  must(swept.join() === "orphan", `watchdog swept ${swept.join() || "nothing"} (want the orphan only)`);
  must(w.size === 1, `watchdog still tracks ${w.size}`);
  w.drop("kept");
  must(w.size === 0, "watchdog kept a loop that was stopped on purpose");
  console.log("watchdog: orphan swept after its ttl, a refreshed loop kept");
}

// ---- Gun loops by owner ----
{
  const live = new Set<object>();
  let started = 0, stopped = 0;
  const sfx = {
    running: true, v: { growlDetune: 1.7 }, ctx: { currentTime: 0 },
    play: () => {}, setLoop: () => {},
    startLoop: () => { const l = {}; live.add(l); started++; return l; },
    stopLoop: (l: object) => { if (live.delete(l)) stopped++; },
  };
  const au = new MinigunAudio(sfx as unknown as GunSfx);
  const guns = [{ side: 1, spin: 1, firing: true, spinUpTime: 1 }, { side: -1, spin: 1, firing: true, spinUpTime: 1 }] as unknown as Gun[];
  const mz = [new THREE.Vector3(), new THREE.Vector3()];
  const A = {}, B = {};
  const DT = 1 / 60;
  for (let i = 0; i < 30; i++) { au.update(A, DT, true, guns, mz); au.update(B, DT, true, guns, mz); au.tick(DT); }
  must(live.size === 4 && au.liveLoops === 4, `two mechs, two guns each: ${live.size} loops (want 4, none shared)`);
  // A dies mid-fire: its loops go at once; B's stay.
  au.release(A);
  must(live.size === 2, `after A died ${live.size} loops live (want B's 2)`);
  for (let i = 0; i < 30; i++) { au.update(B, DT, true, guns, mz); au.tick(DT); }
  must(live.size === 2, "B's loops were disturbed by A's death");
  // B just stops being updated (hopped out, removed, a lab that tore down): released after VOICE_TTL.
  let t = 0;
  while (live.size && t < 1) { au.tick(DT); t += DT; }
  must(live.size === 0 && au.liveLoops === 0, `B left silent still had ${live.size} loops after 1 s`);
  must(t <= VOICE_TTL + 2 * DT, `B released after ${t.toFixed(2)} s (want about ${VOICE_TTL})`);
  au.release(A); au.release(B);
  must(started === 4 && stopped === 4, `started ${started}, stopped ${stopped} (want 4 and 4, once each)`);
  console.log(`gun loops: per mech, A's death stopped only A's, a silent B released after ${t.toFixed(2)} s`);
}

// ---- Weapons cold ----
const DT = 1 / 120;
const V = { ...WEAPON_DEFAULTS, laserDay: 1, laserNight: 1 };
function rig() {
  const fires: string[] = [];
  const noop = () => {};
  const bf = {
    field: { height: () => 0 }, targets: [], wrecks: null, nightLights: null, v: {}, sunDir: { y: 1 },
    sfx: { addSound: noop, playSound: noop, play: noop },
    dust: { smoke: noop }, waves: null, blast: noop,
    makeSheet: (m: THREE.Vector3, d: THREE.Vector3) => ({ ox: m.x, oz: m.z, dx: d.x, dz: d.z }),
    resolveSheet: () => ({ result: { end: 40 } }),
  };
  const gun = () => ({ enabled: true, mag: newMag(1, 1), rateMul: 1, spinCut: 0, ammoMul: 1, stats: null, firing: false });
  const unit = {
    team: 1, alive: true, gunsOff: false, cursor: new THREE.Vector3(0, 0, 30) as THREE.Vector3 | null, lock: null, keys: [true, true, false],
    sim: { pelvis: new THREE.Vector3(0, 3, 0), pos: new THREE.Vector3(), inDash: false }, dash: { refillMul: 1, refillNow: noop },
    body: { barrel: (_s: number, o: THREE.Vector3) => o.set(0, 0, 1), muzzle: (_s: number, o: THREE.Vector3) => o.set(1, 3.5, 1) },
    upper: { guns: [gun(), gun()] },
  };
  const a = new Arsenal(bf as never, unit as never, V, {} as never, () => []);
  a.onFire = (k) => { fires.push(k); };
  a.configure({
    guns: { left: { cls: "rpg", light: true, own: null }, right: { cls: "rail", light: false, own: null } },
    shoulders: [
      { key: 1, mount: "shoulderL", weapon: "missiles", family: "launcher", own: null },
      { key: 2, mount: "shoulderR", weapon: "beltfeed", family: "feed", own: null },
    ],
  } as unknown as Resolved);
  const mag = unit.upper.guns[0].mag as Mag;
  const run = (sec: number, trig: [boolean, boolean]) => {
    for (let i = 0; i < Math.round(sec / DT); i++) { magStep(mag, DT); a.step(DT, null, trig as never); }
  };
  return { a, unit, run, fires };
}
type Ars = InstanceType<typeof Arsenal>;
// (The faint targeting laser is on for any live mech by design: it only counts once the owner is dead.)
const hot = (a: Ars, dead = false) => {
  const out: string[] = [];
  const r = a.sides[1], l = a.sides[0];
  if (r.rail.holding || r.rail.charge > 0) out.push("rail charge");
  if (r.aimLine.length || r.meterAt) out.push("rail aim line/meter");
  if (l.channel) out.push("pod channel");
  if (a.moveMul() < 1) out.push("walk slowed");
  if (dead && a.sides.some((s) => s.laser.on)) out.push("gun laser");
  if (a.sides.some((s) => s.paint.on)) out.push("gun paint");
  for (const sh of a.shoulders) {
    if (sh.paint.on || sh.held || sh.strip) out.push(`shoulder ${sh.key} paint`);
    if (dead && sh.laser.on) out.push(`shoulder ${sh.key} laser`);
    if (sh.gear && sh.gear.left > 0) out.push(`shoulder ${sh.key} gear effect`);
  }
  return out;
};
for (const how of ["dies", "stop() called", "owner stepped dead, held"] as const) {
  const { a, unit, run, fires } = rig();
  run(0.6, [true, true]);
  const rail = a.sides[1];
  const before = hot(a);
  must(rail.rail.charge > 0 && rail.aimLine.length > 0, `${how}: the held rail built no charge and aim line`);
  for (const want of ["rail charge", "pod channel", "shoulder 1 paint", "shoulder 2 gear effect"]) must(before.includes(want), `${how}: ${want} wasn't live to begin with (${before.join(", ")})`);
  const nFire = fires.length;
  if (how === "dies") { unit.alive = false; a.stop(); }
  else if (how === "stop() called") a.stop();
  else unit.alive = false;
  // Dead, the triggers and keys stay down; for a stop with the owner alive (getting out, a round starting over) they are let go
  // (still held, a live mech would simply start charging again).
  const alive = how === "stop() called";
  if (alive) unit.keys = [false, false, false];
  run(0.5, alive ? [false, false] : [true, true]);
  const left = hot(a, !unit.alive);
  must(left.length === 0, `${how}: still live 0.5 s later: ${left.join(", ")}`);
  const extra = fires.slice(nFire);
  must(extra.length === 0, `${how}: fired ${extra.join(", ")} after the owner was gone`);
  console.log(`weapons ${how}: ${before.length} things live (${before.join(", ")}), ${left.length} after 0.5 s, ${extra.length} shots after`);
}
{
  // Rockets already in the air keep flying after the owner is gone (the stop is of the owner, not of its fire).
  const { a, unit, run } = rig();
  const r = a.rockets.fire(1, { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 60 }, { speed: 30, damage: 1, blast: 1 } as never);
  unit.alive = false; a.stop();
  run(0.5, [false, false]);
  must(r.pos.z > 10, `a rocket in the air stopped with its owner (z ${r.pos.z.toFixed(1)})`);
}

// ---- Gun streams and the unit's hooks ----
{
  const s = new GunStreams();
  for (let i = 0; i < 6; i++) s.round(0, 3, 0, 0, 1, 30, 10, 1);
  must(s.n > 0, "no stream was made");
  s.clear();
  must(s.n === 0, "gun streams survived clear()");
  const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): { readFileSync(p: URL, e: string): string } } }).process.getBuiltinModule("node:fs");
  const src = fs.readFileSync(new URL("../src/game/mechUnit.ts", import.meta.url), "utf8");
  must(/private destroy\(\) \{[\s\S]{0,200}this\.goCold\(\)/.test(src), "MechUnit.destroy doesn't go cold");
  must(/reset\(x: number[\s\S]{0,300}this\.goCold\(\)/.test(src), "MechUnit.reset (a round starting over) doesn't go cold");
  must(/wasPiloted && !this\.piloted\) this\.goCold\(\)/.test(src), "MechUnit doesn't go cold when the pilot gets out");
  must(/goCold\(\) \{[\s\S]{0,200}gunAudio\.release\(this\)/.test(src), "goCold doesn't release the gun loops");
  must(/if \(!this\.alive\) \{[^}]*weapons\?\.step\(dt, null, false\)/.test(src), "a dead MechUnit doesn't keep stepping its weapons cold");
}

if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("deathstop check failed"); }
console.log("deathstop check passed");
