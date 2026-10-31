// The contract panel (DOM; docs/proposal-quests.md): offers with the J hint and the seconds left, active contracts with
// their progress, distance and bonus, a line for the lair you're standing in, and the HVT's hull bar while it's out.
// Sits at the top of the expedition column (ExpeditionHud.questSlot).
import type { Contract, ContractBoard } from "./contracts";
import { KIND_NAME, KILL_NAME } from "./contracts";
import type { Lair } from "./hvt";

const GOLD = "#ffd27a", RED = "#ff8a6a", DIM = "#a99f8a";

export interface QuestHudFrame {
  board: ContractBoard;
  from: { x: number; z: number };
  /** The lair whose circle you're in (or the one on the field), and the HVT's hull share while it's out. */
  lair: Lair | null;
  hvt: { name: string; health: number; level: number } | null;
  towing: boolean;
  /** "Hold E: hook the hulk" and the like. */
  prompt: string;
}

const compass = (dx: number, dz: number) => {
  // +Z is north on the map as the radar draws it with no yaw; good enough for a hint.
  const a = (Math.atan2(dx, dz) * 180) / Math.PI;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((a + 360) % 360) / 45) % 8];
};

export class QuestHud {
  private last = "";

  constructor(private el: HTMLElement) {}

  private goal(c: Contract): string {
    switch (c.kind) {
      case "salvage": return `strip ${c.label} ${c.have}/${c.need}`;
      case "cull": return `kill ${KILL_NAME[c.cull!]} at the ${c.label.toLowerCase()} ${c.have}/${c.need}`;
      case "bounty": return `kill ${c.label}`;
      case "tow": return c.carrying ? "tow it to the crane" : "hook the downed Rampart (hold E)";
      case "pods": return `pods ${c.have}/${c.need}${c.carrying ? " (at risk)" : ""}`;
    }
  }

  update(f: QuestHudFrame) {
    const b = f.board, lines: string[] = [];
    const dist = (c: Contract) => {
      const dx = c.x - f.from.x, dz = c.z - f.from.z, d = Math.hypot(dx, dz);
      return d < 60 ? "here" : `${Math.round(d / 10) * 10} m ${compass(dx, dz)}`;
    };
    for (const c of b.list) {
      if (c.state === "offered") lines.push(`<div style="color:${GOLD}">▸ ${KIND_NAME[c.kind]} · ${dist(c)} · +${c.reward} <span style="color:${DIM}">J to accept (${Math.ceil(b.left(c))} s)</span></div>`);
      else if (c.state === "active") lines.push(`<div>◆ <b style="color:${GOLD}">${KIND_NAME[c.kind]}</b> · ${this.goal(c)} · ${c.kind === "tow" && c.carrying ? "" : dist(c) + " · "}+${c.reward}</div>`);
      else if (c.state === "done") lines.push(`<div style="color:${GOLD}">✓ ${KIND_NAME[c.kind]} done · +${c.reward} ${c.kind === "tow" || c.kind === "pods" ? "banked" : "at risk"}</div>`);
      else if (c.state === "failed") lines.push(`<div style="color:${RED}">✗ ${KIND_NAME[c.kind]} failed</div>`);
      else if (c.state === "dropped") lines.push(`<div style="color:${DIM}">✗ ${KIND_NAME[c.kind]} dropped</div>`);
    }
    if (b.dropping > 0) lines.push(`<div style="color:${RED}">dropping… ${Math.round(b.dropping * 100)}%</div>`);
    if (f.hvt) {
      const w = Math.round(Math.max(0, f.hvt.health) * 100);
      lines.push(`<div style="color:${RED}">☠ ${f.hvt.name.toUpperCase()} · lv ${f.hvt.level}<div style="height:5px;background:#0008;border-radius:2px;margin-top:2px"><div style="height:5px;width:${w}%;background:${RED};border-radius:2px"></div></div></div>`);
    } else if (f.lair && f.lair.state !== "dead") {
      const l = f.lair;
      lines.push(`<div style="color:${RED}">☠ ${l.name}'s ground · ${l.state === "stirring" ? "it's coming" : `${KILL_NAME[l.cull]} ${l.kills}/${l.need} to draw it out`}</div>`);
    }
    if (f.towing) lines.push(`<div style="color:${DIM}">towing: slow, no sprint or dash · hold E to drop</div>`);
    const html = lines.length ? `<div style="border-bottom:1px solid #fff2;padding-bottom:4px;margin-bottom:4px;font-size:12px">${lines.join("")}</div>` : "";
    if (html !== this.last) { this.el.innerHTML = html; this.last = html; }
  }
}
