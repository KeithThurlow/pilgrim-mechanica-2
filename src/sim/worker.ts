// The sim worker (plan docs/proposal-simworker.md): runs alongside the main thread's drawing. Step 1 holds only the
// ground's copy (src/sim/groundMirror.ts), kept in step by the main thread's events and sampled for the parity check;
// later steps move whole systems (terrain building, escorts, the robot swarm) in here.
import { GroundMirror } from "./groundMirror";
import type { FromWorker, ToWorker } from "./messages";

let ground: GroundMirror | null = null;
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.type === "init") { ground = new GroundMirror(m.ground); post({ type: "ready" }); return; }
    if (m.type === "frame") {
      const t0 = performance.now();
      if (!ground) throw new Error("frame before init");
      ground.apply(m.ground);
      const heights = ground.heights(m.sample);
      post({ type: "frame", id: m.id, heights, ms: performance.now() - t0 }, [heights.buffer]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) });
  }
};
