// The stress lab's Run: ramp the counts up in steps, let each settle, then record every frame's cost per stage, and
// print a table of average and worst ms per stage per step. A one-off measurement (Keith 2026-10-26), not a check.

export interface Step { pct: number }
/** One frame: ms per stage, plus the counts on the field. */
export type Sample = { ms: Map<string, number>; counts: Record<string, number> };

export class StressRun {
  running = false;
  step = -1;
  private t = 0;
  private samples: Sample[][] = [];
  /** The table of the last finished run (markdown), and its raw numbers. */
  table = "";
  result: { pct: number; frames: number; counts: Record<string, number>; stages: Record<string, { avg: number; worst: number }> }[] = [];

  constructor(public steps: number[], public settle: number, public hold: number) {}

  start() { this.running = true; this.step = 0; this.t = 0; this.samples = this.steps.map(() => []); this.table = ""; this.result = []; }

  /** The share of the counts to field now (1 when not running). */
  get share() { return this.running ? this.steps[this.step] / 100 : 1; }

  /** The phase line for the HUD. */
  get phase() {
    if (!this.running) return this.table ? "run done: table below" : "";
    const settling = this.t < this.settle;
    return `run: step ${this.step + 1}/${this.steps.length} (${this.steps[this.step]}%) · ${settling ? `settling ${(this.settle - this.t).toFixed(1)} s` : `recording ${(this.settle + this.hold - this.t).toFixed(1)} s`}`;
  }

  /** Called every frame with that frame's sample. Returns true when the run just finished. */
  frame(dt: number, s: Sample): boolean {
    if (!this.running) return false;
    this.t += dt;
    if (this.t >= this.settle) this.samples[this.step].push(s);
    if (this.t < this.settle + this.hold) return false;
    this.step++; this.t = 0;
    if (this.step < this.steps.length) return false;
    this.running = false;
    this.finish();
    return true;
  }

  private finish() {
    const stages = new Set<string>();
    for (const st of this.samples) for (const s of st) for (const k of s.ms.keys()) stages.add(k);
    this.result = this.steps.map((pct, i) => {
      const fr = this.samples[i], n = Math.max(1, fr.length);
      const out: Record<string, { avg: number; worst: number }> = {};
      for (const k of stages) {
        let sum = 0, worst = 0;
        for (const s of fr) { const v = s.ms.get(k) ?? 0; sum += v; worst = Math.max(worst, v); }
        out[k] = { avg: sum / n, worst };
      }
      const counts: Record<string, number> = {};
      for (const s of fr) for (const [k, v] of Object.entries(s.counts)) counts[k] = (counts[k] ?? 0) + v / n;
      return { pct, frames: fr.length, counts, stages: out };
    });
    // Rows: the frame and its split first, then the stages by their cost at the biggest step.
    const top = this.result[this.result.length - 1];
    const head = ["frame", "tick (all sim)", "render (submit)", "gpu/wait"];
    const rows = [...head, ...[...stages].filter((k) => !head.includes(k)).sort((a, b) => (top.stages[b]?.avg ?? 0) - (top.stages[a]?.avg ?? 0))];
    const f = (x: number) => x.toFixed(x >= 10 ? 1 : 2);
    const lines = [
      `| stage | ${this.result.map((r) => `${r.pct}% avg / worst`).join(" | ")} |`,
      `| --- | ${this.result.map(() => "---").join(" | ")} |`,
      ...rows.filter((k) => stages.has(k)).map((k) => `| ${k} | ${this.result.map((r) => `${f(r.stages[k]?.avg ?? 0)} / ${f(r.stages[k]?.worst ?? 0)}`).join(" | ")} |`),
      "",
      `| on the field (avg) | ${this.result.map((r) => `${r.pct}%`).join(" | ")} |`,
      `| --- | ${this.result.map(() => "---").join(" | ")} |`,
      ...Object.keys(top.counts).map((k) => `| ${k} | ${this.result.map((r) => Math.round(r.counts[k] ?? 0)).join(" | ")} |`),
      `| frames recorded | ${this.result.map((r) => r.frames).join(" | ")} |`,
    ];
    this.table = lines.join("\n");
  }
}
