// Sounds lab (Keith 2026-11-02): the recorded Pixabay sounds (src/audio/samples.ts) cut into game sounds behind
// sliders, with the procedural sounds as the fallback. A button per sound plays it beside the mech; with "Compare" on,
// the procedural sound plays first and the recording after it. Every combat lab has the same Sound samples topic, so
// fire the real guns there (weapons lab ?left=sniper and so on) once a sound is cut.
// Flags: ?play=<sample id> (play it once on the first click; e.g. Sniper, RobotDeath), plus the combat-lab flags (?manual, ?left=, ...).
import "../../src/core/lab.css";
import * as THREE from "three/webgpu";
import type { Param } from "../../src/core/tweaks";
import { combatLab } from "../../src/game/combatLab";
import { SAMPLES, SAMPLE_TOPIC, type SampleDef } from "../../src/audio/samples";
import { sampleBankOf, type SampleBank } from "../../src/audio/sampleBank";
import { playBlast } from "../../src/weapons/weaponSound";

const LAB_DEFAULTS = { sndCompare: 0, sndGap: 0.6, sndDistance: 15 };
const LAB_PARAMS: Param[] = [
  { key: "sndCompare", label: "Compare: procedural first", min: 0, max: 1, step: 1, group: "Sounds lab", tip: "1: a button plays the procedural sound, then the recording" },
  { key: "sndGap", label: "Compare gap (s)", min: 0.1, max: 3, step: 0.05, group: "Sounds lab" },
  { key: "sndDistance", label: "Played this far ahead (m)", min: 0, max: 60, step: 1, group: "Sounds lab", tip: "Sounds pan by where they are on screen" },
];

let loaded = 0;
const BLASTS = [{ r: 2.2, what: "swarm missile" }, { r: 4.5, what: "RPG" }, { r: 14, what: "big mortar" }];
const lab = await combatLab({
  id: "sounds-lab",
  title: "Sounds",
  defaults: LAB_DEFAULTS,
  params: LAB_PARAMS,
  topics: [{ ...SAMPLE_TOPIC, groups: ["Sounds lab", ...SAMPLE_TOPIC.groups] }],
  demo: () => ({ cmd: { x: 0, z: 0, sprint: false }, aim: null, trigger: false }),
  actions: [
    ...SAMPLES.filter((d) => !d.sound.startsWith("blast")).map((d) => ({ label: `▶ ${d.label.replace(/ \(.*/, "")}`, onClick: (): void => play(d) })),
    ...BLASTS.map((b) => ({ label: `▶ Blast ${b.r} m (${b.what})`, onClick: (): void => blast(b.r) })),
  ],
  report: (): Record<string, unknown> => ({ samplesLoaded: loaded }),
});
const { V, bf, player } = lab;
function bank(): SampleBank | undefined { return sampleBankOf(bf.sfx); }
const vals = V as unknown as Record<string, number>;
const at = new THREE.Vector3();
function spot() {
  const p = player.sim.pos, h = player.sim.heading ?? 0;
  return at.set(p.x + Math.sin(h) * V.sndDistance, p.y + 1, p.z + Math.cos(h) * V.sndDistance);
}
const later = (s: number, f: () => void) => setTimeout(f, s * 1000);

function play(d: SampleDef): void {
  const go = (): void => bf.sfx.playSound(d.sound, spot(), 1);
  if (!V.sndCompare) return go();
  const proc = bf.sfx.procedural(d.sound);
  if (proc?.length) bf.sfx.playData(proc[Math.floor(Math.random() * proc.length)], spot(), bf.sfx.soundLevel(d.sound));
  later((proc?.[0]?.length ?? 0) / bf.sfx.rate + V.sndGap, go);
}

function blast(r: number): void {
  const go = (): void => playBlast(bf.sfx, spot(), r, V);
  if (!V.sndCompare) return go();
  const keep = vals.sampleBlastFrom;
  vals.sampleBlastFrom = 1e9; playBlast(bf.sfx, spot(), r, V); vals.sampleBlastFrom = keep;
  later(1.5 + V.sndGap, go);
}

const first = new URLSearchParams(location.search).get("play");
if (first) addEventListener("pointerdown", () => { const d = SAMPLES.find((s) => s.id.toLowerCase() === first.toLowerCase()); if (d) later(0.1, () => play(d)); }, { once: true });

lab.onFrame(() => {
  const b = bank();
  loaded = b?.loaded ?? 0;
  lab.hud("sounds", `recordings ${b?.loaded ?? 0}/${SAMPLES.length} loaded${b?.failed ? ` · ${b.failed} failed (procedural)` : ""}${bf.sfx.running ? "" : " · click to start sound"}`);
});
