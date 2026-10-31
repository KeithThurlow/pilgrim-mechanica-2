// The minigun's sound, as the old game played it (Auto_Minigun feel, Keith's minigun lab 2026-10-18 to 10-23):
// a spit on every round, a growl loop whose level and pitch follow the barrel spin, a spin-up on the trigger and a
// spin-down on release, a dirt hit per round and an impact brap gathered at most every 50 ms (louder for each hit
// it gathered), and a dull tonk for each casing landing.
// Every gun is its own voice (Keith 2026-10-24): its own spin-up (pitched to its own spin-up time) and spin-down
// from its own muzzle, its own growl following its own spin and firing, started at a different point in the loop
// and detuned a little, so two guns drift against each other instead of sounding like one.
import type * as THREE from "three/webgpu";
import type { Sfx, Loop } from "./sfx";
import type { Gun } from "../mech/upper";

const BRAP_INTERVAL = 0.05, BRAP_STACK = 4, BRAP_STACK_GAIN = 0.04;
const SPIN_UP_CLIP = 1.1; // seconds: the spin-up sound is built for this spin-up time

/** What the voices need of the sound player (the real Sfx, or a stand-in in the headless check). */
export type GunSfx = Pick<Sfx, "running" | "play" | "startLoop" | "setLoop" | "stopLoop"> & { v: { growlDetune: number }; ctx: { currentTime: number } };

/** One mech's guns: a growl loop each, and the trigger edges for the spin sounds. */
interface Voice { loops: (Loop | null)[]; wasTrigger: boolean[]; level: number[]; quiet: number }
/** A voice nobody has updated for this long (its mech died, hopped out, was removed) is released (s). */
export const VOICE_TTL = 0.25;

export class MinigunAudio {
  /** One voice per mech (Keith 2026-10-31): the loops used to be shared by index, so a mech that stopped updating left
   *  its growl running at the last level for good. Now a mech that dies calls release(), and tick() releases any that
   *  goes quiet by itself; the sound player's own watchdog (sfx.ts) is the last net under both. */
  private voices = new Map<object, Voice>();
  private pending = 0;
  private lastBrap = -1;

  constructor(private sfx: GunSfx) {}

  /** Live growl loops (checks and readouts). */
  get liveLoops() { let n = 0; for (const v of this.voices.values()) for (const l of v.loops) if (l) n++; return n; }

  /** Each frame, for one mech (owner) with each gun and its muzzle in world space (same order). */
  update(owner: object, dt: number, trigger: boolean, guns: readonly Gun[], muzzles: THREE.Vector3[]) {
    const sfx = this.sfx;
    let vo = this.voices.get(owner);
    if (!vo) this.voices.set(owner, vo = { loops: [], wasTrigger: [], level: [], quiet: 0 });
    vo.quiet = 0;
    if (!sfx.running) { guns.forEach((_, i) => (vo.wasTrigger[i] = trigger)); return; }
    const detune = sfx.v.growlDetune / 100;
    guns.forEach((g, i) => {
      // Two guns can't share one same-instant gate, or the second gun's spin-up would be swallowed.
      if (trigger && !vo.wasTrigger[i] && g.spin < 0.95) sfx.play("spinUp", muzzles[i], 1, SPIN_UP_CLIP / Math.max(0.2, g.spinUpTime), false);
      if (!trigger && vo.wasTrigger[i] && g.spin > 0.2) sfx.play("spinDown", muzzles[i], 1, 1 + (i ? -0.04 : 0.04), false);
      vo.wasTrigger[i] = trigger;

      vo.loops[i] ??= sfx.startLoop("growl", i * 0.37 + 0.11);
      const want = g.firing ? 0.6 + 0.4 * g.spin : 0;
      vo.level[i] = (vo.level[i] ?? 0) + (want - (vo.level[i] ?? 0)) * Math.min(1, dt * (g.firing ? 30 : 12));
      const pitch = (0.7 + 0.35 * g.spin) * (1 + (g.side === 1 ? -0.5 : 0.5) * detune);
      sfx.setLoop(vo.loops[i]!, muzzles[i], vo.level[i], pitch);
    });
  }

  /** The owner is gone, dead, out of its mech or starting over: its loops fade out now. */
  release(owner: object) {
    const vo = this.voices.get(owner);
    if (!vo) return;
    for (const l of vo.loops) if (l) this.sfx.stopLoop(l);
    this.voices.delete(owner);
  }

  /** Every frame: voices that were not updated for VOICE_TTL are released. */
  tick(dt: number) {
    for (const [owner, vo] of this.voices) if ((vo.quiet += dt) > VOICE_TTL) this.release(owner);
  }

  /** One round's spit from its own gun (not gated against the other gun's rounds). */
  shot(muzzle: THREE.Vector3) { this.sfx.play("spit", muzzle, 1, 1, false); }

  hit(at: THREE.Vector3, surface: "sand" | "metal" | "flesh" = "sand") {
    const sfx = this.sfx;
    if (surface === "metal") sfx.play("metalHit", at, 0.9 + Math.random() * 0.2, 0.9 + Math.random() * 0.25);
    else sfx.play("dirtHit", at, 0.9 + Math.random() * 0.2);
    this.pending++;
    const now = sfx.ctx.currentTime;
    if (now - this.lastBrap < BRAP_INTERVAL) return;
    const n = Math.min(this.pending, BRAP_STACK);
    sfx.play("brap", at, 1 + BRAP_STACK_GAIN * (n - 1));
    this.pending = 0;
    this.lastBrap = now;
  }

  casing(at: THREE.Vector3) { this.sfx.play("casing", at); }
}
