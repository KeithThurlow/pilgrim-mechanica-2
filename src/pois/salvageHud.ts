// The salvage HUD: the scrap count, big at the top of the screen (it ticks up as spots pay), the prompt for the spot
// in reach ("Hold E: strip ..."), and a short note when a section is banked.
import type { SalvageSim, SectionState } from "./salvage";

export class SalvageHud {
  private box = document.createElement("div");
  private count = document.createElement("div");
  private prompt = document.createElement("div");
  private note = document.createElement("div");
  private shown = 0;
  private noteT = 0;
  private bump = 0;

  constructor(private sim: SalvageSim) {
    Object.assign(this.box.style, {
      position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none",
      font: "600 15px/1.3 system-ui, 'Segoe UI', sans-serif", color: "#f3e6cc", textShadow: "0 1px 3px #000c", zIndex: "5",
    } as CSSStyleDeclaration);
    Object.assign(this.count.style, { font: "700 28px/1.1 system-ui, 'Segoe UI', sans-serif", letterSpacing: "0.04em", color: "#ffc46b" });
    Object.assign(this.prompt.style, { marginTop: "4px", opacity: "0.95" });
    Object.assign(this.note.style, { marginTop: "4px", color: "#ffe2a8", opacity: "0" });
    this.box.append(this.count, this.prompt, this.note);
    document.body.appendChild(this.box);
  }

  banked(s: SectionState) {
    this.note.textContent = `Banked: ${s.name} (+${s.spots.reduce((a, q) => a + this.sim.pay(q), 0)} scrap)`;
    this.noteT = 2.5;
  }

  update(dt: number) {
    const sim = this.sim;
    // Count up toward the real total, quickly.
    if (this.shown < sim.scrap) { this.shown = Math.min(sim.scrap, this.shown + Math.max(1, (sim.scrap - this.shown) * dt * 6)); this.bump = 0.25; }
    this.bump = Math.max(0, this.bump - dt);
    this.count.textContent = `◆ ${Math.floor(this.shown)} scrap`;
    this.count.style.transform = `scale(${1 + this.bump * 0.5})`;
    const s = sim.inReach;
    if (sim.active) this.prompt.textContent = `Stripping ${sim.active.label}… ${Math.round(sim.active.progress * 100)}%  (loud)`;
    else if (s) this.prompt.textContent = `Hold E: strip ${s.label} (+${sim.pay(s)} scrap)${s.progress > 0 ? `, ${Math.round(s.progress * 100)}% done` : ""}`;
    else this.prompt.textContent = "";
    this.noteT = Math.max(0, this.noteT - dt);
    this.note.style.opacity = String(Math.min(1, this.noteT));
  }
}
