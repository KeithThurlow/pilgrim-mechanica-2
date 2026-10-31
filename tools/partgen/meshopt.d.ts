// Types for the meshoptimizer simplifier vendored with three (the parts the part pipeline uses).
declare module "three/addons/libs/meshopt_simplifier.module.js" {
  type Ix = Uint32Array | Int32Array | Uint16Array;
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    simplifyWithAttributes(indices: Ix, pos: Float32Array, posStride: number, attr: Float32Array, attrStride: number,
      weights: number[], lock: Uint8Array | null, target: number, error: number, flags: string[]): [Uint32Array, number];
    simplifySloppy(indices: Ix, pos: Float32Array, posStride: number, lock: Uint8Array | null, target: number, error: number): [Uint32Array, number];
  };
}
