// Upload only the used part of instanced buffers (perf, Keith 2026-11-06: the convoy lab sent ~6 MB of instance data
// a frame because every pool's whole capacity went up whenever it changed, e.g. 488 of 12288 instances; writeBuffer
// was 9% of a frame on his PC). Before each render, any instanced mesh's per-instance attribute that changed since
// the last frame, with no update range of its own (code that sets its own ranges is left alone), gets one range
// covering the instances in use. Until three uploads it (and clears the range) the range only grows, so an
// instance written while the mesh was off screen still goes up when it's next drawn. Instances past `count` are not
// drawn, so what the GPU draws is the same.
import * as THREE from "three/webgpu";

const seen = new WeakMap<THREE.BufferAttribute, number>();
/** Ranges this pass set and three hasn't uploaded yet: the end (in array elements). */
const mine = new WeakMap<THREE.BufferAttribute, number>();
const stats = { trimmed: 0, savedKB: 0 };

function trim(a: THREE.BufferAttribute, count: number) {
  const v = a.version, was = seen.get(a);
  seen.set(a, v);
  const pending = mine.get(a);
  if (pending !== undefined && a.updateRanges.length === 0) mine.delete(a); // uploaded since
  if (was === undefined || was === v) return;
  if (a.updateRanges.length && !mine.has(a)) return; // the code set its own range
  const end = Math.min(a.array.length, Math.max(mine.get(a) ?? 0, count * a.itemSize));
  if (end >= a.array.length) { if (mine.has(a)) { a.clearUpdateRanges(); mine.delete(a); } return; } // all of it anyway
  a.clearUpdateRanges();
  a.addUpdateRange(0, Math.max(a.itemSize, end));
  mine.set(a, end);
  stats.trimmed++;
  stats.savedKB += ((a.array.length - end) * (a.array as Float32Array).BYTES_PER_ELEMENT) / 1024;
}

/** Call once a frame before rendering: trims the visible instanced meshes' uploads. */
export function trimInstanceUploads(scene: THREE.Object3D) {
  stats.trimmed = 0; stats.savedKB = 0;
  scene.traverseVisible((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    trim(m.instanceMatrix, m.count);
    if (m.instanceColor) trim(m.instanceColor, m.count);
    const g = m.geometry;
    for (const k in g.attributes) {
      const a = g.attributes[k] as THREE.InstancedBufferAttribute;
      if (a.isInstancedBufferAttribute && !(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) trim(a, m.count);
    }
  });
  return stats;
}
