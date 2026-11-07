// What the camera sees this frame, for drawers that build their instances on the CPU every frame (perf 2026-11-07:
// the robot swarm's drawer spent ~1.1 ms a frame on robots off the screen). Updated once a frame by the battlefield;
// sees() tests a sphere. Drawing only: nothing in a sim may read it (rule 12, cosmetic).
import * as THREE from "three/webgpu";

export class ViewCull {
  private readonly f = new THREE.Frustum();
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Sphere();
  /** False until the first update (everything is seen). */
  ready = false;

  update(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.f.setFromProjectionMatrix(this.m, camera.coordinateSystem);
    this.ready = true;
  }

  /** Is a sphere at (x, y, z) of radius r (m) in view? */
  sees(x: number, y: number, z: number, r: number): boolean {
    if (!this.ready) return true;
    this.s.center.set(x, y, z); this.s.radius = r;
    return this.f.intersectsSphere(this.s);
  }
}
