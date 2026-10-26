// Shots as data (src/game/shots.ts): things that must never happen.
// - A round damages the first body on its line once, and says so in one hit event.
// - Split fans its rounds; fire rate's copies wait their turn; the same seed gives the same shot, exactly.
// - A ricochet never starts in or flies into the ground; generations stop at protoMaxGen (nothing loops).
// - A chain hops to different bodies, never one it already hit, and only within its reach.
// - A sheet round goes through bodies in a line while its penetration lasts (through the register's culling).
// - Damage applied equals the damage in the hit events.
// Run: npm test (or npx tsx tools/shots-check.ts).
import * as THREE from "three/webgpu";
import { Shots, SHOT_DEFAULTS, type ShotEvent } from "../src/game/shots";
import { Register, KIND, FLAG } from "../src/game/register";
import { listOwner } from "../src/game/registerOwners";
import { PEN_DEFAULTS } from "../src/game/sheet";
import type { Hittable } from "../src/game/battlefield";

const problems: string[] = [];
const flat = { height: () => 0, normal: (_x: number, _z: number, out: number[] = [0, 1, 0]) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; } };

class Ball implements Hittable {
  team = 2; alive = true; surface = "flesh" as const; material = "flesh" as const;
  taken = 0; hits = 0;
  constructor(public x: number, public y: number, public z: number, public r = 0.6) {}
  hitRay(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const ox = o.x - this.x, oy = o.y - this.y, oz = o.z - this.z;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - this.r * this.r;
    const h = b * b - c;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t >= 0 && t <= maxDist ? t : -1;
  }
  damage(a: number) { this.taken += a; this.hits++; if (this.taken >= 1e9) this.alive = false; }
}

function world(balls: Ball[], v = { ...PEN_DEFAULTS, ...SHOT_DEFAULTS }) {
  const register = new Register();
  register.add(listOwner("balls", () => balls, (reg, b, i, serial) =>
    reg.put(i, serial, KIND.Unit, b.team, FLAG.Hittable | FLAG.Detectable, b.x, b.y, b.z, b.r, 0, 0, 0, b.r)));
  register.rebuild();
  return new Shots({ field: flat as never, targets: balls, wrecks: null, register, v });
}
const look = { slot: 0 };
const fire = (s: Shots, dx: number, dz: number, extra: object = {}, y = 1, dy = 0) =>
  s.fire({ team: 1, origin: { x: 0, y, z: 0 }, dir: { x: dx, y: dy, z: dz }, range: 60, damage: 10, ...extra }, look);
const evs = (s: Shots) => s.events.map((e: ShotEvent) => ({ ...e }));
const dealt = (s: Shots) => s.events.filter((e) => e.kind === "hit").reduce((a, e) => a + e.damage, 0);

// ---- One round, one body ----
{
  const balls = [new Ball(0, 1, 10), new Ball(0, 1, 14)];
  const s = world(balls);
  fire(s, 0, 1);
  s.step(1 / 30);
  const hits = s.events.filter((e) => e.kind === "hit");
  if (hits.length !== 1 || hits[0].target !== 0) problems.push(`a round made ${hits.length} hits (want 1 on the near ball)`);
  if (balls[0].taken !== 10 || balls[1].taken !== 0) problems.push(`damage ${balls[0].taken}/${balls[1].taken} (want 10/0)`);
  if (Math.abs(s.draws[0]?.to.z - 9.4) > 0.05) problems.push(`the tracer ends at z ${s.draws[0]?.to.z.toFixed(2)} (want 9.4)`);
}

// ---- Split: three rounds fanned, three balls ----
{
  const fan = (SHOT_DEFAULTS.protoFan * Math.PI) / 180, R = 12;
  const balls = [-1, 0, 1].map((k) => new Ball(Math.sin(k * fan) * R, 1, Math.cos(k * fan) * R, 0.4));
  const s = world(balls);
  fire(s, 0, 1, { proto: { split: 3 } });
  s.step(1 / 30);
  if (balls.some((b) => b.hits !== 1)) problems.push(`split 3: hits per ball ${balls.map((b) => b.hits).join("/")} (want 1/1/1)`);
  if (s.draws.filter((d) => d.first).length !== 1) problems.push("split: more than one round flashed");
}

