// The sim worker (plan docs/proposal-simworker.md): runs alongside the main thread's drawing. It holds the ground's copy
// (src/sim/groundMirror.ts), kept in step by the main thread's events and sampled for the parity check, and works out
// the terrain chunks' vertices from it (step 2: builds and patches, src/world/chunkFill.ts). Later steps move whole
// systems (escorts, the robot swarm) in here.
import { GroundMirror } from "./groundMirror";
import { chunkArrays, fillChunkRows, patchBlocks } from "../world/chunkFill";
import type { FromWorker, ToWorker } from "./messages";

let ground: GroundMirror | null = null;
let busy = 0;
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  const t0 = performance.now();
  try {
    if (m.type === "init") { ground = new GroundMirror(m.ground); post({ type: "ready" }); return; }
    if (!ground) throw new Error(`${m.type} before init`);
    if (m.type === "ground") ground.apply(m.ground);
    else if (m.type === "chunk") {
      const q = m.req, a = chunkArrays(q.n, q.water);
      fillChunkRows(ground.field, q.cx, q.cz, q.n, q.size, a, 0, q.n + 1);
      const t: Transferable[] = [a.pos.buffer, a.nor.buffer, a.col.buffer, a.hs.buffer];
      if (a.wsA) t.push(a.wsA.buffer);
      post({ type: "chunk", res: { ...a, epoch: q.epoch, seq: q.seq, cx: q.cx, cz: q.cz, n: q.n, size: q.size } }, t);
    } else if (m.type === "patch") {
      const q = m.req, b = q.box, blocks = patchBlocks(ground.field, b[0], b[1], b[2], b[3], q.n, q.size);
      post({ type: "patch", res: { ...q, blocks } }, blocks.flatMap((B) => [B.h.buffer, B.nor.buffer, B.col.buffer, B.ws.buffer]));
    } else if (m.type === "frame") {
      const heights = ground.heights(m.sample);
      busy += performance.now() - t0;
      post({ type: "frame", id: m.id, heights, ms: busy }, [heights.buffer]);
      busy = 0;
      return;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) });
  }
  busy += performance.now() - t0;
};
