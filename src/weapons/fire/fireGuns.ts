// A mech's flamers on its battlefield (Keith 2026-11-05): the arsenal hands each side that holds a flamer its shots,
// muzzles and aim; this keeps the stream's reach (the jets' damage reaches only as far as the fuel has flown since the
// trigger went down; src/game/mechUnit.ts fires them), the roar while it pours, the pilot flame at the igniter, the
// gobs drawn into the battlefield's flames (src/fx/flameFx.ts: dark fuel from the fuel nozzle, caught by the igniter's
// flame flameIgnite s out, burning on along it), and the small burning splash where the stream meets the sand
// (src/game/firePools.ts, host: placed from the shot's aim, not from the cosmetic gobs).
// Ownership: host (the splash pools' damage) from the owner's commands; reach, sound and gobs are the owner's / cosmetic.
import * as THREE from "three/webgpu";
import type { Battlefield } from "../../game/battlefield";
import type { MechUnit } from "../../game/mechUnit";
import type { WeaponValues } from "../tuning";
import { isColdGun, type FlameGun } from "../guns";
import type { Loop } from "../../audio/sfx";
import { Synth, rng } from "../../audio/synth";
import { lobVy } from "../../fx/flameFx";

interface FSide { kind: FlameGun | null; reach: number; idle: number; splashT: number; loop: Loop | null; pilotT: number; from: THREE.Vector3; dir: THREE.Vector3; range: number; press: number;
  /** The line's throw from the last shot (vx, vy, vz, burn s, width), poured every frame from the live muzzle. */
  pv: number[] | null }

/** After this long with no jet the stream has stopped: the next one starts from the nozzle again. */
const STOPPED = 0.2;

