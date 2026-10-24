// The baked bandit on the GPU: loads public/models/bandit-vat.* (format: banditVatFormat.ts) and builds one
// instanced mesh whose vertex shader reads each vertex's position and normal for the bandit's frame from the
// animation textures, blending the frame pair and the crossfade between two clips, then places, turns and scales it.
// Per instance (filled by infantryDraw.ts): place + scale, turn (quaternion), current clip rows, previous clip rows,
// and which cloth tint (replacing the cloth mask's colour) with an overall shade.
import * as THREE from "three/webgpu";
import {
  Fn, attribute, instancedBufferAttribute, vertexIndex, uniformArray, floor, textureLoad, ivec2, int, vec3, mix, sign, abs, max, normalLocal, float,
} from "three/tsl";
import type { VatHeader } from "./banditVatFormat";

export interface BanditVatData { header: VatHeader; bin: ArrayBuffer }

export async function loadBanditVat(base = "/models/"): Promise<BanditVatData> {
  const [header, bin] = await Promise.all([
    fetch(`${base}bandit-vat.json`).then((r) => { if (!r.ok) throw new Error(`bandit-vat.json ${r.status}`); return r.json() as Promise<VatHeader>; }),
    fetch(`${base}bandit-vat.bin`).then((r) => { if (!r.ok) throw new Error(`bandit-vat.bin ${r.status}`); return r.arrayBuffer(); }),
  ]);
  return { header, bin };
}

export class BanditVatMesh {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.InstancedBufferGeometry;
  /** Per instance: x, y, z, scale. */
  readonly place: THREE.InstancedBufferAttribute;
  /** Per instance: quaternion. */
  readonly turn: THREE.InstancedBufferAttribute;
  /** Per instance: current clip (row, next row, between, weight of the previous clip). */
  readonly animA: THREE.InstancedBufferAttribute;
  /**
   * Per instance: previous clip (row, next row, between), and look × 4 + shade: which cloth tint (0..3) and an
   * overall brightness (0..2). Packed so the mesh stays within WebGPU's eight vertex buffers.
   */
  readonly animB: THREE.InstancedBufferAttribute;
  /** The four cloth tints, each ÷ the baked cloth colour so the plates come out in that colour. */
  readonly tints = [new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1), new THREE.Color(1, 1, 1)];

  constructor(readonly data: BanditVatData, cap: number) {
    const { header: h, bin } = data, V = h.vertices, F = h.frames, o = h.offsets;
    const posTex = new THREE.DataTexture(new Uint16Array(bin, o.pos, V * F * 4), V, F, THREE.RGBAFormat, THREE.HalfFloatType);
    const nrmTex = new THREE.DataTexture(new Uint8Array(bin, o.normal, V * F * 2), V, F, THREE.RGFormat, THREE.UnsignedByteType);
    for (const t of [posTex, nrmTex]) {
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 1;
      t.needsUpdate = true;
    }

    const g = new THREE.InstancedBufferGeometry();
    const rest = new Float32Array(bin, o.rest, V * 3);
    g.setAttribute("position", new THREE.BufferAttribute(rest, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(V * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("vatColour", new THREE.BufferAttribute(new Float32Array(bin, o.colour, V * 4), 4));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, o.index, h.triangles * 3), 1));
    g.instanceCount = 0;
    this.geometry = g;

    const inst = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.place = inst(4); this.turn = inst(4); this.animA = inst(4); this.animB = inst(4);

    const place = instancedBufferAttribute<"vec4">(this.place), q = instancedBufferAttribute<"vec4">(this.turn);
    const a = instancedBufferAttribute<"vec4">(this.animA), b = instancedBufferAttribute<"vec4">(this.animB);
    const id = int(vertexIndex);
    const pos = (row: THREE.Node<"float">) => textureLoad(posTex, ivec2(id, int(row))).xyz;
    const nrm = (row: THREE.Node<"float">) => {
      const e = textureLoad(nrmTex, ivec2(id, int(row))).xy.mul(2).sub(1);
      const z = float(1).sub(abs(e.x)).sub(abs(e.y));
      const t = max(z.negate(), 0);
      return vec3(e.x.sub(sign(e.x).mul(t)), e.y.sub(sign(e.y).mul(t)), z);
    };
    const rot = (v: THREE.Node<"vec3">) => v.add(q.xyz.cross(q.xyz.cross(v).add(v.mul(q.w))).mul(2));

    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
    mat.positionNode = Fn(() => {
      const p = mix(mix(pos(a.x), pos(a.y), a.z), mix(pos(b.x), pos(b.y), b.z), a.w);
      const n = mix(mix(nrm(a.x), nrm(a.y), a.z), mix(nrm(b.x), nrm(b.y), b.z), a.w);
      normalLocal.assign(rot(n).normalize());
      return rot(p.mul(place.w)).add(place.xyz);
    })();
    const c = attribute<"vec4">("vatColour", "vec4");
    const tints = uniformArray(this.tints, "color");
    const look = floor(b.w.div(4)), shade = b.w.sub(look.mul(4));
    const tint = vec3(tints.element(int(look)) as unknown as THREE.Node<"vec3">);
    mat.colorNode = c.rgb.mul(mix(vec3(1, 1, 1), tint, c.a)).mul(shade);

    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = "bandits";
  }

  set count(n: number) {
    this.geometry.instanceCount = n;
    for (const a of [this.place, this.turn, this.animA, this.animB]) a.needsUpdate = true;
  }
}
