// The battlefield's rules apart from its looks (src/game/combatRules.ts; docs/architecture-review.md stage 3).
// 1. Pure of drawing: every module it loads at run time (type-only imports aside) is outside src/fx, src/audio,
//    src/look and src/ui, and is no *Draw or *Body file, so a host worker or a server can run it alone.
// 2. Blasts: damage reaches targets of other teams in reach and spares its own team and those out of reach; each blast
//    writes one plain-data event (low or an air burst; JSON round trip equal); air bursts queue no crater.
// 3. Shells: a lobbed shell writes a lob event, then bursts where it lands (a blast event, damage) after its flight;
//    shots resolve in the rules' tick, leaving their draws for the view; a freeze is a plain event.
// 4. Craters dig by count per tick (dentPerTick), never by time, and the same blasts give the same ground twice.
// Run: npm test (or npx tsx tools/combatrules-check.ts).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import * as THREE from "three/webgpu";
import { CombatRules } from "../src/game/combatRules";
import type { Hittable, SplashOpts } from "../src/game/battlefield";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { BIOME_DEFAULTS } from "../src/world/biomes";
import { ROCK_DEFAULTS } from "../src/world/rock";
import { SHALLOWS_DEFAULTS } from "../src/world/shallows";
import { CraterLayer, CRATER_DEFAULTS } from "../src/world/craters";

const problems: string[] = [];
const fail = (s: string) => { console.log("  FAIL " + s); problems.push(s); };

// 1. The run-time import graph.
{
  const root = resolve("src/game/combatRules.ts");
  const seen = new Set<string>(), bad: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(resolve("src"), file).replace(/\\/g, "/");
    if (/^(fx|audio|look|ui)\//.test(rel) || /(Draw|Body)\.ts$/.test(rel)) bad.push(rel);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^import\s+(type\s+)?[^"']*from\s+["'](\.[^"']+)["']/gm)) {
      if (m[1]) continue;
      const clause = m[0];
      // `import { type A, type B } from` is type-only too.
      const names = clause.match(/\{([^}]*)\}/)?.[1];
      if (names && !/^import\s+\*/.test(clause) && names.split(",").every((n) => n.trim() === "" || n.trim().startsWith("type "))) continue;
      const base = resolve(dirname(file), m[2]);
      const f = [base + ".ts", base + "/index.ts", base].find((x) => existsSync(x) && x.endsWith(".ts"));
      if (f) walk(f);
    }
  };
  walk(root);
  if (bad.length) fail(`combatRules loads drawing or sound at run time: ${bad.join(", ")}`);
  console.log(`  ${seen.size} modules loaded at run time, none of them drawing or sound${bad.length ? " (but see above)" : ""}`);
}

const V = { ...TERRAIN_DEFAULTS, ...BIOME_DEFAULTS, ...ROCK_DEFAULTS, ...SHALLOWS_DEFAULTS, ...CRATER_DEFAULTS, dentPerTick: 2 };
const field = new DuneField(V);

// A ball target: takes a blast's share by distance (full at the centre, half at the edge).
function ball(team: number, x: number, z: number, up = 1): Hittable & { taken: number; at: THREE.Vector3 } {
  const at = new THREE.Vector3(x, field.height(x, z) + up, z);
  const t = {
    team, alive: true, surface: "steel" as const, taken: 0, at,
    hitRay: () => -1,
    damage: (n: number) => { t.taken += n; },
    splash: (p: THREE.Vector3, r: number, dmg: number, _d: THREE.Vector3, o?: SplashOpts) => {
      const d = p.distanceTo(at);
      if (d > r || o?.cover?.(at.x, at.y, at.z)) return 0;
      t.taken += dmg * (1 - 0.5 * d / r);
      return 1;
    },
  };
  return t as unknown as Hittable & { taken: number; at: THREE.Vector3 };
}

function rules(): CombatRules {
  const r = new CombatRules(field, V);
  const craters = new CraterLayer(V, field);
  field.dents = craters;
  r.craters = craters;
  return r;
}

