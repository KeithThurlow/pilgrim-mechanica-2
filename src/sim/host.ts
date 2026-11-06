// The main thread's side of the sim worker (plan docs/proposal-simworker.md): starts src/sim/worker.ts, sends each
// frame's inputs (step 1: the ground's events from src/sim/groundEvents.ts) and takes the answers a frame or so later.
// ?noworker: no worker at all, everything on the main thread as before (for comparing).
//
// The worker keeps its copy of the ground in step, and every frame a few points are sampled on both threads (round the
// mech, across the road at the plough's blade, round the latest blasts): any difference shows on the HUD line and in
// the console, since every system moved reads the ground there. Step 2: the terrain chunks' vertices are worked out
// there (terrain(streamer)); the chunks near the mech are still built here when missing.
import type { Param } from "../core/tweaks";
import type { ConvoyRoute } from "../convoy/route";
import type { GroundRecorder } from "./groundEvents";
import type { TerrainStreamer } from "../world/chunks";
import type { FromWorker, ToWorker } from "./messages";

export const SIM_DEFAULTS = {
  simMirrorSamples: 16,
};
export type SimValues = typeof SIM_DEFAULTS;
export const SIM_PARAMS: Param[] = [
  { key: "simMirrorSamples", label: "Ground parity points a frame", min: 0, max: 256, step: 8, group: "Performance", tip: "Points where the sim worker's copy of the ground is checked against the main thread's every frame (0: off). Costs the main thread a few µs each" },
];

/** Whether this page runs the sim worker (not with ?noworker). */
export const workerWanted = () => !new URLSearchParams(location.search).has("noworker");

export class SimHost {
  private worker: Worker;
  private id = 0;
  private expected = new Map<number, { want: Float64Array; xz: Float64Array }>();
  private seed = 0x9e3779b9;
  private warned = false;
  readonly stats = {
    ready: false, applyMs: 0, frames: 0, answered: 0, lag: 0, workerMs: 0, mainMs: 0, events: 0, eventsTotal: 0,
    checked: 0, differ: 0, worst: 0, worstAt: "", error: "",
  };

  constructor(private v: SimValues, private rec: GroundRecorder, private route: ConvoyRoute, private height: (x: number, z: number) => number) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => { this.stats.error = e.message || "worker failed to load"; console.error("sim worker:", e); };
    this.send({ type: "init", ground: rec.init });
    (globalThis as unknown as { __simworker: unknown }).__simworker = this.stats;
  }

  /** End of a frame: send the ground's changes and a few points to check (round fx, fz: the mech). */
  frame(fx: number, fz: number) {
    const t0 = performance.now();
    this.flush();
    const id = ++this.id;
    // Don't pile checks up if the worker falls behind (the events always go: the copy needs every one).
    const n = this.expected.size < 3 ? Math.max(0, Math.round(this.v.simMirrorSamples)) : 0;
    const sample = new Float64Array(2 * n);
    if (n) {
      const want = new Float64Array(n), p = { x: 0, z: 0, heading: 0 }, spots = this.rec.spots;
      for (let i = 0; i < n; i++) {
        let x: number, z: number;
        const k = i % 3;
        if (k === 0) { x = fx + (this.rnd() - 0.5) * 240; z = fz + (this.rnd() - 0.5) * 240; }
        else if (k === 1) { this.route.offsetAt(this.route.blade - 60 * this.rnd(), (this.rnd() - 0.5) * 70, p); x = p.x; z = p.z; }
        else { const s = spots.length ? spots[Math.floor(this.rnd() * spots.length)] : [fx, fz]; x = s[0] + (this.rnd() - 0.5) * 16; z = s[1] + (this.rnd() - 0.5) * 16; }
        sample[2 * i] = x; sample[2 * i + 1] = z;
        want[i] = this.height(x, z);
      }
      this.expected.set(id, { want, xz: sample.slice() });
    }
    this.stats.frames++;
    this.stats.events = this.frameEvents;
    this.frameEvents = 0;
    this.stats.applyMs = this.applyMs;
    this.applyMs = 0;
    this.send({ type: "frame", id, sample }, [sample.buffer]);
    this.stats.mainMs = performance.now() - t0;
  }

  /** The HUD line. */
  line(): string {
    const s = this.stats;
    if (s.error) return `sim worker: ERROR ${s.error.split("\n")[0]}`;
    if (!s.ready) return "sim worker: starting";
    const parity = s.differ ? `ground mirror OFF at ${s.differ} of ${s.checked} points (worst ${s.worst.toFixed(3)} m at ${s.worstAt})` : `ground mirror ok (${s.checked} points)`;
    return `sim worker: ${s.workerMs.toFixed(2)} ms · lag ${s.lag} frame${s.lag === 1 ? "" : "s"} · ${s.events} events · ${parity} · main ${s.mainMs.toFixed(2)} ms${this.streamer ? ` · terrain: ${this.streamer.remoteStats.inflight} chunks out, copied in ${s.applyMs.toFixed(2)} ms` : ""}`;
  }

  dispose() { this.worker.terminate(); }

  /**
   * The terrain's chunk vertices from now on worked out in the worker: builds and patches go there (each after the
   * ground's changes so far) and come back to the streamer.
   */
  terrain(streamer: TerrainStreamer) {
    this.streamer = streamer;
    streamer.remote = {
      build: (req) => { this.flush(); this.send({ type: "chunk", req }); },
      patch: (req) => { this.flush(); this.send({ type: "patch", req }); },
    };
  }

  private streamer: TerrainStreamer | null = null;
  private frameEvents = 0;
  private applyMs = 0;

  /** The ground's changes so far to the worker (before anything that reads them). */
  private flush() {
    const ground = this.rec.take();
    if (!ground.length) return;
    this.frameEvents += ground.length;
    this.stats.eventsTotal += ground.length;
    this.send({ type: "ground", ground });
  }

  private send(m: ToWorker, transfer: Transferable[] = []) { this.worker.postMessage(m, transfer); }

  private receive(m: FromWorker) {
    const s = this.stats;
    if (m.type === "ready") { s.ready = true; return; }
    if (m.type === "error") { s.error = m.message; console.error("sim worker:", m.message); return; }
    if (m.type === "chunk" || m.type === "patch") {
      // Copied into the chunks' geometry here, between frames: counted as the main thread's share.
      const t0 = performance.now();
      if (m.type === "chunk") this.streamer?.takeBuild(m.res); else this.streamer?.takePatch(m.res);
      this.applyMs += performance.now() - t0;
      return;
    }
    s.answered++;
    s.lag = this.id - m.id;
    s.workerMs = m.ms;
    const e = this.expected.get(m.id);
    if (!e) return;
    const want = e.want;
    this.expected.delete(m.id);
    for (let i = 0; i < want.length; i++) {
      s.checked++;
      if (want[i] === m.heights[i]) continue;
      s.differ++;
      const d = Math.abs(want[i] - m.heights[i]);
      if (d >= s.worst) { s.worst = d; s.worstAt = `(${e.xz[2 * i].toFixed(1)}, ${e.xz[2 * i + 1].toFixed(1)}) frame ${m.id}`; }
      if (!this.warned) { this.warned = true; console.warn(`sim worker: the ground mirror differs from the main thread's by ${d} m at (${e.xz[2 * i].toFixed(1)}, ${e.xz[2 * i + 1].toFixed(1)}), frame ${m.id}; a ground change isn't reaching the worker (src/sim/groundEvents.ts)`); }
    }
  }

  private rnd() { let t = (this.seed = (this.seed + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
}
