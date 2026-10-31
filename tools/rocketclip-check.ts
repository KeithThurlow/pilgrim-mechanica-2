// Clip-fed rockets and the arm missile pod's channel (Keith 2026-10-31), on the real Arsenal with a stand-in battlefield
// and mech: held, the hull launcher's clip ripples out at the ripple gap and the next rocket waits the whole reload; the
// clip's look follows (all tubes dark when empty, the clip drops, is gone, rises full) with one clank out and one clunk
// in per swap; a part-used clip is swapped after rocketTopUp off the trigger; the arm missile pod fires only while held,
// one missile per ripple gap, stops at the end of its clip, slows the walk only while channelling, and its missiles
// come down on the enemy under the cursor.
//   npx tsx tools/rocketclip-check.ts
import * as THREE from "three";
import { WEAPON_DEFAULTS } from "../src/weapons/tuning";
import { newMag, magStep, type Mag } from "../src/weapons/magazine";
import { clipPose } from "../src/weapons/clip";
import type { Resolved } from "../src/items/loadout";

// No model files headless: the library falls back to its code stand-ins quietly.
globalThis.fetch = (async () => ({ ok: false })) as never;
console.warn = () => {};
const { Arsenal } = await import("../src/weapons/arsenal");

const problems: string[] = [];
const must = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };
const DT = 1 / 120;
const V = { ...WEAPON_DEFAULTS, laserDay: 0, laserNight: 0 };

function rig(light: boolean) {
  const sounds: string[] = [], blasts: THREE.Vector3[] = [], fires: number[] = [];
  let t = 0;
  const noop = () => {};
  const bf = {
    field: { height: () => 0 }, targets: [], wrecks: null, nightLights: null, v: {}, sunDir: { y: 1 },
    sfx: { addSound: noop, playSound: (name: string) => { sounds.push(name); }, play: noop },
    dust: { smoke: noop }, waves: null,
    blast: (_team: number, at: THREE.Vector3) => { blasts.push(at.clone()); },
  };
  const gun = () => ({ enabled: true, mag: newMag(1, 1), rateMul: 1, spinCut: 0, ammoMul: 1, stats: null });
  const unit = {
    team: 1, alive: true, gunsOff: false, cursor: new THREE.Vector3(0, 0, 30) as THREE.Vector3 | null, lock: null, keys: [false, false, false],
    sim: { pelvis: new THREE.Vector3(0, 3, 0), pos: new THREE.Vector3() }, dash: { refillMul: 1 },
    body: { barrel: (_s: number, o: THREE.Vector3) => o.set(0, 0, 1), muzzle: (_s: number, o: THREE.Vector3) => o.set(1, 3.5, 1) },
    upper: { guns: [gun(), gun()] },
  };
  const enemy = { x: 3, y: 1.5, z: 32, r: 1, key: "bot" };
  const a = new Arsenal(bf as never, unit as never, V, {} as never, () => [enemy]);
  a.onFire = () => { fires.push(t); };
  const r = { guns: { left: { cls: "rpg", light, own: null }, right: null }, shoulders: [] } as unknown as Resolved;
  a.configure(r);
  const mag = unit.upper.guns[0].mag as Mag;
  const run = (sec: number, held: boolean, each?: () => void) => {
    for (let i = 0; i < Math.round(sec / DT); i++) {
      t += DT;
      magStep(mag, DT); // the upper sim steps the gun's magazine
      a.step(DT, null, [held, false] as never);
      each?.();
    }
  };
  return { a, mag, run, sounds, blasts, fires, enemy, time: () => t };
}

