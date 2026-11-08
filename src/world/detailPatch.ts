// The detail patch: a fine mesh (25 cm by default) over the dent window around the camera focus, displaced in its
// vertex shader by the true ground (sampled into GroundWindow on the CPU, refreshed as rows and columns come into
// view) plus the dents (src/fx/dents.ts). The chunks leave a hole for it (TerrainStreamer.hole), in the shadow pass
// too, so it is the only ground drawn there, casting and catching shadows. At its edge it eases back to exactly the
// chunks' triangles (heights, normals and vertex colours from the chunks' own grid), so the seam has nothing to show.
// Detail finer than the patch spacing (berm rims, round dents) comes through per-pixel normals from the dent texture.
import * as THREE from "three/webgpu";
import {
  Fn, uniform, textureLoad, texture, ivec2, int, vec2, vec3, vec4, float, positionLocal, positionWorld, normalLocal, varyingProperty,
  floor, mod, max, min, abs, smoothstep, mix, select, cameraViewMatrix,
} from "three/tsl";
import type { DuneField } from "./terrain";
import type { TerrainStreamer } from "./chunks";
import { GroundWindow, type FineRemote } from "./groundWindow";
import type { DentLayer, DentValues } from "../fx/dents";
import type { GroundHeatTex } from "../fx/groundHeatTex";

