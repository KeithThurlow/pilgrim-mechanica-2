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
import type { FlameGun } from "../guns";
import type { Loop } from "../../audio/sfx";
import { Synth, rng } from "../../audio/synth";

interface FSide { kind: FlameGun | null; reach: number; idle: number; splashT: number; loop: Loop | null; pilotT: number }

/** After this long with no jet the stream has stopped: the next one starts from the nozzle again. */
const STOPPED = 0.2;

export class FireGuns {
  readonly sides: [FSide, FSide];
  private d = new THREE.Vector3();

  constructor(private bf: Battlefield, private unit: MechUnit, readonly v: WeaponValues) {
    const side = (): FSide => ({ kind: null, reach: 0, idle: 9, splashT: 0, loop: null, pilotT: 0 });
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
  step(i: number, dt: number, igniter: THREE.Vector3 | null, alive: boolean) {
    const s = this.sides[i], v = this.v;
    if (!s.kind) return;
    s.idle += dt; s.splashT -= dt;
    if (s.idle > STOPPED || !alive) s.reach = 0;
    else s.reach += v.flameSpeed * dt;
    if (igniter && alive) {
      s.pilotT -= dt;
      if (s.pilotT <= 0) { s.pilotT = 0.05; this.bf.flames.pilot(igniter.x, igniter.y, igniter.z, s.kind === "inferno" ? 1.5 : 1); }
    }
    const pouring = s.idle < 0.12 && alive;
    if (pouring) {
      if (!s.loop) { s.loop = this.bf.sfx.startSoundLoop("flameRoar", Math.random()); this.bf.sfx.playSound("flameIgnite", igniter ?? this.unit.sim.pelvis, 0.8, s.kind === "inferno" ? 0.8 : 1); }
      if (s.loop) this.bf.sfx.setSoundLoop(s.loop, "flameRoar", igniter ?? this.unit.sim.pelvis, s.kind === "inferno" ? 1 : 0.75, s.kind === "inferno" ? 0.85 : 1.05);
    } else this.quiet(s);
  }

  /** A jet left side i's fuel nozzle along `dir` (its pellets, cone and range): gobs for the look, the splash on the sand. */
  shot(i: number, fuel: THREE.Vector3, dir: THREE.Vector3, range: number, spread: number, pellets: number, aim: { x: number; y: number; z: number } | null,
    burn: { time: number; dps: number }) {
    const s = this.sides[i], v = this.v, bf = this.bf;
    if (!s.kind) return;
    s.idle = 0;
    const big = s.kind === "inferno" ? 1.35 : 1;
    const n = Math.round(v.flameGobs * Math.max(1, pellets));
    const sp = (spread * Math.PI) / 180;
    // The muzzle's own drift (the mech walking) carries into the stream.
    const mv = this.unit.sim.vel;
    for (let k = 0; k < n; k++) {
      const r = Math.sqrt(Math.random()) * Math.tan(sp), a = Math.random() * Math.PI * 2;
      const d = this.d.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      // A perpendicular jitter of the aim direction.
      const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const ax = new THREE.Vector3().crossVectors(dir, up).normalize(), ay = new THREE.Vector3().crossVectors(ax, dir);
      const dd = new THREE.Vector3().copy(dir).addScaledVector(ax, d.x).addScaledVector(ay, d.y).normalize();
      const speed = v.flameSpeed * (0.88 + Math.random() * 0.24);
      const life = range / Math.max(1, v.flameSpeed) * 1.15 + 0.25 + Math.random() * 0.2;
      const t0 = Math.random() * (1 / 60);
      bf.flames.gob(fuel.x + dd.x * speed * t0, fuel.y + dd.y * speed * t0, fuel.z + dd.z * speed * t0, dd.x * speed + (mv?.x ?? 0), dd.y * speed, dd.z * speed + (mv?.z ?? 0),
        life, v.flameSize * big * (0.8 + Math.random() * 0.4), v.flameGrow, v.flameIgnite * (0.7 + Math.random() * 0.6));
    }
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
function addFireSounds(bf: Battlefield, v: WeaponValues) {
  const sfx = bf.sfx;
  if (added.has(sfx)) return;
  added.add(sfx);
  const S = new Synth(sfx.rate);
  const variants = (n: number, seed: number, make: (r: () => number) => Float32Array) => Array.from({ length: n }, (_, i) => make(rng(seed * 137 + i)));
  sfx.addSound("flameRoar", variants(1, 91, (r) => S.mix(S.band(r, 1.5, 40, 650, 0.6, 0.02, 0), S.band(r, 1.5, 300, 2200, 0.2, 0.02, 0), steadyCrackle(S.n(1.5), r, 0.3), S.whine(1.5, 55, 55, 0.08))), () => v.flameLevel);
  sfx.addSound("flameIgnite", variants(2, 92, (r) => S.mix(S.thump(0.4, 140, 45, 0.7), S.lowPass(S.noise(r, 0.5, 900, 0.5, 0.01), 800), S.scale(S.crackle(r, 0.4, 0.3), 1))), () => v.flameLevel);
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
