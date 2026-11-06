// Headless check of the striders in the expedition (src/expedition/striderCamps.ts) against a stand-in for the robot
// camps: a sleeping camp of 20 brings one strider that stands still; shooting it wakes the camp; awake, it walks; the
// camp's robots all gone, it fights on while the mech is near, then streams out past the give-up range and comes back
// with the same count; small camps bring none, big ones the most, packs and raids their own share; off, none.
// Run: npm test (or npx tsx tools/stridercamps-check.ts).
import * as THREE from "three/webgpu";
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { StriderCamps, STRIDER_CAMP_DEFAULTS } from "../src/expedition/striderCamps";
import { SWARM_CAMP_DEFAULTS, type SwarmCamps } from "../src/expedition/swarmCamps";
import type { Battlefield } from "../src/game/battlefield";
import type { MechUnit } from "../src/game/mechUnit";
import type { Prey } from "../src/pilot/quarry";

let failed = false;
const fail = (m: string) => { console.log(`FAIL: ${m}`); failed = true; };
const field = new DuneField({ ...TERRAIN_DEFAULTS });
// Anything the effects reach for: a no-op that answers every call and property.
const any: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : any), apply: () => any });
const bf = { targets: [], register: { add() {} }, canSee: () => true, gunFx: any, sfx: any, dust: any, blast() {}, resolveSheet: () => any, fire: () => 0 } as unknown as Battlefield;
const camps = new Map<string, { x: number; z: number; n: number; awake: boolean; roam: boolean }>();
let woke = 0;
const swarms = {
  eachLive(fn: (id: string, x: number, z: number, n: number, awake: boolean, roam: boolean, r: number) => void) { for (const [id, c] of camps) fn(id, c.x, c.z, c.n, c.awake, c.roam, 12); },
  wake(id: string) { woke++; const c = camps.get(id); if (c) c.awake = true; },
} as unknown as SwarmCamps;
const v = { ...STRIDER_CAMP_DEFAULTS, ...SWARM_CAMP_DEFAULTS };
const at = new THREE.Vector3(0, field.height(0, 0) + 3, 0);
const mechUnit = { sim: { pos: at }, shoveFrom() {} } as unknown as MechUnit;
const sc = new StriderCamps(v, bf, new THREE.Scene(), field, mechUnit, swarms);
const mech = { x: 0, z: 0 };
const prey = { kind: "mech", alive: true, at, radius: 2.5, unit: { damage() {} }, sim: { pelvis: at, pos: at, vel: new THREE.Vector3() } } as unknown as Prey;
const step = (s: number, hunting = true) => { for (let k = 0; k < s * 60; k++) sc.update(1 / 60, hunting, mech, prey); };
const list = () => sc.sf.pack.list;

camps.set("c1", { x: 120, z: 0, n: 32, awake: false, roam: false });
step(1);
if (sc.count !== 1) fail(`a camp of 32 brought ${sc.count} striders (want 1)`);
const s0 = list()[0], p0 = s0?.pos().clone();
step(2);
if (s0 && (!s0.frozen || s0.pos().distanceTo(p0!) > 0.01)) fail("a sleeping camp's strider moved");
// Shoot it: the camp wakes.
if (s0) sc.sf.pack.hit(s0, 50);
step(0.1);
if (!woke) fail("shooting a sleeping strider didn't wake its camp");
step(8);
if (s0 && (s0.frozen || s0.pos().distanceTo(p0!) < 5)) fail(`awake: frozen ${s0.frozen}, moved ${s0.pos().distanceTo(p0!).toFixed(1)} m`);
// The convoy's turrets can see it (awake, in range); a sleeping one is not a threat.
{ const pts: THREE.Vector3[] = []; sc.threats(0, 0, 400, pts); if (pts.length !== sc.count) fail(`turret threats ${pts.length}, striders ${sc.count}`); }
// The camp's robots all gone: it fights on near the mech.
camps.delete("c1");
step(1);
const before = sc.count;
if (!before) fail("the strider left with its camp while the mech was near");
// The mech walks far off: it streams out, remembered.
mech.x = -2000; at.set(-2000, 3, 0);
step(0.5);
if (sc.count) fail(`${sc.count} still on the field 2 km away`);
mech.x = 0; at.set(0, field.height(0, 0) + 3, 0);
camps.set("c1", { x: 120, z: 0, n: 0, awake: false, roam: false });
step(0.5);
if (sc.count !== before) fail(`came back with ${sc.count}, left with ${before}`);
// Sizes: a camp of 10 none, 70 the most (1), a raid of 48 one.
const n0 = sc.count;
camps.set("small", { x: 0, z: 200, n: 10, awake: false, roam: false });
camps.set("big", { x: 0, z: -200, n: 70, awake: false, roam: false });
camps.set("raid", { x: -150, z: 40, n: 48, awake: true, roam: true });
step(0.2);
const added = sc.count - n0;
if (added !== 2) fail(`camps of 10 and 70 and a raid of 48 brought ${added} (want 0 + 1 + 1)`);
console.log(`strider camps: camp of 32 → ${before}, small/big/raid → ${added}, woke ${woke}`);
// Off: they go and none come.
v.stridersOn = 0;
step(0.2);
if (sc.count) fail(`${sc.count} striders on the field with them off`);
if (failed) process.exit(1);
console.log("stridercamps-check: ok");
