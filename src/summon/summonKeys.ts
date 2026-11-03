// The summoner gear's keys and action-bar buttons (Keith 2026-11-03: "I've equipped the summoner items ... I can't seem
// to use them and they don't have actives"). Shared by every lab that fits a loadout (src/game/combatLab.ts) and the
// convoy lab. A drone rack's shoulder key (1 or 2) is a drone strike (Summons.strike), a swarm hive's sends the swarm
// and calls it back; the replica bay (the pack) has no key, its button shows the replicas up and building.
// Reads key states as plain booleans (commands in, never the keyboard itself).
// Ownership: player (their own key presses); the summons it drives are host.
import type { Resolved } from "../items/loadout";
import type { KeySlot } from "../weapons/arsenal";
import type { Summons } from "./summons";

export class SummonKeys {
  private was = [false, false];
  constructor(private s: Summons) {}

  /** Shoulder keys 1 and 2 held this frame (false while typing, sprinting or on foot). */
  update(r: Resolved | null, down1: boolean, down2: boolean) {
    const sm = r?.summons;
    [down1, down2].forEach((down, i) => {
      const key = (i + 1) as 1 | 2;
      if (down && !this.was[i] && sm) {
        if (sm.swarmKeys.includes(key)) this.s.sendOrRecall();
        else if (sm.droneKeys.includes(key)) this.s.strike();
      }
      this.was[i] = down;
    });
  }

  /** Buttons for the action bar, one per summoner item fitted. */
  slots(r: Resolved | null, off: boolean): KeySlot[] {
    const sm = r?.summons, s = this.s, v = s.v;
    if (!sm) return [];
    const out: KeySlot[] = [];
    for (const key of [1, 2] as const) {
      if (sm.droneKeys.includes(key)) {
        const d = s.drones;
        out.push({ key: String(key), name: "Drone strike", cool: Math.max(0, s.strikeCool - s.strikeLeft), coolMax: v.droneStrikeCool, left: s.strikeLeft, leftMax: v.droneStrikeTime, aiming: false, off: off || !s.active, rounds: `${d.flying}/${d.n} up` });
      }
      if (sm.swarmKeys.includes(key)) {
        const a = s.allies, sent = a.mode === "sent";
        out.push({ key: String(key), name: sent ? "Recall swarm" : "Send swarm", cool: 0, left: sent ? 1 : 0, leftMax: 1, aiming: false, off: off || !s.active, rounds: `${a.scrappers}/${v.swarmCount}` });
      }
    }
    if (sm.replicas > 0) {
      const up = s.replicas?.units().length ?? 0;
      out.push({ key: "·", name: "Replicas", cool: s.replicas?.building ?? 0, coolMax: v.repBuild, left: 0, aiming: false, off: !s.active, rounds: `${up}/${sm.replicas}` });
    }
    return out;
  }
}