export class FireGuns {
  readonly sides: [FSide, FSide];

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues) {
    const side = (): FSide => ({ kind: null, reach: 0, idle: 9, splashT: 0, loop: null, pilotT: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), range: 0, press: 0, pv: null });
    this.sides = [side(), side()];
    addFireSounds(bf, v);
  }

  configure(i: number, kind: FlameGun | null) {
    const s = this.sides[i];
    this.quiet(s);
    s.kind = kind; s.reach = 0; s.idle = 9;
  }

  /** How far side i's stream has flown (m): its jets reach no further. */
  reach(i: number) { const s = this.sides[i]; return s.kind ? s.reach : Infinity; }

  /** Each frame: the stream grows while it pours and stops when it doesn't; the pilot flame burns at the igniter. */
  step(i: number, dt: number, igniter: THREE.Vector3 | null, alive: boolean, fuel: THREE.Vector3 | null = null) {
    const s = this.sides[i], v = this.v;
    if (!s.kind) return;
    s.idle += dt; s.splashT -= dt;
    if (s.idle > STOPPED || !alive) s.reach = 0;
    else s.reach += v.flameSpeed * dt;
    if (igniter && alive) {
      s.pilotT -= dt;
      // A freeze ray's lower nozzle vents a little cold mist instead of a pilot flame.
      if (s.pilotT <= 0) {
        s.pilotT = isColdGun(s.kind) ? 0.12 : 0.05;
        if (isColdGun(s.kind)) this.bf.flames.mist(igniter.x, igniter.y, igniter.z, s.kind === "cryo" ? 0.7 : 0.5);
        else this.bf.flames.pilot(igniter.x, igniter.y, igniter.z, s.kind === "inferno" ? 1.5 : 1);
      }
    }
    const pouring = s.idle < 0.12 && alive;
    // Pressure builds while it pours (Keith 2026-11-05: "as it builds pressure it arcs out further"; Flame stream ›
    // Pressure builds over); it's gone the moment it stops.
    s.press = pouring ? Math.min(1, s.press + dt / Math.max(0.05, v.flamePressTime)) : 0;
    if (pouring) {
      const cold = isColdGun(s.kind), snd = cold ? "cryoHiss" : "flameRoar", big = s.kind === "inferno" || s.kind === "cryo";
      if (!s.loop) { s.loop = this.bf.sfx.startSoundLoop(snd, Math.random()); if (!cold) this.bf.sfx.playSound("flameIgnite", igniter ?? this.unit.sim.pelvis, 0.8, big ? 0.8 : 1); }
      if (s.loop) this.bf.sfx.setSoundLoop(s.loop, snd, igniter ?? this.unit.sim.pelvis, big ? 1 : 0.75, big ? 0.85 : 1.05);
      // The stream lights what's round it (Keith 2026-11-05): a light at the middle of the stream and one at its tip,
      // orange for fire, pale blue for a freeze ray (Flame stream › Stream light).
      const L = this.bf.lights, P = v.flameLight * (big ? 1.4 : 1) * (cold ? 0.45 : 1) * (0.85 + 0.3 * Math.random());
      const len = Math.min(s.range, s.reach);
      // The thin emissive cone out of the nozzle (Keith 2026-11-05; src/fx/flameBlobs.ts), on the live muzzle.
      if (fuel) s.from.copy(fuel);
      // The line pours every frame from the live muzzle, not only on the gun's shots (a few a second).
      if (s.pv) this.bf.flames.pour(s, s.from.x, s.from.y, s.from.z, s.pv[0], s.pv[1], s.pv[2], s.pv[3], s.pv[4], cold);
      if (v.flameCone > 0) this.bf.flames.cone(s.from, s.dir, len * v.flameCone, v.flameConeWidth * (big ? 1.4 : 1), cold, v.flameConeCut);
      // (Fire: the lights now hang in among the fireballs themselves, src/fx/flameFx.ts: a light every so many; these
      // two on the aim line ran out ahead of the arcing balls, Keith 2026-11-05. The freeze rays keep them.)
      if (L && P > 0 && len > 1 && cold) {
        const col = cold ? 0x9fd8ff : 0xff8a35;
        for (const t of [0.45, 0.95]) L.hold(s.from.x + s.dir.x * len * t, s.from.y + s.dir.y * len * t + 0.5, s.from.z + s.dir.z * len * t, P * (t > 0.5 ? 1 : 0.7), 6 + len * 0.35, col, 1.1, 1.5 + len * 0.08);
      }
    } else this.quiet(s);
  }

  /** A jet left side i's fuel nozzle along `dir` (its pellets, cone and range): gobs for the look, the splash on the sand. */
  shot(i: number, fuel: THREE.Vector3, dir: THREE.Vector3, range: number, spread: number, pellets: number, aim: { x: number; y: number; z: number } | null,
    burn: { time: number; dps: number }) {
    const s = this.sides[i], v = this.v, bf = this.bf;
    if (!s.kind) return;
    s.idle = 0;
    s.from.copy(fuel); s.dir.copy(dir); s.range = range;
    const big = s.kind === "inferno" || s.kind === "cryo" ? 1.35 : 1, cold = isColdGun(s.kind);
    const n = Math.round(v.flameGobs * Math.max(1, pellets));
    const sp = (spread * Math.PI) / 180;
    // The muzzle's own drift (the mech walking) carries into the stream.
    const mv = this.unit.sim.vel;
    // Burning fuel thrown under gravity (Keith 2026-11-05, the rebuild): each gob is aimed to come down on the aim (on
    // the sand, or the stream's end along the barrel with no aim), out to Flame look › Lobs out to × the reach; it
    // burns for about the time it takes to fly the reach (Burns for), so aimed further it burns out in the air and
    // rises instead of landing. The damage is the gun's rays, as before.
    const G = v.flameGravity, vh0 = v.flameSpeed * v.flameGobFast;
    const tx = aim ? aim.x : fuel.x + dir.x * range, tz = aim ? aim.z : fuel.z + dir.z * range;
    const ty = aim ? aim.y : bf.field.height(tx, tz);
    let hx = tx - fuel.x, hz = tz - fuel.z;
    const hd = Math.hypot(hx, hz) || 1;
    hx /= hd; hz /= hd;
    const dist = Math.min(Math.max(hd, 2), range * v.flameLob);
    const burnT = range / vh0 * v.flameBurnFor;
    const startAt = cold ? 0 : Math.min(range, s.reach) * v.flameCone * v.flameConeCut * v.flameStartAt;
    // The line (Keith 2026-11-05, the flame tank reference: one continuous line, not bits): fuel thrown from the nozzle to
    // come down on the aim, but only as far as the pressure carries it yet, slower and shorter at first.
    {
      const p = 1 - (1 - s.press) * (1 - s.press), k = v.flamePressMin + (1 - v.flamePressMin) * p;
      const vh = vh0 * (0.5 + 0.5 * k), vy = lobVy(ty - fuel.y, dist * k, vh, G);
      s.pv = [hx * vh + (mv?.x ?? 0), vy, hz * vh + (mv?.z ?? 0), burnT, big];
      bf.flames.pour(s, fuel.x, fuel.y, fuel.z, s.pv[0], s.pv[1], s.pv[2], burnT, big, cold);
    }
    for (let k = 0; k < n; k++) {
      // The look's spread is a share of the gun's (Flame look › Look spread; the damage's cone is the gun's).
      const sa = (Math.random() - 0.5) * 2 * sp * v.flameLookSpread, ca = Math.cos(sa), sn = Math.sin(sa);
      const dx = hx * ca - hz * sn, dz = hx * sn + hz * ca;
      const vh = vh0 * (0.93 + Math.random() * 0.14);
      // Up enough to come down on the aim, at most a 35° lob; a little scatter up and down.
      const vy = lobVy(ty - fuel.y, dist, vh, G) + (Math.random() - 0.5) * vh * Math.tan(sp * v.flameLookSpread);
      // Out of the end of the nozzle's flame, not the muzzle (Flame look › Fireballs start along the cone).
      const t0 = Math.random() * (1 / 60) + startAt / vh;
      bf.flames.gob(fuel.x + dx * vh * t0, fuel.y + vy * t0 - 0.5 * G * t0 * t0, fuel.z + dz * vh * t0,
        dx * vh + (mv?.x ?? 0), vy - G * t0, dz * vh + (mv?.z ?? 0),
        burnT * (0.85 + Math.random() * 0.3), v.flameSize * big * (0.8 + Math.random() * 0.4),
        startAt > 0.3 ? 0 : v.flameIgnite * (0.7 + Math.random() * 0.6), cold);
    }
    if (cold) return; // no burning splash from a freeze ray
    // Where the stream meets the sand (the aim on the ground, if the stream reaches it): a small short pool.
    if (v.flameSplash > 0 && aim && s.splashT <= 0) {
      const g = bf.field.height(aim.x, aim.z), dist = Math.hypot(aim.x - fuel.x, aim.z - fuel.z);
      if (aim.y - g < 1.6 && dist <= Math.min(range, s.reach + 1)) {
        s.splashT = 0.15;
        bf.pools.add(this.unit.team, aim.x, aim.z, v.splashPool * v.flameSplash * big, v.splashPoolTime, v.splashPoolDps, burn.time, burn.dps, false);
      }
    }
  }

  stop() { for (const s of this.sides) { this.quiet(s); s.reach = 0; s.idle = 9; } }

  private quiet(s: FSide) { if (s.loop) { this.bf.sfx.stopLoop(s.loop); s.loop = null; } }
}

