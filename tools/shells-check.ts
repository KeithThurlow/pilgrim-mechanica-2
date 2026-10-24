// Telegraphed shells: a shell lands exactly where it was aimed, after exactly its flight time, peaking at its arc,
// and lands once; several fly at once. Run: npm test (or npx tsx tools/shells-check.ts).
import * as THREE from "three";
import { Shells } from "../src/game/shells";

const problems: string[] = [];
const sh = new Shells();
const from = new THREE.Vector3(0, 3, 0), to = new THREE.Vector3(30, 0, 10);
sh.lob(2, from, to, 2, 6, 3, 30);
sh.lob(2, from, new THREE.Vector3(-20, 1, 5), 1.2, 3, 2, 10);
const landed: { t: number; x: number; z: number }[] = [];
let t = 0, peak = -Infinity;
const dt = 1 / 120;
while (t < 3) {
  t += dt;
  sh.update(dt, (s) => landed.push({ t, x: s.pos.x, z: s.pos.z }));
  const s0 = sh.list[0];
  if (s0.live) peak = Math.max(peak, s0.pos.y - (from.y + (to.y - from.y) * Math.min(1, s0.t / s0.flight)));
}
if (landed.length !== 2) problems.push(`${landed.length} landings (expected 2)`);
const a = landed.find((l) => Math.abs(l.x - 30) < 1e-3 && Math.abs(l.z - 10) < 1e-3);
if (!a) problems.push("the first shell didn't land on its mark");
else if (Math.abs(a.t - 2) > dt * 1.5) problems.push(`landed after ${a.t.toFixed(3)} s (flight 2 s)`);
if (Math.abs(peak - 6) > 0.05) problems.push(`arc peaked ${peak.toFixed(2)} m over the line (asked 6)`);
if (sh.liveCount !== 0) problems.push("a shell still flying after landing");
console.log(`shells: landed ${landed.map((l) => `(${l.x.toFixed(1)}, ${l.z.toFixed(1)}) at ${l.t.toFixed(2)} s`).join(", ")} · arc ${peak.toFixed(2)} m`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("shells check failed"); }
console.log("shells check passed");
