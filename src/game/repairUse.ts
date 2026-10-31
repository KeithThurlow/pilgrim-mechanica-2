// Glue for repair kits in a lab (combat labs, the convoy lab): Q pressed in the mech uses a kit (the useKit command);
// on foot, Q held beside the mech for kitHandTime patches it by hand with one. Turns the mech's kit events into
// sounds, and builds the vitals HUD's view. No rules of its own beyond the hand patch's hold (src/game/repair.ts has
// the rest).
import * as THREE from "three/webgpu";
import type { MechUnit } from "./mechUnit";
import type { OnFoot } from "../pilot/onFoot";
import type { Sfx } from "../audio/sfx";
import { Synth, rng } from "../audio/synth";
import type { KitRefusal } from "./repair";
import type { VitalsView } from "../ui/vitalsHud";

const WHY: Record<KitRefusal, string> = { none: "no kits left", full: "hull full", working: "repairing…", lockout: "kit cooling…", dead: "" };

/** The repair sounds: a ratchet and hiss as a kit starts, a soft clank when it's done, the low hull warning. */
export function addRepairSounds(sfx: Sfx, level: () => number) {
  const S = new Synth(sfx.rate);
  const r = (seed: number) => rng(seed);
  sfx.addSound("kitStart", [S.mix(S.ratchet(r(71), 0.35, 30, 14, 0.5, true), S.delay(S.noise(r(72), 0.9, 5200, 0.35, 0.05), 0.2), S.delay(S.whine(1.6, 900, 1500, 0.05), 0.25))], level);
  sfx.addSound("kitDone", [S.mix(S.clang(r(73), 0.25, 0.25), S.thump(0.12, 180, 120, 0.3))], level);
  sfx.addSound("lowHull", [S.mix(S.whine(0.16, 880, 880, 0.18), S.delay(S.whine(0.16, 660, 660, 0.18), 0.22))], level);
}

export class KitControl {
  /** On foot: 0..1 of the hand patch's hold. */
  hand = 0;
  /** The note beside the kits (why Q did nothing), and how long it stays. */
  private note = "";
  private noteFor = 0;
  private wasQ = false;
  private lastCount = -1;
  private at = new THREE.Vector3();

  constructor(private player: MechUnit, private foot: OnFoot, private sfx: Sfx | null) {}

  /** qHeld: Q down this frame. demo: the lab's demo is driving (no kits). Returns the on-foot prompt line, if any. */
  update(dt: number, qHeld: boolean, demo: boolean): string {
    const { player, foot } = this;
    const v = player.v;
    const pressed = qHeld && !this.wasQ;
    this.wasQ = qHeld;
    this.noteFor = Math.max(0, this.noteFor - dt);
    let prompt = "";
    if (!demo && foot.driving && pressed) this.tell(player.useKit());
    else if (!demo && !foot.driving && foot.sim.alive && foot.mount.onFoot) {
      const p = foot.sim.pos, m = player.sim.pos;
      const near = player.alive && Math.hypot(p.x - m.x, p.z - m.z) <= v.kitHandReach;
      const why = player.kits.refusal(player.health, player.maxHealth, player.alive);
      if (near && !why) {
        this.hand = qHeld ? Math.min(1, this.hand + dt / Math.max(0.05, v.kitHandTime)) : 0;
        prompt = qHeld ? `Patching the mech… ${Math.round(this.hand * 100)}%` : `Hold <b>Q</b>: patch the mech with a kit (${player.kits.count} left)`;
        if (this.hand >= 1) { this.hand = 0; this.tell(player.useKit()); }
      } else {
        this.hand = 0;
        if (near && qHeld && why && why !== "working") prompt = `Can't patch: ${WHY[why]}`;
      }
    } else this.hand = 0;
    // A kit found or bought: say so beside the pips.
    const n = player.kits.count;
    if (this.lastCount >= 0 && n > this.lastCount) { this.note = `+${n - this.lastCount} repair kit`; this.noteFor = 1.8; }
    this.lastCount = n;
    // Sounds from the mech's kit events.
    for (const e of player.kits.events) {
      if (!this.sfx) break;
      this.at.set(player.sim.pelvis.x, player.sim.pelvis.y, player.sim.pelvis.z);
      if (e.kind === "kitStarted") this.sfx.playSound("kitStart", this.at, 1);
      else if (e.kind === "kitDone") this.sfx.playSound("kitDone", this.at, 0.8);
    }
    player.kits.events.length = 0;
    return prompt;
  }

  private tell(why: KitRefusal | null) {
    if (why && why !== "dead") { this.note = WHY[why]; this.noteFor = 1.2; }
  }

  /** The vitals HUD's view of the mech (and the pilot, on foot). */
  view(): VitalsView {
    const { player, foot } = this;
    const k = player.kits;
    return {
      hull: player.health, max: player.maxHealth, armour: player.armourOf(), alive: player.alive,
      kits: k.count, kitMax: player.v.kitMax, kitProgress: k.progress,
      kitReady: !k.refusal(player.health, player.maxHealth, player.alive),
      pilot: foot.driving ? null : { hp: foot.sim.health, max: foot.sim.v.pilotHealth },
      note: this.noteFor > 0 ? this.note : k.progress !== null ? "repairing…" : undefined,
    };
  }

  /** The low hull warning (the HUD says when it's crossed). */
  warn() {
    if (!this.sfx) return;
    const p = this.player.sim.pelvis;
    this.sfx.playSound("lowHull", this.at.set(p.x, p.y, p.z), 0.7);
  }
}
