// Marks remembered after they leave the dent window (Keith 2026-11-02: prints vanished as soon as they went off
// screen). The dent texture only covers a square round the camera focus; a mark kept here is pressed in again when it
// comes back into that square, as deep as it would be by now (healed over its surface's life), pressed rather than
// added so a part still in the texture isn't doubled. Two rings: footprints and skids, and everything else (ruts,
// furrows, craters), so a convoy's ruts can't push the prints out. The oldest go first when a ring is full; marks
// healed to 8% or farther than `range` from the focus are dropped. Cost: one box test per kept mark a frame, about
// 80 bytes a mark. Pure (no three.js), checked headless (tools/dents-check.ts). Cosmetic.
import { brushReach, type Brush } from "./dentRule";

interface Kept { b: Brush; t: number; reach: number; life: number }

export class DentMemory {
  private rings: (Kept | null)[][] = [[], []];
  private next = [0, 0];
  readonly stats = { kept: 0, replayed: 0 };

  /** Keep a mark (ring 0 prints, 1 the rest) made at `clock`, healing with time constant `life` (s; 0 never). */
  remember(ring: number, b: Brush, life: number, clock: number, cap: number) {
    cap = Math.max(0, Math.round(cap));
    if (!cap) return;
    const mem = this.rings[ring];
    if (mem.length !== cap) { mem.length = cap; mem.fill(null); this.next[ring] = 0; }
    mem[this.next[ring]] = { b, t: clock, reach: brushReach(b), life };
    this.next[ring] = (this.next[ring] + 1) % cap;
  }

  /**
   * The window moved from centre (pcx, pcz) to (cx, cz), half width `half`: push the kept marks that reach texels new
   * to it onto `out`, healed to `clock`. Marks made this clock are skipped (they went in already).
   */
  replay(clock: number, cx: number, cz: number, pcx: number, pcz: number, half: number, range: number, out: Brush[]) {
    let kept = 0, replayed = 0;
    for (const mem of this.rings) for (let i = 0; i < mem.length; i++) {
      const m = mem[i];
      if (!m) continue;
      const b = m.b, age = clock - m.t;
      const k = m.life > 0 ? Math.exp(-age / m.life) : 1;
      if (k < 0.08 || Math.abs(b.x - cx) > range || Math.abs(b.z - cz) > range) { mem[i] = null; continue; }
      kept++;
      if (age <= 0) continue;
      const r = m.reach;
      if (Math.abs(b.x - cx) >= half + r || Math.abs(b.z - cz) >= half + r) continue;
      if (Math.abs(b.x - pcx) + r <= half && Math.abs(b.z - pcz) + r <= half) continue;
      out.push({ ...b, dep: b.dep * k, berm: b.berm * k, comp: b.comp * k, mode: 0 });
      replayed++;
    }
    this.stats.kept = kept; this.stats.replayed = replayed;
  }

  clear() { this.rings = [[], []]; this.next = [0, 0]; }
}