// 2. Blasts.
{
  const r = rules();
  const foe = ball(1, 3, 0), friend = ball(0, 2, 0), far = ball(1, 40, 0);
  r.targets.push(foe, friend, far);
  const p = new THREE.Vector3(0, field.height(0, 0) + 0.2, 0);
  const ev = r.blast(0, p, 6, 100, 0.5, "mortar");
  if (!(foe.taken > 50 && foe.taken <= 100)) fail(`foe took ${foe.taken}`);
  if (friend.taken !== 0) fail(`own team took ${friend.taken}`);
  if (far.taken !== 0) fail(`out of reach took ${far.taken}`);
  if (r.events.length !== 1 || r.events[0] !== ev || !ev.low || ev.wet) fail(`blast event ${JSON.stringify(r.events)}`);
  if (JSON.stringify(JSON.parse(JSON.stringify(ev))) !== JSON.stringify(ev)) fail("blast event isn't plain data");
  if (r.dentQueue.length !== 1) fail(`low blast queued ${r.dentQueue.length} craters`);
  const air = r.blast(0, new THREE.Vector3(30, field.height(30, 0) + 20, 0), 4, 50);
  if (air.low || r.dentQueue.length !== 1) fail("an air burst dug the ground");
  console.log(`  blast: foe ${foe.taken.toFixed(1)}, own team ${friend.taken}, far ${far.taken}; events ${r.events.length}`);
}

// 3. Shells.
{
  const r = rules();
  const foe = ball(1, 20, 5);
  r.targets.push(foe);
  const from = new THREE.Vector3(0, field.height(0, 0) + 3, 0), to = new THREE.Vector3(20, field.height(20, 5), 5);
  r.lob(2, from, to, 1.5, 6, 4, 80);
  if (r.events[0]?.type !== "lob") fail("lob wrote no event");
  let t = 0, burst = -1;
  while (t < 4) { r.step(1 / 60); t += 1 / 60; if (burst < 0 && r.events.some((e) => e.type === "blast")) burst = t; }
  if (burst < 1.3 || burst > 1.8) fail(`shell burst after ${burst.toFixed(2)} s (flight 1.5)`);
  if (foe.taken <= 0) fail("the shell's burst did no damage");
  console.log(`  shell: burst after ${burst.toFixed(2)} s, foe took ${foe.taken.toFixed(1)}`);
}

// 3b. Shots resolve in the rules' tick (their draws left for the view); a freeze is a plain event.
{
  const r = rules();
  const y = field.height(0, 0) + 3;
  r.shots.fire({ team: 0, origin: new THREE.Vector3(0, y, 0), dir: new THREE.Vector3(0, -0.3, 1).normalize(), range: 60, damage: 10 }, { slot: 0 });
  r.step(1 / 60);
  if (r.shots.draws.length !== 1 || r.shots.draws[0].surface !== "sand") fail(`a round into the sand: ${r.shots.draws.length} draws (${r.shots.draws[0]?.surface})`);
  r.chills.onFreeze?.({ x: 1, y: 2, z: 3 } as never);
  const fz = r.events.find((e) => e.type === "freeze");
  if (!fz || JSON.stringify(fz) !== '{"type":"freeze","x":1,"y":2,"z":3}') fail(`freeze event ${JSON.stringify(fz)}`);
  console.log(`  shots: ${r.shots.draws.length} draw after the rules' tick; freeze event ${fz ? "written" : "missing"}`);
}

// 4. Craters by count, the same twice.
function dig(): { perTick: number[]; hash: number } {
  const r = rules();
  for (let i = 0; i < 9; i++) r.blast(0, new THREE.Vector3(i * 12, field.height(i * 12, 30), 30), 4, 0);
  const perTick: number[] = [];
  for (let k = 0; k < 8; k++) { r.step(1 / 60); perTick.push(r.dentStats.frameDents); }
  let hash = 0;
  for (let x = -6; x < 110; x += 0.7) for (let z = 24; z < 36; z += 0.7) hash = (hash * 31 + Math.round(field.height(x, z) * 1e5)) | 0;
  return { perTick, hash };
}
{
  const a = dig(), b = dig();
  if (a.perTick.join() !== "2,2,2,2,1,0,0,0") fail(`dug per tick ${a.perTick} (dentPerTick 2, 9 blasts)`);
  if (a.hash !== b.hash) fail("the same blasts gave different ground");
  console.log(`  craters per tick ${a.perTick.join(",")}; same ground twice: ${a.hash === b.hash}`);
}

if (problems.length) { console.log(`combatrules: ${problems.length} problem(s)`); process.exit(1); }
console.log("combatrules: ok");
