// Headless check of the humanoid squads in the expedition (src/expedition/droidCamps.ts) against a stand-in for the
// robot camps: a sleeping camp of 20 brings a frozen squad of 4 split into variants; shooting one wakes the camp; awake,
// they fire at the mech; the camp's robots all gone, the squad fights on while the mech is near, then streams out past
// the give-up range and comes back with the same count; packs bring their own share.
// Run: npm test (or npx tsx tools/droidcamps-check.ts).
import * as THREE from "three/webgpu";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { DROID_ALL_DEFAULTS } from "../src/combat/droids";
import { DroidCamps, DROID_CAMP_DEFAULTS } from "../src/expedition/droidCamps";
import { SWARM_CAMP_DEFAULTS, type SwarmCamps } from "../src/expedition/swarmCamps";
import type { Battlefield } from "../src/game/battlefield";
import type { Prey } from "../src/pilot/quarry";

let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const field = new DuneField({ ...TERRAIN_DEFAULTS });
let fired = 0;
const bf = {
  targets: [], register: { add() {} }, canSee: () => true, fire: () => { fired++; return 0; }, sfx: { play() {} },
} as unknown as Battlefield;
const camps = new Map<string, { x: number; z: number; n: number; awake: boolean; roam: boolean }>();
let woke = 0;
const swarms = {
  eachLive(fn: (id: string, x: number, z: number, n: number, awake: boolean, roam: boolean, r: number) => void) { for (const [id, c] of camps) fn(id, c.x, c.z, c.n, c.awake, c.roam, 12); },
  wake(id: string) { woke++; const c = camps.get(id); if (c) c.awake = true; },
} as unknown as SwarmCamps;
// Humanoids are off by default (Keith 2026-11-01); the rules are checked at the shares they had.
const v = { ...DROID_ALL_DEFAULTS, ...DROID_CAMP_DEFAULTS, droidCampShare: 0.2, droidPackShare: 0.25, ...SWARM_CAMP_DEFAULTS };
const dc = new DroidCamps(v, bf, new THREE.Scene(), field, null, swarms);
const mech = { x: 0, z: 0 };
const at = new THREE.Vector3(0, 3, 0);
const prey = { kind: "mech", alive: true, at, radius: 2.5, unit: { damage() {} }, sim: { pelvis: at, pos: at, vel: new THREE.Vector3() } } as unknown as Prey;
const step = (s: number, hunting = true) => { for (let k = 0; k < s * 60; k++) dc.update(1 / 60, hunting, mech, prey); };
const frozen = () => { let n = 0, all = 0; for (const f of dc.squads.fights) for (let i = 0; i < f.sw.hi; i++) if (f.sw.state[i] < 4) { all++; if (f.sw.frozen[i]) n++; } return { n, all }; };

camps.set("c1", { x: 60, z: 0, n: 20, awake: false, roam: false });
step(1);
const per = dc.squads.fights.map((f) => f.count);
if (dc.count !== 4) fail(`a camp of 20 brought ${dc.count} humanoids (want 4)`);
if (frozen().n !== dc.count) fail(`asleep: ${frozen().n} of ${dc.count} frozen`);
step(2);
if (fired) fail(`${fired} pulses from a sleeping squad`);
// Shoot one: the camp wakes.
const f0 = dc.squads.fights.find((f) => f.count > 0)!;
for (let i = 0; i < f0.sw.hi; i++) if (f0.sw.state[i] < 4) { f0.sw.damage(i, 5, 1, 0); break; }
step(0.1);
if (!woke) fail("shooting a sleeping humanoid didn't wake its camp");
step(15);
if (frozen().n) fail(`awake: ${frozen().n} still frozen`);
if (!fired) fail("an awake squad never fired");
// The camp's robots all gone: the squad fights on near the mech.
camps.delete("c1");
step(1);
const before = dc.count;
if (!before) fail("the squad left with its camp while the mech was near");
// The mech walks far off: the squad streams out, remembered.
mech.x = -2000; at.set(-2000, 3, 0);
step(1);
if (dc.count) fail(`${dc.count} still on the field 2 km away`);
mech.x = 0; at.set(0, 3, 0);
camps.set("c1", { x: 60, z: 0, n: 0, awake: false, roam: false });
step(0.5);
if (dc.count !== before) fail(`came back with ${dc.count}, left with ${before}`);
// A raid of 26 brings its share.
camps.set("raid1", { x: -80, z: 40, n: 26, awake: true, roam: true });
step(0.5);
const raid = dc.count - before;
if (raid !== Math.min(v.droidCampMax, Math.round(26 * v.droidPackShare))) fail(`a raid of 26 brought ${raid}`);
console.log(`droid camps: camp squad split ${per.join("/")} (trooper/lancer/brute), raid ${raid}, pulses ${fired}`);
if (failed) process.exit(1);
console.log("droidcamps-check: ok");