/** Fire's sounds, generated: the flamers' roar (a loop of low rushing noise and crackle), the igniter's whoomp as the
 *  stream catches, napalm canisters bursting into flame. Level: Flame stream › Sound level. */
const added = new WeakSet<object>();
export function addFireSounds(bf: Pick<Battlefield, "sfx">, v: WeaponValues) {
  const sfx = bf.sfx;
  if (added.has(sfx)) return;
  added.add(sfx);
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 137 + i)));
  sfx.addSound("flameRoar", variants(1, 91, (r) => S.mix(S.band(r, 1.5, 40, 650, 0.6, 0.02, 0), S.band(r, 1.5, 300, 2200, 0.2, 0.02, 0), steadyCrackle(S.n(1.5), r, 0.3), S.whine(1.5, 55, 55, 0.08))), () => v.flameLevel);
  sfx.addSound("flameIgnite", variants(2, 92, (r) => S.mix(S.thump(0.4, 140, 45, 0.7), S.lowPass(S.noise(r, 0.5, 900, 0.5, 0.01), 800), S.scale(S.crackle(r, 0.4, 0.3), 1))), () => v.flameLevel);
  // The freeze rays: a high pressurised hiss with a faint crystalline ring (Chill and freezing › Freeze ray sound).
  sfx.addSound("cryoHiss", variants(1, 94, (r) => S.mix(S.band(r, 1.5, 1800, 7000, 0.35, 0.02, 0), S.band(r, 1.5, 200, 900, 0.15, 0.02, 0), S.whine(1.5, 1320, 1320, 0.03))), () => v.freezeLevel);
  // Freezing solid: a glassy crack, a crunch of ice and a short high ring.
  sfx.addSound("freezeCrack", variants(3, 95, (r) => S.mix(S.tick(r, 0.02, 1), S.scale(S.crackle(r, 0.35, 0.5), 1), S.band(r, 0.3, 2500, 9000, 0.3, 0.003, -10), S.whine(0.6, 2100, 1900, 0.06))), () => v.freezeLevel);
  sfx.addSound("napalmBurst", variants(3, 93, (r) => S.mix(S.thump(0.5, 110, 38, 0.8), S.lowPass(S.noise(r, 1.1, 650, 0.6, 0.005), 600), S.scale(S.crackle(r, 1.0, 0.45), 1), S.band(r, 0.8, 250, 1400, 0.25, 0.01, -6))), () => v.flameLevel);
}

/** Crackle that doesn't fade (for a loop): sparse pops, each ringing down fast. */
function steadyCrackle(n: number, r: () => number, gain: number) {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (r() < 0.0012) s[i] = (r() * 2 - 1) * gain;
    else if (i > 0) s[i] = s[i - 1] * 0.85;
  }
  return s;
}
