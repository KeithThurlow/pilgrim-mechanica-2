// Frame-time counter shown in every lab (project rule: performance never degrades silently).
// Average and worst frame over the last second, coloured against the 60 FPS budget, plus lines a lab adds with set().

const BUDGET_MS = 1000 / 60;

export class FrameHud {
  private el: HTMLDivElement;
  private perf: HTMLDivElement;
  private extra: HTMLDivElement;
  private lines = new Map<string, string>();
  private samples: number[] = [];
  private windowStart = performance.now();
  private worst = 0;
  private shown = { avg: 0, worst: 0, calls: 0, tris: 0, sim: 0, draw: 0 };
  private simSum = 0;
  private drawSum = 0;

  constructor(parent: HTMLElement, private backend: string) {
    this.el = document.createElement("div");
    this.el.className = "hud";
    this.perf = document.createElement("div");
    this.extra = document.createElement("div");
    this.el.append(this.perf, this.extra);
    parent.appendChild(this.el);
  }

  /** A named line under the frame stats; set to "" to remove it. */
  set(key: string, text: string) {
    if (text) this.lines.set(key, text); else this.lines.delete(key);
  }

  /** sim: ms the lab's tick took (CPU). draw: ms to submit the frame to the GPU (CPU side of rendering). */
  frame(ms: number, drawCalls: number, triangles: number, sim = 0, draw = 0) {
    this.samples.push(ms);
    this.simSum += sim;
    this.drawSum += draw;
    this.worst = Math.max(this.worst, ms);
    const now = performance.now();
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

  private render() {
    const { avg, worst, calls, tris, sim, draw } = this.shown;
    const cls = (v: number) => (v <= BUDGET_MS * 1.05 ? "ok" : v <= BUDGET_MS * 2 ? "warn" : "bad");
    this.perf.innerHTML =
      `<b class="${cls(avg)}">${avg.toFixed(1)} ms</b> avg · <span class="${cls(worst)}">${worst.toFixed(1)}</span> worst · ` +
      `${Math.round(1000 / Math.max(0.1, avg))} fps<br><span class="dim">${this.backend} · ${calls} draws · ${(tris / 1000).toFixed(0)}k tris<br>` +
      // What's left of the frame after the tick and the submit is mostly the GPU (or waiting on it).
      `sim ${sim.toFixed(1)} ms · submit ${draw.toFixed(1)} ms · gpu/wait ${Math.max(0, avg - sim - draw).toFixed(1)} ms</span>`;
    this.extra.innerHTML = [...this.lines.values()].map((l) => `<div>${l}</div>`).join("");
  }
}
