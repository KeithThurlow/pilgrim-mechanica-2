// Faked lamp light (Keith 2026-10-29: more lights at night without the frame cost): four instanced additive meshes,
// one draw call each however many lamps there are. Cosmetic.
// - glows: soft camera-facing sprites on the lamp heads;
// - pools: soft ellipses on the ground (or deck) where a beam lands, stretched by how low the beam comes in;
// - beams: faint open cones from the lamp to its pool, brightest at the lamp, fading to nothing where they land;
// - lines: glowing ribbons along a segment, turned to face the camera round their axis (gun streams' tubes).
// Unfogged (fog would add the haze colour to every quad), so far lamps are faded by the caller instead.
// Real lights are nightLights.ts's job; this only draws.
import * as THREE from "three/webgpu";

export const GLOW_MAX = 1024, POOL_MAX = 1024, BEAM_MAX = 640, LINE_MAX = 128;

/** A radial falloff texture (linear values): core 0..1 sharp for glows, soft for pools. */
function radial(core: number, power: number): THREE.DataTexture {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1, r = Math.min(1, Math.hypot(x, y));
    const halo = Math.pow(1 - r, power), c = core > 0 ? Math.exp(-(r * r) / (core * core)) : 0;
    const v = Math.round(255 * Math.min(1, halo * 0.6 + c));
    data.set([v, v, v, 255], (j * N + i) * 4);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A tube's cross-section (u: a bright core in a soft halo) with its ends faded (v: 0 at the muzzle, 1 at the far end). */
function tubeTexture(): THREE.DataTexture {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, v = (j + 0.5) / N;
    const across = Math.exp(-(x * x) / 0.012) + 0.45 * Math.pow(Math.max(0, 1 - Math.abs(x)), 2.2);
    const ends = Math.min(1, v / 0.06) * Math.min(1, (1 - v) / 0.12);
    const c = Math.round(255 * Math.min(1, across * ends));
    data.set([c, c, c, 255], (j * N + i) * 4);
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function additive(map: THREE.Texture | null, vertexColors = false, side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshBasicMaterial({
    map, vertexColors, side, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  });
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.name = name;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = m.receiveShadow = false;
  return m;
}

/** An open cone, apex at the origin, base radius 1 at z = 1; vertex colour fades from the apex to the base. */
function coneGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.04, 1, 1, 18, 6, true);
  g.translate(0, -0.5, 0); // apex (top) at y = 0, base at y = -1
  g.rotateX(-Math.PI / 2); // y -> z: base at z = +1
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getZ(i)));
    const c = Math.pow(1 - t, 1.4) * Math.min(1, t * 8 + 0.25);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export class LampDraw {
  readonly group = new THREE.Group();
  readonly glows: THREE.InstancedMesh;
  readonly pools: THREE.InstancedMesh;
  readonly beams: THREE.InstancedMesh;
  readonly lines: THREE.InstancedMesh;
  private nG = 0; private nP = 0; private nB = 0; private nL = 0;
  private m = new THREE.Matrix4();
  private x = new THREE.Vector3(); private y = new THREE.Vector3(); private z = new THREE.Vector3();
  private p = new THREE.Vector3(); private s = new THREE.Vector3();
  private camQ = new THREE.Quaternion(); private camP = new THREE.Vector3();

  constructor() {
    this.group.name = "lamp glows";
    const pool = new THREE.PlaneGeometry(2, 2); pool.rotateX(-Math.PI / 2);
    this.glows = instanced(new THREE.PlaneGeometry(1, 1), additive(radial(0.12, 2.2)), GLOW_MAX, "lamp glows");
    this.pools = instanced(pool, additive(radial(0, 1.6)), POOL_MAX, "lamp pools");
    this.beams = instanced(coneGeometry(), additive(null, true, THREE.DoubleSide), BEAM_MAX, "lamp beams");
    // A unit ribbon: x across (-0.5..0.5), z along (0..1), its texture's v along it.
    const line = new THREE.PlaneGeometry(1, 1); line.rotateX(-Math.PI / 2); line.translate(0, 0, 0.5);
    const uv = line.attributes.uv, lp = line.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, lp.getZ(i));
    this.lines = instanced(line, additive(tubeTexture(), false, THREE.DoubleSide), LINE_MAX, "lamp lines");
    this.pools.renderOrder = 1; this.beams.renderOrder = 2; this.lines.renderOrder = 3; this.glows.renderOrder = 4;
    this.group.add(this.pools, this.beams, this.lines, this.glows);
  }

  /** Start a frame: sprites face this camera (or a fixed high view without one). */
  begin(camera: THREE.Camera | null) {
    this.nG = this.nP = this.nB = this.nL = 0;
    if (camera) { camera.getWorldQuaternion(this.camQ); camera.getWorldPosition(this.camP); }
    else { this.camQ.setFromEuler(new THREE.Euler(-0.87, 0, 0)); this.camP.set(0, 1e4, 1e4); }
  }

  /** A glow sprite of diameter size at (x, y, z), colour (r, g, b) (linear, brightness folded in). */
  glow(x: number, y: number, z: number, size: number, r: number, g: number, b: number) {
    if (this.nG >= GLOW_MAX || size <= 0) return;
    // Pulled toward the camera so the lamp's own housing doesn't cut it in half.
    this.p.set(x, y, z);
    this.z.copy(this.camP).sub(this.p).normalize();
    this.p.addScaledVector(this.z, Math.min(0.6, size * 0.5));
    this.m.compose(this.p, this.camQ, this.s.set(size, size, size));
    this.put(this.glows, this.nG++, r, g, b);
  }

  /**
   * A pool at (x, y, z) on a surface with normal n, stretched along the horizontal beam direction (hx, hz):
   * half-width w across, half-length l along.
   */
  pool(x: number, y: number, z: number, nx: number, ny: number, nz: number, hx: number, hz: number, w: number, l: number, r: number, g: number, b: number) {
    if (this.nP >= POOL_MAX || w <= 0) return;
    this.y.set(nx, ny, nz).normalize();
    this.z.set(hx, 0, hz);
    this.z.addScaledVector(this.y, -this.z.dot(this.y));
    if (this.z.lengthSq() < 1e-6) this.z.set(0, 0, 1).addScaledVector(this.y, -this.y.z);
    this.z.normalize();
    this.x.crossVectors(this.y, this.z).normalize();
    this.m.makeBasis(this.x.multiplyScalar(w), this.y, this.z.multiplyScalar(l));
    this.m.setPosition(x + nx * 0.12, y + ny * 0.12, z + nz * 0.12);
    this.put(this.pools, this.nP++, r, g, b);
  }

  /** A beam cone from (x0, y0, z0) to (x1, y1, z1), radius rad at the far end. */
  beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rad: number, r: number, g: number, b: number) {
    if (this.nB >= BEAM_MAX || rad <= 0) return;
    this.z.set(x1 - x0, y1 - y0, z1 - z0);
    const len = this.z.length();
    if (len < 0.05) return;
    this.s.copy(this.z).divideScalar(len);
    this.x.set(0, 1, 0).cross(this.s);
    if (this.x.lengthSq() < 1e-6) this.x.set(1, 0, 0);
    this.x.normalize();
    this.y.crossVectors(this.s, this.x).normalize();
    this.m.makeBasis(this.x.multiplyScalar(rad), this.y.multiplyScalar(rad), this.z);
    this.m.setPosition(x0, y0, z0);
    this.put(this.beams, this.nB++, r, g, b);
  }

  /** A glowing line from (x0..) to (x1..), this wide, facing the camera round its axis. */
  line(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, r: number, g: number, b: number) {
    if (this.nL >= LINE_MAX || width <= 0) return;
    this.z.set(x1 - x0, y1 - y0, z1 - z0);
    const len = this.z.length();
    if (len < 0.05) return;
    this.s.copy(this.z).divideScalar(len);
    // Across: square to the line and to the way to the camera (from its middle).
    this.y.set(this.camP.x - (x0 + x1) / 2, this.camP.y - (y0 + y1) / 2, this.camP.z - (z0 + z1) / 2);
    this.x.crossVectors(this.s, this.y);
    if (this.x.lengthSq() < 1e-8) this.x.set(1, 0, 0).cross(this.s);
    this.x.normalize();
    this.y.crossVectors(this.s, this.x).normalize();
    this.m.makeBasis(this.x.multiplyScalar(width), this.y, this.z);
    this.m.setPosition(x0, y0, z0);
    this.put(this.lines, this.nL++, r, g, b);
  }

  private put(mesh: THREE.InstancedMesh, i: number, r: number, g: number, b: number) {
    mesh.setMatrixAt(i, this.m);
    const a = mesh.instanceColor!.array as Float32Array;
    a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b;
  }

  /** End a frame: upload what was drawn. */
  end() {
    for (const [mesh, n] of [[this.glows, this.nG], [this.pools, this.nP], [this.beams, this.nB], [this.lines, this.nL]] as const) {
      const was = mesh.count;
      mesh.count = n;
      if (n || was) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
    }
  }

  get counts() { return { glows: this.nG, pools: this.nP, beams: this.nB, lines: this.nL }; }
}
