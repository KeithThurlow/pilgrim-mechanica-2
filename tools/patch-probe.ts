// Probe: walk the focus north beside the convoy; compare the budgeted patch window with one filled at once every frame
// (both told of the same changes, as the chunks are). Args: speed, budget ms, lead m, 0 to sample the coarse grid instead of copying the chunks'. Differences are rows the patch draws stale.
import { DuneField, TERRAIN_DEFAULTS } from "../src/world/terrain";
import { ConvoyRoute, ROUTE_DEFAULTS } from "../src/convoy/route";
import { GroundWindow } from "../src/world/groundWindow";
import { DENT_DEFAULTS } from "../src/fx/dents";
import { TerrainStreamer, STREAM_DEFAULTS } from "../src/world/chunks";
const V: any = { ...TERRAIN_DEFAULTS, ...ROUTE_DEFAULTS, ...STREAM_DEFAULTS, radius: 2 };
const field = new DuneField(V);
const route = new ConvoyRoute(V, 0, 0);
field.modifier = route;
const cov = DENT_DEFAULTS.dentCoverage - 4;
const w = new GroundWindow(field, cov, DENT_DEFAULTS.patchSpacing, 1, Number(process.argv[4] ?? DENT_DEFAULTS.patchLead));
const ref = new GroundWindow(field, cov, DENT_DEFAULTS.patchSpacing, 1, Number(process.argv[4] ?? DENT_DEFAULTS.patchLead));
// As the labs wire it: the plough's boxes patch the chunks, which tell both windows; the patch copies the chunks' grid.
const streamer = new TerrainStreamer(field, V);
const useChunks = process.argv[5] !== "0";
if (useChunks) w.coarseSource = (i, j, out) => streamer.vertexAt(i, j, out);
streamer.onRebuild.push((b) => { w.invalidate(b); ref.invalidate(b); });
route.onChange = (x0, z0, x1, z1) => { streamer.patchArea(x0, z0, x1, z1); };
streamer.fill(8, -20);
const speed = Number(process.argv[2] ?? 6), budget = Number(process.argv[3] ?? DENT_DEFAULTS.patchBudget);
let viewFrames = 0, ms = 0, worst = 0, badFrames = 0, maxErr = 0, maxQ = 0, fz = -20;
for (let f = 0; f < 600; f++) {
  route.update(1 / 60);
  fz += speed / 60;
  streamer.fill(8, fz); w.follow(8, fz, budget); if (w.stats.viewSamples) viewFrames++; ms += w.stats.ms; ref.follow(8, fz); ref.fillNow();
  maxQ = Math.max(maxQ, w.backlog);
  let bad = 0;
  for (let j = w.gz + 1; j < w.gz + w.nc; j++) {
    let e = 0;
    for (let i = w.gx + 1; i < w.gx + w.nc; i += 3) {
      const x = i * w.step + 0.3, z = j * w.step + 0.6;
      // Coarse against the chunks it must meet at its edge (they too only hear of changes through the plough's boxes),
      // fine against the true ground as of the last change heard.
      const o = new Float32Array(7);
      const ec = streamer.vertexAt(i, j, o) ? Math.abs(w.chunkHeightAt(i * w.step, j * w.step) - o[0]) : 0;
      const ef = Math.abs(w.heightAt(x, z) - ref.heightAt(x, z));
      if (Math.max(ec, ef) > maxErr && process.env.WHERE) console.log(`f${f} ${ec > ef ? "coarse" : "fine"} ${Math.max(ec, ef).toFixed(2)} at row ${j - w.gz} of ${w.nc}, col ${i - w.gx}`);
      e = Math.max(e, ec, ef);
    }
    if (e > 0.1) bad++;
    maxErr = Math.max(maxErr, e);
  }
  if (bad) badFrames++;
  worst = Math.max(worst, bad);
}
console.log(`speed ${speed} m/s, budget ${budget} ms: frames with stale rows ${badFrames}/600, worst ${worst} rows, max error ${maxErr.toFixed(2)} m, max backlog ${maxQ}, frames filling drawn rows at once ${viewFrames}, mean fill ${(ms / 600).toFixed(2)} ms/frame`);
