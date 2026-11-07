// Hidden things don't update their matrices (perf, 2026-11-07; docs/engine-options.md A.2). three walks the whole scene
// graph every frame (updateMatrixWorld), hidden or not: in the convoy siege about a third of its ~4,000 objects sat in
// hidden pools (effects, beams, unused kit). Here a hidden object and everything under it skip the walk; it marks
// itself so the frame it shows again it recomputes, and its children with it, before anything draws.
// Code that needs a hidden object's place asks for it (getWorldPosition and friends update their own chain), so only
// a direct read of a hidden object's .matrixWorld would see an old value. ?allmatrices turns this off to compare.
import * as THREE from "three/webgpu";

let installed = false;

export function skipHiddenMatrices(on: boolean) {
  if (!on || installed) return;
  installed = true;
  const own = THREE.Object3D.prototype.updateMatrixWorld;
  THREE.Object3D.prototype.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    if (!this.visible) { this.matrixWorldNeedsUpdate = true; return; }
    own.call(this, force);
  };
}
