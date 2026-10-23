// The minigun's sound, as the old game played it (Auto_Minigun feel, Keith's minigun lab 2026-10-18 to 10-23):
// a spit on every round, a growl loop per gun whose level and pitch follow the barrel spin, a spin-up on the trigger
// and a spin-down on release, a dirt hit per round and an impact brap gathered at most every 50 ms (louder for each
// hit it gathered), and a dull tonk for each casing landing.
// Each gun has its own growl voice, started at a different point in the loop and detuned a little, so the two
// beat against each other: the overlapping reverberation Keith liked in the old game.
import type * as THREE from "three/webgpu";
import type { Sfx, Loop } from "./sfx";

const BRAP_INTERVAL = 0.05, BRAP_STACK = 4, BRAP_STACK_GAIN = 0.04;

export class MinigunAudio {
  private loops: (Loop | null)[] = [null, null];
  private wasTrigger = false;
  private pending = 0;
  private lastBrap = -1;
  private loopLevel = [0, 0];

  constructor(private sfx: Sfx) {}

  /** Each frame. muzzles: [left, right] world positions. firing: rounds are coming out. */
  update(dt: number, trigger: boolean, firing: boolean, spin: number, muzzles: THREE.Vector3[]) {
    const sfx = this.sfx;
    if (!sfx.running) { this.wasTrigger = trigger; return; }
    const mid = muzzles[0].clone().lerp(muzzles[1], 0.5);
    if (trigger && !this.wasTrigger && spin < 0.95) sfx.play("spinUp", mid);
    if (!trigger && this.wasTrigger && spin > 0.2) sfx.play("spinDown", mid);
    this.wasTrigger = trigger;

    const detune = sfx.v.growlDetune / 100;
    for (let i = 0; i < 2; i++) {
      if (!this.loops[i]) this.loops[i] = sfx.startLoop("growl", i * 0.37 + 0.11);
      // Fade in while firing (louder as the barrels come up to speed), fade out quickly after.
      const want = firing ? 0.6 + 0.4 * spin : 0;
      this.loopLevel[i] += (want - this.loopLevel[i]) * Math.min(1, dt * (firing ? 30 : 12));
      const pitch = (0.7 + 0.35 * spin) * (1 + (i === 0 ? -0.5 : 0.5) * detune);
      sfx.setLoop(this.loops[i]!, muzzles[i], this.loopLevel[i], pitch);
    }
  }

  shot(muzzle: THREE.Vector3) { this.sfx.play("spit", muzzle); }

  hit(at: THREE.Vector3) {
    const sfx = this.sfx;
    sfx.play("dirtHit", at, 0.9 + Math.random() * 0.2);
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
