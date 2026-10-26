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
import { GroundWindow } from "./groundWindow";
import type { DentLayer, DentValues } from "../fx/dents";

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
  private uScale = uniform(1);
  private uDark = uniform(0.2);
  private pending: ([number, number, number, number] | null)[] = [];
  readonly stats = { vertices: 0, triangles: 0, texBytes: 0, uploadsThisFrame: 0 };
  /**
   * The ground under the window for GPU effects (src/fx/gpuGround.ts): the chunks' own grid (height, normal) as a
   * texture, the window's first coarse index, the coarse step (m), cells across, and whether it's filled (1) yet.
   */
  readonly gpuGround = {
    tex: texture(new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)),
    origin: uniform(new THREE.Vector2()), step: uniform(1), cells: uniform(4), ready: uniform(0),
  };

  constructor(readonly field: DuneField, readonly streamer: TerrainStreamer, readonly dents: DentLayer, public v: DentValues) {
    this.group.name = "detail patch";
    this.win = this.makeWindow();
    this.build();
    streamer.onRebuild.push((box) => this.pending.push(box));
  }

  private step() { return this.streamer.v.chunkSize / Math.max(1, Math.round(this.streamer.v.segments)); }
  private coverage() { return Math.max(8, this.v.dentCoverage - 4 * this.step()); }
  private makeWindow() { return new GroundWindow(this.field, this.coverage(), this.v.patchSpacing, this.step()); }

  /** (Re)make the mesh and textures for the current window size and spacing. */
  private build() {
    const w = this.win;
    this.key = `${w.step}|${w.sub}|${w.nc}`;
    if (this.mesh) { this.group.remove(this.mesh); this.mesh.geometry.dispose(); }
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

    // A grid of (nf + 1)² vertices whose positions are just their grid indices; the shader places them.
    const n = w.nf, row = n + 1;
    const pos = new Float32Array(row * row * 3), nor = new Float32Array(row * row * 3);
    for (let j = 0, i = 0; j < row; j++) for (let k = 0; k < row; k++, i++) { pos[i * 3] = k; pos[i * 3 + 2] = j; nor[i * 3 + 1] = 1; }
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
    this.stats.vertices = row * row;
    this.stats.triangles = n * n * 2;
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

  private material() {
    const w = this.win, S = w.sub, MF = w.mf, MC = w.mc, NF = w.nf, F = w.fine;
    // One texture node each, every lookup a clone of it, so each texture is one sampler uniform (WebGL 2 allows only
    // 16 in the vertex shader; a fresh node per lookup made a uniform per lookup there).
    const fineT = texture(this.fineTex), coarseT = texture(this.coarseTex), colT = texture(this.colourTex);
    const dents = this.dents, dTex = dents.tex;
    const vN = varyingProperty("vec3", "vPatchN"), vCol = varyingProperty("vec3", "vPatchCol"), vW = varyingProperty("float", "vPatchW");
    // Wrapped grid index (offset half a cell so float rounding in the division can't land on the next cell).
    const wrapI = (i: THREE.Node<"float">, m: number) => int(floor(mod(i.add(0.5), m)));
    const fineAt = (gx: THREE.Node<"float">, gz: THREE.Node<"float">) => textureLoad(fineT, ivec2(wrapI(gx, MF), wrapI(gz, MF))).x;
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
      // Ease to the chunks over the edge band.
      const edgeD = min(min(li, float(NF).sub(li)), min(lj, float(NF).sub(lj))).mul(F);
      const wgt = smoothstep(0, this.uEdge, edgeD);
      const x = gi.mul(F), z = gj.mul(F);
      const p = vec2(x, z);
      // The dents, low-passed to what the lattice can carry (a 3 x 3 binomial one vertex apart).
      let acc: THREE.Node<"float"> = float(0);
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const wt = ((2 - Math.abs(a)) * (2 - Math.abs(b))) / 16;
        acc = acc.add(dentH(p.add(vec2(a * F, b * F))).mul(wt));
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
    mat.colorNode = vCol.mul(this.streamer.shadeNode).mul(float(1).sub(comp.mul(this.uDark)));
    return mat;
  }

  /** Follow the focus: refill what came into view, upload, place the chunks' hole. */
  update(fx: number, fz: number, on: boolean) {
    const v = this.v, mesh = this.mesh!;
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
    for (const b of this.pending) w.invalidate(b);
    this.pending.length = 0;
    w.follow(fx, fz, v.patchBudget);
    this.stats.uploadsThisFrame = 0;
    if (w.version !== this.uploaded) {
      this.fineTex.needsUpdate = this.coarseTex.needsUpdate = this.colourTex.needsUpdate = true;
      this.uploaded = w.version;
      this.stats.uploadsThisFrame = 1;
    }
    this.uFine0.value.set(w.gx * w.sub, w.gz * w.sub);
    this.uCoarse0.value.set(w.gx, w.gz);
    this.gpuGround.origin.value.set(w.gx, w.gz);
    this.gpuGround.ready.value = w.ready ? 1 : 0;
    mesh.visible = w.ready;
    if (w.ready) { const [x0, z0, x1, z1] = w.bounds(); this.streamer.hole.value.set(x0, z0, x1, z1); }
    else this.streamer.hole.value.set(0, 0, 0, 0);
  }

  private makeWindowIfChanged(): GroundWindow | null {
    const st = this.step(), sh = GroundWindow.shape(this.coverage(), this.v.patchSpacing, st);
    return `${st}|${sh.sub}|${sh.nc}` === this.key ? null : this.makeWindow();
  }
}