// ---- Rate: the copy waits its gap ----
{
  const balls = [new Ball(0, 1, 10)];
  const s = world(balls);
  fire(s, 0, 1, { proto: { rate: 2 }, interval: 0.1 });
  s.step(1 / 120);
  const first = balls[0].hits;
  for (let i = 0; i < 10; i++) s.step(1 / 120);
  if (first !== 1 || balls[0].hits !== 2) problems.push(`rate 2: ${first} then ${balls[0].hits} hits (want 1 then 2)`);
}

// ---- Same seed, same shot ----
{
  const run = () => { const balls = [new Ball(2, 1, 10), new Ball(-3, 1, 14), new Ball(4, 1, 18)]; const s = world(balls);
    fire(s, 0.05, 1, { seed: 1234, proto: { split: 3, rate: 2, ricochet: 2, chain: 3 }, interval: 0 }); s.step(1 / 30); return JSON.stringify(evs(s)); };
  if (run() !== run()) problems.push("the same seed gave different events");
}

// ---- Ricochet: off the sand, up, never under it; generations capped ----
{
  const s = world([]);
  fire(s, 0, 1, { proto: { ricochet: 8 } }, 2, -0.2);
  s.step(1 / 30);
  const rics = s.events.filter((e) => e.kind === "ricochet").length;
  if (rics !== SHOT_DEFAULTS.protoMaxGen) problems.push(`ricochet 8 bounced ${rics} times (protoMaxGen ${SHOT_DEFAULTS.protoMaxGen})`);
  for (const d of s.draws) {
    if (d.from.y < -1e-3) problems.push(`a round started under the ground (y ${d.from.y.toFixed(2)})`);
  }
  if (s.draws.slice(1).some((d) => d.dir.y <= 0)) problems.push("a ricochet off flat sand flew down");
}

// ---- Chain: hops to different balls within reach ----
{
  const balls = [0, 1, 2, 3, 4].map((k) => new Ball(k * 5, 1, 10, 0.5));
  balls.push(new Ball(80, 1, 10, 0.5)); // out of reach
  const s = world(balls);
  fire(s, 0, 1, { proto: { chain: 3 } });
  s.step(1 / 30);
  const hit = balls.map((b) => b.hits);
  if (hit.slice(0, 4).some((h) => h !== 1) || hit[4] !== 0 || hit[5] !== 0) problems.push(`chain 3: hits ${hit.join("/")} (want 1/1/1/1/0/0)`);
  if (s.events.filter((e) => e.kind === "chain").length !== 3) problems.push("chain 3 didn't make 3 hops");
  const total = balls.reduce((a, b) => a + b.taken, 0);
  if (Math.abs(total - dealt(s)) > 1e-6) problems.push(`damage applied ${total} but the events say ${dealt(s)}`);
}

// ---- A sheet round through two bandits in a line ----
{
  const balls = [new Ball(0, 1, 10, 0.5), new Ball(0, 1, 14, 0.5)];
  const s = world(balls);
  fire(s, 0, 1, { sheet: { half: 0.4, height: 3, pen: 2, aim: { x: 0, y: 1, z: 14 } } }, 3);
  s.step(1 / 30);
  if (balls[0].hits !== 1 || balls[1].hits !== 1) problems.push(`sheet with 2 m penetration: hits ${balls[0].hits}/${balls[1].hits} (want 1/1)`);
  const total = balls.reduce((a, b) => a + b.taken, 0);
  if (Math.abs(total - dealt(s)) > 1e-6) problems.push(`sheet: damage applied ${total.toFixed(2)} but the events say ${dealt(s).toFixed(2)}`);
}

console.log(`shots: ${problems.length ? problems.length + " problems" : "split, rate, seed, ricochet, chain and sheet as expected"}`);
if (problems.length) { console.log("FAIL " + problems.join("; ")); throw new Error("shots check failed"); }
console.log("shots check passed");
