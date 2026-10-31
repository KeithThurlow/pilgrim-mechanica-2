// Frame-time counter shown in every lab (project rule: performance never degrades silently).
// Keith 2026-10-31: the HUD had grown so many lines it couldn't be read. What shows by default now is only the frame:
// average and worst ms and FPS (coloured against the 60 FPS budget), the split into sim / submit / GPU, and the three
// dearest CPU stages when the lab marks its stages (src/core/costs.ts). Everything a lab adds with set() goes under a
// collapsed "details" line (click it or press ` to open; remembered per browser).
// For agents: window.__hud() returns the whole HUD as text (every line, the full stage list, the recent frame spikes)
// and the Report button sends that, so nothing is lost by hiding it.

const BUDGET_MS = 1000 / 60;
const OPEN_KEY = "hud.details";

type Line = string | (() => string);

interface Spike { at: number; ms: number; sim: number; submit: number; stages: string }

export class FrameHud {
  private el: HTMLDivElement;
  private perf: HTMLDivElement;
  private toggle: HTMLDivElement;
  private extra: HTMLDivElement;
  private lines = new Map<string, Line>();
  private samples: number[] = [];
  private windowStart = performance.now();
  private worst = 0;
  private shown = { avg: 0, worst: 0, calls: 0, tris: 0, sim: 0, draw: 0 };
  private simSum = 0;
  private drawSum = 0;
  private open = false;
  /** The CPU stage averages (ms) from the lab's Costs, dearest first; set by Costs.end via stages(). */
  private stageList: [string, number][] = [];
  /** This frame's stages, for the spike log. */
  private frameStages: Map<string, number> | null = null;
  /** Frames over twice the budget, newest last (the last 20), with what the CPU spent them on. */
  readonly spikes: Spike[] = [];

  constructor(parent: HTMLElement, private backend: string) {
    this.el = document.createElement("div");
    this.el.className = "hud";
    this.perf = document.createElement("div");
    this.toggle = document.createElement("div");
    this.toggle.className = "hud-toggle dim";
    this.extra = document.createElement("div");
    this.el.append(this.perf, this.toggle, this.extra);
    parent.appendChild(this.el);
    try { this.open = localStorage.getItem(OPEN_KEY) === "1"; } catch { /* private mode */ }
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
    addEventListener("keydown", (e) => {
      if (e.code !== "Backquote" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      this.setOpen(!this.open);
    });
    (window as unknown as { __hud: () => string }).__hud = () => this.dump();
    this.setOpen(this.open);
  }

  private setOpen(on: boolean) {
    this.open = on;
    try { localStorage.setItem(OPEN_KEY, on ? "1" : "0"); } catch { /* private mode */ }
    this.extra.hidden = !on;
    this.render();
  }

  /**
   * A named line in the details (hidden until opened); "" removes it. Pass a function for a line that costs anything
   * to build: it only runs when the details are open (twice a second) or when dumped.
   */
  set(key: string, text: Line) {
    if (text) this.lines.set(key, text); else this.lines.delete(key);
  }

  /** The lab's CPU stages (from Costs): averages for the HUD, this frame's for the spike log. */
  stages(avg: [string, number][] | null, frame: Map<string, number>) {
    if (avg) this.stageList = avg;
    this.frameStages = frame;
  }

  /** sim: ms the lab's tick took (CPU). draw: ms to submit the frame to the GPU (CPU side of rendering). */
  frame(ms: number, drawCalls: number, triangles: number, sim = 0, draw = 0) {
    this.samples.push(ms);
    this.simSum += sim;
    this.drawSum += draw;
    this.worst = Math.max(this.worst, ms);
    const now = performance.now();
    // Spikes: skip the first seconds (shader compiles, chunk builds) and keep what the CPU spent the frame on.
    if (ms > BUDGET_MS * 2 && now > 5000) {
      const st = this.frameStages ? [...this.frameStages].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ") : "";
      this.spikes.push({ at: +(now / 1000).toFixed(1), ms: +ms.toFixed(1), sim: +sim.toFixed(1), submit: +draw.toFixed(1), stages: st });
      if (this.spikes.length > 20) this.spikes.shift();
    }
    if (now - this.windowStart >= 500) {
      const avg = this.samples.reduce((a, b) => a + b, 0) / Math.max(1, this.samples.length);
      const n = Math.max(1, this.samples.length);
      this.shown = { avg, worst: this.worst, calls: drawCalls, tris: triangles, sim: this.simSum / n, draw: this.drawSum / n };
      this.simSum = 0;
      this.drawSum = 0;
      this.samples = [];
      this.worst = 0;
      this.windowStart = now;
      this.render();
    }
  }

  private text(l: Line): string {
    try { return typeof l === "function" ? l() : l; } catch { return ""; }
  }

  private render() {
    const { avg, worst, calls, tris, sim, draw } = this.shown;
    const cls = (v: number) => (v <= BUDGET_MS * 1.05 ? "ok" : v <= BUDGET_MS * 2 ? "warn" : "bad");
    const top = this.stageList.slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ");
    this.perf.innerHTML =
      `<b class="${cls(avg)}">${avg.toFixed(1)} ms</b> avg · <span class="${cls(worst)}">${worst.toFixed(1)}</span> worst · ` +
      `${Math.round(1000 / Math.max(0.1, avg))} fps<br><span class="dim">` +
      // What's left of the frame after the tick and the submit is mostly the GPU (or waiting on it).
      `sim ${sim.toFixed(1)} · submit ${draw.toFixed(1)} · gpu/wait ${Math.max(0, avg - sim - draw).toFixed(1)} ms` +
      `${top ? `<br>top: ${top}` : ""}</span>`;
    const n = this.lines.size;
    this.toggle.textContent = `${this.open ? "▾" : "▸"} details${n ? ` (${n})` : ""} · \``;
    if (!this.open) { this.extra.innerHTML = ""; return; }
    const all = this.stageList.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ");
    this.extra.innerHTML =
      `<div class="dim">${this.backend} · ${calls} draws · ${(tris / 1000).toFixed(0)}k tris</div>` +
      (all ? `<div class="dim">cpu ms: ${all}</div>` : "") +
      [...this.lines.values()].map((l) => this.text(l)).filter(Boolean).map((l) => `<div>${l}</div>`).join("");
  }

  /** Everything as plain text: for the Report button and for agents (window.__hud()). */
  dump(): string {
    const { avg, worst, calls, tris, sim, draw } = this.shown;
    const strip = (s: string) => s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
    const out = [
      `${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} worst · ${Math.round(1000 / Math.max(0.1, avg))} fps`,
      `sim ${sim.toFixed(1)} · submit ${draw.toFixed(1)} · gpu/wait ${Math.max(0, avg - sim - draw).toFixed(1)} ms`,
      `${this.backend} · ${calls} draws · ${(tris / 1000).toFixed(0)}k tris`,
    ];
    if (this.stageList.length) out.push(`cpu ms: ${this.stageList.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ")}`);
    for (const [k, l] of this.lines) { const t = this.text(l); if (t) out.push(`${k}: ${strip(t)}`); }
    if (this.spikes.length) {
      out.push(`spikes (frames over ${(BUDGET_MS * 2).toFixed(0)} ms, newest last):`);
      for (const s of this.spikes) out.push(`  t ${s.at} s: ${s.ms} ms (sim ${s.sim}, submit ${s.submit})${s.stages ? ` · ${s.stages}` : ""}`);
    }
    return out.join("\n");
  }
}