// ---- Hull rocket launcher: the clip ripples, then a full reload you can see and hear ----
{
  const { a, mag, run, sounds, fires } = rig(false);
  run(0.1, false);
  must(mag.size === V.rpgMag && mag.left === V.rpgMag, `hull clip isn't ${V.rpgMag} full (${mag.left}/${mag.size})`);
  const poses: string[] = [];
  run(V.rpgReload + V.rpgMag * V.rpgCooldown + 1, true, () => {
    const c = clipPose(mag, 4), k = c.shown ? (c.drop > 0.5 ? "low" : c.loaded === 0 ? "empty" : "in") : "gone";
    if (poses[poses.length - 1] !== k) poses.push(k);
  });
  const gaps = fires.slice(1).map((f, i) => f - fires[i]);
  const ripple = gaps.slice(0, V.rpgMag - 1);
  must(fires.length >= V.rpgMag + 1, `hull: ${fires.length} rockets in a clip and a reload (want ${V.rpgMag + 1})`);
  must(ripple.every((g) => Math.abs(g - V.rpgCooldown) < 2 * DT), `hull ripple gaps ${ripple.map((g) => g.toFixed(3)).join(", ")} s (want ${V.rpgCooldown})`);
  const reloadGap = gaps[V.rpgMag - 1] ?? 0;
  must(Math.abs(reloadGap - V.rpgReload) < 2 * DT, `hull: next clip after ${reloadGap.toFixed(2)} s (want the reload, ${V.rpgReload})`);
  must(poses.join(">").startsWith("in>empty>low>gone>low>in"), `hull clip's look over a swap: ${poses.join(">")}`);
  must(sounds.filter((s) => s.startsWith("clip")).slice(0, 2).join(",") === "clipOut,clipIn" && sounds.filter((s) => s === "clipIn").length === 1, `hull swap sounds: ${sounds.filter((s) => s.startsWith("clip")).join(", ")}`);
  console.log(`hull launcher: ripple ${ripple.map((g) => g.toFixed(2)).join("/")} s, next clip ${reloadGap.toFixed(2)} s, look ${poses.join(">")}`);
  // A part-used clip: two rockets, let go; swapped after rocketTopUp + the reload.
  run(V.rpgMag * V.rpgCooldown + V.rpgReload + 1, false);
  const n0 = fires.length;
  run(V.rpgCooldown + DT * 2, true);
  run(0.5, false);
  must(fires.length - n0 === 2 && mag.left === mag.size - 2, `top-up: fired ${fires.length - n0}, ${mag.left} left`);
  run(V.rocketTopUp + V.rpgReload, false);
  must(mag.left === mag.size, `a part-used clip wasn't swapped after ${V.rocketTopUp} s idle (${mag.left}/${mag.size})`);
  must(a.moveMul() === 1, "the hull launcher slowed the walk");
}

// ---- Arm missile pod: channels while held, a missile per ripple gap, stops at the clip's end ----
{
  const { a, mag, run, fires, blasts, enemy } = rig(true);
  run(0.1, false);
  must(mag.size === V.podMag, `arm pod clip ${mag.size} (want ${V.podMag})`);
  let slowed = 0, frames = 0;
  run(1, true, () => { frames++; if (a.moveMul() < 1) slowed++; });
  const held1 = fires.length;
  const want = 1 / V.podCooldown;
  must(held1 >= Math.floor(want) && held1 <= Math.floor(want) + 1, `arm pod: ${held1} missiles in 1 s held (ripple ${V.podCooldown})`);
  must(slowed === frames && Math.abs(a.moveMul() - (1 - V.podSlow)) < 1e-9, `arm pod: walk slowed ${slowed}/${frames} frames held`);
  run(1, false);
  must(fires.length === held1, `arm pod fired ${fires.length - held1} missiles with the button up`);
  must(a.moveMul() === 1, "arm pod still slowing the walk after the release");
  // Hold through the rest of the clip and into the reload: it stops at the clip's end.
  let slowReloading = 0;
  run(V.podMag * V.podCooldown + 1, true, () => { if (mag.reloading > 0 && a.moveMul() < 1) slowReloading++; });
  must(fires.length === V.podMag, `arm pod: ${fires.length} missiles out of a clip of ${V.podMag}`);
  must(mag.reloading > 0, "arm pod didn't reload at the end of its clip");
  must(slowReloading === 0, "arm pod slowed the walk while reloading");
  run(3, false);
  const near = blasts.filter((b) => Math.hypot(b.x - enemy.x, b.z - enemy.z) < 1.5).length;
  must(blasts.length === V.podMag && near === blasts.length, `arm pod: ${near}/${blasts.length} missiles came down on the enemy under the cursor`);
  console.log(`arm missile pod: ${held1} in 1 s held, 0 released, ${fires.length} per clip, ${near}/${blasts.length} on the enemy, walk ×${(1 - V.podSlow).toFixed(2)} channelling`);
}

if (problems.length) { console.log("FAIL\n  " + problems.join("\n  ")); throw new Error("rocket clip check failed"); }
console.log("rocket clip check passed");