export class DetailPatch {
  readonly group = new THREE.Group();
  win: GroundWindow;
  private mesh: THREE.Mesh | null = null;
  private fineTex!: THREE.DataTexture;
  private coarseTex!: THREE.DataTexture;
  private colourTex!: THREE.DataTexture;
  private uploaded = -1;
  private key = "";
  private uFine0 = uniform(new THREE.Vector2());
  private uCoarse0 = uniform(new THREE.Vector2());
  private uEdge = uniform(4);
  /** The focus (world x, z) and the half width the edge blend is measured from, so it glides with the focus. */
  private uFocus = uniform(new THREE.Vector2());
  private uHalf = uniform(1);
  private uScale = uniform(1);
  private uDark = uniform(0.2);
  private pending: { box: [number, number, number, number] | null; dentsOnly: boolean }[] = [];
  readonly stats = { vertices: 0, triangles: 0, texBytes: 0, uploadsThisFrame: 0 };
  /**
   * The ground under the window for GPU effects (src/fx/gpuGround.ts): the chunks' own grid (height, normal) as a
   * texture, the window's first coarse index, the coarse step (m), cells across, the storage size it wraps at (cells
   * plus the lead), and whether it's filled (1) yet.
   */
  readonly gpuGround = {
    tex: texture(new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)),
    origin: uniform(new THREE.Vector2()), step: uniform(1), cells: uniform(4), wrap: uniform(5), ready: uniform(0),
  };

  /** Where the window's fine rows are worked out when not here (the sim worker; GroundWindow.remote). Set before the first update. */
  fineRemote: FineRemote | null = null;
  setFineRemote(r: FineRemote | null) { this.fineRemote = r; this.win.remote = r; }

  constructor(readonly field: DuneField, readonly streamer: TerrainStreamer, readonly dents: DentLayer, public v: DentValues, readonly heat: GroundHeatTex | null = null) {
    this.group.name = "detail patch";
    this.win = this.makeWindow();
    this.build();
    streamer.onRebuild.push((box, dentsOnly = false) => this.pending.push({ box, dentsOnly }));
  }

  /** Coarser with the zoom (Keith 2026-11-08: "it only really needs to be high if the camera is zoomed in"): 0 at
   *  patchSpacing, each level twice the spacing (never coarser than the chunks' own grid) and no denser middle. Only the
   *  vertex grid changes (a cached geometry per level on the same window, textures and material), so switching costs
   *  nothing and shows nothing: rebuilding the window made the ground flash white or vanish (Keith 2026-11-08). */
  zoomLevel = 0;
  private geoms = new Map<number, THREE.BufferGeometry>();
  private uLod = uniform(1);
  private spacing() { return this.v.patchSpacing; }
  /** The level for a camera distance (m), with 10% hysteresis so it doesn't flicker at a threshold. */
  private levelFor(d: number) {
    const v = this.v as DentValues & { patchZoomFrom?: number; patchZoomFar?: number };
    const at = [v.patchZoomFrom ?? 0, v.patchZoomFar ?? 0];
    let n = 0;
    for (let i = 0; i < at.length; i++) {
      if (!(at[i] > 0)) continue;
      const edge = at[i] * (this.zoomLevel > i ? 0.9 : 1.1);
      if (d > edge) n = i + 1;
    }
    return n;
  }
  private step() { return this.streamer.v.chunkSize / Math.max(1, Math.round(this.streamer.v.segments)); }
  private coverage() { return Math.max(8, this.v.dentCoverage - 4 * this.step()); }
  /** Coarse cells sampled ahead of the drawn patch on every side, so ground is ready before it comes into view. */
  private lead() { return Math.max(0, Math.round((this.v.patchLead ?? 6) / this.step())); }
  private makeWindow() {
    const w = new GroundWindow(this.field, this.coverage(), this.spacing(), this.step(), this.lead());
    w.coarseSource = (i, j, out) => this.streamer.vertexAt(i, j, out);
    w.remote = this.fineRemote;
    return w;
  }

  /** (Re)make the mesh and textures for the current window size and spacing. */
  private build() {
    const w = this.win;
    this.key = `${w.step}|${w.sub}|${w.nc}|${w.pad}|${this.fineKey()}`;
    if (this.mesh) this.group.remove(this.mesh);
    for (const t of [this.fineTex, this.coarseTex, this.colourTex]) t?.dispose();
    const tex = (data: Float32Array, n: number, fmt: THREE.PixelFormat) => {
      const t = new THREE.DataTexture(data, n, n, fmt, THREE.FloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.flipY = false;
      t.needsUpdate = true;
      return t;
    };
    this.fineTex = tex(w.fineH, w.mf, THREE.RedFormat);
    this.coarseTex = tex(w.coarse, w.mc, THREE.RGBAFormat);
    this.colourTex = tex(w.colour, w.mc, THREE.RGBAFormat);
    this.stats.texBytes = w.fineH.byteLength + w.coarse.byteLength + w.colour.byteLength;
    this.uploaded = -1;
    this.gpuGround.tex.value = this.coarseTex;
    this.gpuGround.step.value = w.step;
    this.gpuGround.cells.value = w.nc;
    this.gpuGround.wrap.value = w.mc;

    for (const g of this.geoms.values()) g.dispose();
    this.geoms.clear();
    const g = this.geometry(0);
    const mesh = new THREE.Mesh(g, this.material());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.name = "detail patch";
    this.mesh = mesh;
    this.group.add(mesh);
  }

  /** The vertex grid for a zoom level (cached): level 0 the window's own (with its dense middle), each level up every
   *  other line of the one below. Positions are fine-grid indices, so the same material places every level. */
  private geometry(lod: number) {
    const cached = this.geoms.get(lod);
    if (cached) return cached;
    const w = this.win;
    // A grid of vertices whose positions are just their grid indices; the shader places them. Round the focus (the
    // window's middle) the lines come closer, patchFineSub to a ground sample, so foot-sized dents reach the mesh
    // (Keith 2026-11-02: footprints read as painted on at 25 cm); the ground there is interpolated between samples.
    // A plain tensor grid: the dense band runs out to the edges in each direction, no T-junctions.
    const [c0, c1, sub] = lod > 0 ? [0, 0, 1] : this.fineBand();
    const line: number[] = [], every = 2 ** lod;
    for (let k = 0; k <= w.nf; k += every) {
      line.push(k);
      if (k >= c0 && k < c1) for (let q = 1; q < sub; q++) line.push(k + q / sub);
    }
    const n = line.length - 1, row = n + 1;
    const pos = new Float32Array(row * row * 3), nor = new Float32Array(row * row * 3);
    for (let j = 0, i = 0; j < row; j++) for (let k = 0; k < row; k++, i++) { pos[i * 3] = line[k]; pos[i * 3 + 2] = line[j]; nor[i * 3 + 1] = 1; }
    const idx = new Uint32Array(n * n * 6);
    let p = 0;
    // Each cell split like the chunks' (diagonal from (k + 1, j) to (k, j + 1)), so at the edge the triangles lie
    // exactly in the chunks' own.
    for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const a = j * row + k, b = a + 1, c = a + row, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geoms.set(lod, g);
    return g;
  }

  /** The window cells (fine) of the dense middle band, and vertices per fine cell there. */
  private fineBand(): [number, number, number] {
    const w = this.win, sub = Math.max(1, Math.round(this.v.patchFineSub ?? 1));
    const m = Math.min(w.nf, 2 * Math.round(Math.max(0, this.v.patchFineArea ?? 0) / w.fine / 2));
    if (sub <= 1 || m <= 0) return [0, 0, 1];
    return [w.nf / 2 - m / 2, w.nf / 2 + m / 2, sub];
  }
  private fineKey() { return this.fineBand().join(","); }

  private material() {
    const w = this.win, S = w.sub, MF = w.mf, MC = w.mc, NF = w.nf, F = w.fine;
    // One texture node each, every lookup a clone of it, so each texture is one sampler uniform (WebGL 2 allows only
    // 16 in the vertex shader; a fresh node per lookup made a uniform per lookup there).
    const fineT = texture(this.fineTex), coarseT = texture(this.coarseTex), colT = texture(this.colourTex);
    const dents = this.dents, dTex = dents.tex;
    const vN = varyingProperty("vec3", "vPatchN"), vCol = varyingProperty("vec3", "vPatchCol"), vW = varyingProperty("float", "vPatchW");
    // Wrapped grid index (offset half a cell so float rounding in the division can't land on the next cell).
    const wrapI = (i: THREE.Node<"float">, m: number) => int(floor(mod(i.add(0.5), m)));
    const fineAt0 = (gx: THREE.Node<"float">, gz: THREE.Node<"float">) => textureLoad(fineT, ivec2(wrapI(gx, MF), wrapI(gz, MF))).x;
    // Between samples (the dense middle band): bilinear.
    const fineAt = (gx: THREE.Node<"float">, gz: THREE.Node<"float">) => {
      const x0 = floor(gx.add(1e-4)), z0 = floor(gz.add(1e-4));
      const fx = max(gx.sub(x0), 0), fz = max(gz.sub(z0), 0);
      return mix(mix(fineAt0(x0, z0), fineAt0(x0.add(1), z0), fx), mix(fineAt0(x0, z0.add(1)), fineAt0(x0.add(1), z0.add(1)), fx), fz);
    };
    const [B0, B1, SUB] = this.fineBand();
    const cAt = (gx: THREE.Node<"float">, gz: THREE.Node<"float">) => ivec2(wrapI(gx, MC), wrapI(gz, MC));
    // The dents' height (berm - depression) at a world point, faded out toward the dent window's edge.
    const dentFade = (p: THREE.Node<"vec2">) => {
      const d = abs(p.sub(dents.uCentre)).div(dents.uSize.mul(0.5));
      return float(1).sub(smoothstep(0.86, 0.97, max(d.x, d.y)));
    };
    const dentH = (p: THREE.Node<"vec2">) => { const s = texture(dTex, p.div(dents.uSize)); return s.y.sub(s.x); };

    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    mat.positionNode = Fn(() => {
      const li = positionLocal.x, lj = positionLocal.z;
      const gi = this.uFine0.x.add(li), gj = this.uFine0.y.add(lj);
      const h = fineAt(gi, gj);
      // Slope by central differences about half a metre either side (the chunks' normals are spread over their 1 m
      // grid), so sharp crests shade as softly as on the chunks instead of as a hard dashed line; one-sided at the edge.
      const K = Math.max(1, Math.round(0.5 / F));
      const il = max(li.sub(K), 0), ir = min(li.add(K), NF), jl = max(lj.sub(K), 0), jr = min(lj.add(K), NF);
      const hx = fineAt(this.uFine0.x.add(ir), gj).sub(fineAt(this.uFine0.x.add(il), gj)).div(ir.sub(il).mul(F));
      const hz = fineAt(gi, this.uFine0.y.add(jr)).sub(fineAt(gi, this.uFine0.y.add(jl))).div(jr.sub(jl).mul(F));
      // The chunks' triangle here: the coarse cell and where in it.
      const ci = floor(gi.div(S)), cj = floor(gj.div(S));
      const u = gi.sub(ci.mul(S)).div(S), v = gj.sub(cj.mul(S)).div(S);
      const lower = u.add(v).lessThanEqual(1);
      // Corners of the triangle: lower (a, b, c) = (0,0), (1,0), (0,1); upper (d, c, b) = (1,1), (0,1), (1,0).
      const pi = select(lower, ci, ci.add(1)), pj = select(lower, cj, cj.add(1));
      const wa = select(lower, float(1).sub(u).sub(v), u.add(v).sub(1));
      const wb = select(lower, u, float(1).sub(v));
      const wc = select(lower, v, float(1).sub(u));
      const A = cAt(pi, pj), B = cAt(ci.add(1), cj), C = cAt(ci, cj.add(1));
      const ca = textureLoad(coarseT, A), cb = textureLoad(coarseT, B), cc = textureLoad(coarseT, C);
      const coarse = ca.mul(wa).add(cb.mul(wb)).add(cc.mul(wc));
      const col = textureLoad(colT, A).xyz.mul(wa).add(textureLoad(colT, B).xyz.mul(wb)).add(textureLoad(colT, C).xyz.mul(wc));
      // Ease to the chunks over the edge band, measured from the focus itself rather than the window's grid, so the
      // band glides as the focus moves instead of stepping a whole chunk cell at a time (it shimmered at the far edge).
      const x = gi.mul(F), z = gj.mul(F);
      const off = abs(vec2(x, z).sub(this.uFocus));
      const edgeD = min(this.uHalf.sub(max(off.x, off.y)), min(min(li, float(NF).sub(li)), min(lj, float(NF).sub(lj))).mul(F));
      const wgt = smoothstep(0, this.uEdge, edgeD);
      const p = vec2(x, z);
      // The dents, low-passed to what the lattice can carry (a 3 x 3 binomial one vertex apart: closer in the dense
      // middle, where the vertices are).
      const dense = li.greaterThanEqual(B0).and(li.lessThanEqual(B1)).and(lj.greaterThanEqual(B0)).and(lj.lessThanEqual(B1));
      const KD = select(dense.and(this.uLod.lessThan(1.5)), float(F / SUB), this.uLod.mul(F));
      let acc: THREE.Node<"float"> = float(0);
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const wt = ((2 - Math.abs(a)) * (2 - Math.abs(b))) / 16;
        acc = acc.add(dentH(p.add(vec2(KD.mul(a), KD.mul(b)))).mul(wt));
      }
      const dent = acc.mul(this.uScale).mul(dentFade(p));
      const y = mix(coarse.x, h.add(dent), wgt);
      const nF = vec3(hx.negate(), 1, hz.negate()).normalize();
      const n = mix(coarse.yzw.normalize(), nF, wgt).normalize();
      normalLocal.assign(n);
      vN.assign(n);
      vCol.assign(col);
      vW.assign(wgt);
      return vec3(x, y, z);
    })();
    // Per pixel: the dents' slope at full resolution on top of the ground's, and packed ground a little darker.
    const fp = positionWorld.xz;
    const e = max(dents.uTexel.mul(1.5), 0.04);
    const k = this.uScale.mul(dentFade(fp)).mul(vW);
    const gx = dentH(fp.add(vec2(e, 0))).sub(dentH(fp.sub(vec2(e, 0)))).div(e.mul(2)).mul(k);
    const gz = dentH(fp.add(vec2(0, e))).sub(dentH(fp.sub(vec2(0, e)))).div(e.mul(2)).mul(k);
    const nb = vN.normalize();
    const ny = max(nb.y, 0.05);
    const nW = vec3(nb.x.div(ny).sub(gx), 1, nb.z.div(ny).sub(gz)).normalize();
    mat.normalNode = cameraViewMatrix.mul(vec4(nW, 0)).xyz.normalize();
    const comp = texture(dTex, fp.div(dents.uSize)).z.mul(dentFade(fp)).mul(vW);
    const base = vCol.mul(this.streamer.shadeNode).mul(float(1).sub(comp.mul(this.uDark)));
    // Red-hot sand (src/fx/groundHeat.ts): fused sand darker, hot sand glowing.
    mat.colorNode = this.heat ? base.mul(this.heat.dark(fp)) : base;
    if (this.heat) mat.emissiveNode = this.heat.glow(fp).mul(vW);
    return mat;
  }

  /** Follow the focus: refill what came into view, upload, place the chunks' hole. */
  update(fx: number, fz: number, on: boolean, camDist = 0) {
    const v = this.v, mesh = this.mesh!;
    if (camDist > 0) this.zoomLevel = this.levelFor(camDist);
    // Never coarser than the chunks' grid (a fine cell is 1 / sub of it), and only levels that land on the window's edge.
    let lod = 0;
    while (lod < this.zoomLevel && 2 ** (lod + 1) <= this.win.sub && this.win.nf % 2 ** (lod + 1) === 0) lod++;
    const g = this.geometry(lod);
    if (mesh.geometry !== g) mesh.geometry = g;
    this.uLod.value = 2 ** lod;
    this.stats.vertices = g.attributes.position.count;
    this.stats.triangles = (g.index?.count ?? 0) / 3;
    // With the coarse shadow copy of the ground on (src/world/chunks.ts), the patch only catches shadows: its dents are
    // centimetres deep, below what the shadow map can show, and it was 295k triangles in the shadow pass.
    mesh.castShadow = !((this.streamer.v.shadowTerrain ?? 0) > 0.5);
    this.uEdge.value = v.patchEdge;
    this.uScale.value = v.dentScale;
    this.uDark.value = v.dentDark;
    if (!on) { mesh.visible = false; this.streamer.hole.value.set(0, 0, 0, 0); this.gpuGround.ready.value = 0; return; }
    // The chunk grid, the area or the spacing changed: start over.
    const fresh = this.makeWindowIfChanged();
    if (fresh) { this.win = fresh; this.build(); }
    const w = this.win;
    for (const b of this.pending) w.invalidate(b.box, b.dentsOnly);
    this.pending.length = 0;
    w.follow(fx, fz, v.patchBudget);
    this.stats.uploadsThisFrame = 0;
    if (w.version !== this.uploaded) {
      this.fineTex.needsUpdate = this.coarseTex.needsUpdate = this.colourTex.needsUpdate = true;
      this.uploaded = w.version;
      this.stats.uploadsThisFrame = 1;
    }
    this.uFine0.value.set(w.gx * w.sub, w.gz * w.sub);
    // Inside the drawn window wherever the focus is in its centre cell (it's within half a cell of the centre).
    this.uFocus.value.set(fx, fz);
    this.uHalf.value = (w.nc / 2 - 0.5) * w.step;
    this.uCoarse0.value.set(w.gx, w.gz);
    this.gpuGround.origin.value.set(w.gx, w.gz);
    this.gpuGround.ready.value = w.ready ? 1 : 0;
    mesh.visible = w.ready;
    if (w.ready) { const [x0, z0, x1, z1] = w.bounds(); this.streamer.hole.value.set(x0, z0, x1, z1); }
    else this.streamer.hole.value.set(0, 0, 0, 0);
  }

  private makeWindowIfChanged(): GroundWindow | null {
    const st = this.step(), sh = GroundWindow.shape(this.coverage(), this.spacing(), st);
    return `${st}|${sh.sub}|${sh.nc}|${this.lead()}|${this.fineKey()}` === this.key ? null : this.makeWindow();
  }
}
