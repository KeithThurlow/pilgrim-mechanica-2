// The crusher front (was the crusher lab, Keith 2026-11-01): the heavy crab quad (src/combat/crusher.ts). A wide white carapace on four splayed
// legs; far off it sidles like a crab, near it turns its front on you. The front is a turbine maw ringed with teeth:
// it spins up (blue glow, teeth flaring, red lamps flashing), then sucks: you are pulled toward it and ground at the
// lip. Pincers either side snap at anything close. With nothing to hunt it walks to the salvage heaps and eats them,
// healing. Counterplay: circle out of the cone, sprint out of the pull, shoot into the open maw (double damage).
// Flags: ?count=N (crushers up at once, 1), ?dist=m (where they stand up, 60), ?suck (one 14 m ahead, spinning up at
// once), ?claw (one 7 m off to the side, pincer ready), ?eat (it never hunts you: watch it eat), ?heaps=N (salvage
// heaps round the start, 8).
import * as THREE from "three/webgpu";
import type { Param } from "../../core/tweaks";
import { CRUSHER_DEFAULTS, CRUSHER_PARAMS, SPIN, SUCK, type Crusher, type CrusherFood } from "../../combat/crusher";
import { CrusherField } from "../../combat/crusherField";
import { ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../../combat/robotTearFx";
import type { Front } from "./front";

const LAB_DEFAULTS = { crusherCount: 1, crusherFrom: 60, crusherBack: 8, crusherHeaps: 8, crusherHeapBack: 15 };
const GL = "Crusher lab";
const LAB_PARAMS: Param[] = [
  { key: "crusherCount", label: "Crushers up at once", min: 0, max: 6, step: 1, group: GL },
  { key: "crusherFrom", label: "They stand up at (m)", min: 10, max: 300, step: 5, group: GL },
  { key: "crusherBack", label: "Another after a kill (s)", min: 0, max: 60, step: 1, group: GL },
  { key: "crusherHeaps", label: "Salvage heaps", min: 0, max: 30, step: 1, group: GL },
  { key: "crusherHeapBack", label: "A new heap after one's eaten (s)", min: 1, max: 120, step: 1, group: GL },
];

// Salvage heaps: what it eats. Seeded places round the start (game state); drawn as piles of steel and rust.
interface Heap extends CrusherFood { mesh: THREE.Group }

export function crusherFront(q: URLSearchParams): Front {
  let cf: CrusherField | null = null;
  let spawnNow: (() => void) | null = null, restartNow: (() => void) | null = null;
  return {
    spec: {
      defaults: { ...CRUSHER_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...LAB_DEFAULTS },
      params: [...LAB_PARAMS, ...CRUSHER_PARAMS, ...ROBOT_TEAR_PARAMS],
      topics: [{ id: "crushers", label: "Crushers", groups: [GL, "Crushers", "Crushers: maw", "Crushers: pincers", "Crushers: eating"] }],
      selectables: [{ topic: "crushers", label: "Crushers", objects: () => (cf ? [...cf.bodies.values()].map((b) => b.root) : []) }],
      actions: [{ label: "Crusher now", onClick: () => spawnNow?.() }, { label: "Stand them up again", onClick: () => restartNow?.() }],
      report: (): Record<string, unknown> => (cf ? { crushers: cf.pack.alive, sucks: cf.pack.sucks, claws: cf.pack.claws, clawHits: cf.pack.clawHits, ground: Math.round(cf.pack.ground), eaten: cf.pack.eaten, crusherKills: cf.pack.kills } : {}),
    },
    async start({ lab }) {
      const { V, bf, player, field } = lab;
      if (q.has("count")) V.crusherCount = Number(q.get("count")) || 0;
      if (q.has("dist")) V.crusherFrom = Number(q.get("dist")) || V.crusherFrom;
      if (q.has("heaps")) V.crusherHeaps = Number(q.get("heaps")) || 0;
      if (q.has("eat")) V.crusherHunt = 0;
      const field1 = new CrusherField(V, bf, lab.app.scene, field, player, lab.shake, 1);
      cf = field1;
      const pack = field1.pack, target = field1.target;
      let spawnSeed = 1;
      const spawn = (dist = V.crusherFrom, angle?: number, face?: number): Crusher => {
        const a = angle ?? ((spawnSeed++ * 2.39996) % (Math.PI * 2));
        const p = player.sim.pos;
        const x = p.x + Math.sin(a) * dist, z = p.z + Math.cos(a) * dist;
        return field1.spawn(x, z, face ?? Math.atan2(p.x - x, p.z - z));
      };
      const heaps: Heap[] = [];
      let heapId = 1, heapSeed = 7, heapClock = 0, backClock = 0;
      spawnNow = () => { spawn(); };
      restartNow = () => { for (const c of [...pack.list]) field1.remove(c); backClock = 0; };
      const heapRand = () => { heapSeed = (heapSeed * 16807) % 2147483647; return heapSeed / 2147483647; };
      const STEEL = new THREE.MeshStandardMaterial({ color: 0x6d7074, metalness: 0.6, roughness: 0.5, flatShading: true });
      const RUST = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, metalness: 0.3, roughness: 0.8, flatShading: true });
      const CUBE = new THREE.BoxGeometry(1, 1, 1);
      const addHeap = () => {
        const p = player.sim.pos, a = heapRand() * Math.PI * 2, d = 18 + heapRand() * 45;
        const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d, y = field.height(x, z);
        const mesh = new THREE.Group();
        for (let k = 0; k < 7; k++) {
          const m = new THREE.Mesh(CUBE, k % 3 ? STEEL : RUST);
          const s = 0.5 + heapRand() * 1.1;
          m.scale.set(s * (1 + heapRand()), s * 0.6, s);
          m.position.set((heapRand() - 0.5) * 2.2, s * 0.25 + (k > 4 ? 0.5 : 0), (heapRand() - 0.5) * 2.2);
          m.rotation.set(heapRand() * 0.6, heapRand() * 3, heapRand() * 0.6);
          m.castShadow = true;
          mesh.add(m);
        }
        mesh.position.set(x, y, z);
        lab.app.scene.add(mesh);
        heaps.push({ id: heapId++, x, y, z, mesh });
      };
      for (let k = 0; k < V.crusherHeaps; k++) addHeap();
      const mw = { x: 0, y: 0, z: 0 };
      field1.onAte = (food) => {
        const k = heaps.findIndex((h) => h.id === food);
        if (k >= 0) { lab.app.scene.remove(heaps[k].mesh); heaps.splice(k, 1); }
      };
      field1.onDown = () => { backClock = V.crusherBack; };
      // ?suck: one 14 m ahead of the mech, facing it, spinning up at once. ?claw: one 7 m off to the side, pincer ready.
      if (q.has("suck")) {
        V.crusherCount = Math.max(1, V.crusherCount);
        const c = spawn(14 + V.crusherSize * 0.45, 0);
        c.mode = SPIN; c.modeT = 0;
      }
      if (q.has("claw")) {
        V.crusherCount = Math.max(1, V.crusherCount);
        const a = 0.9, c = spawn(7 + V.crusherSize * 0.45, a, a + Math.PI - 0.9);
        (c as unknown as { suckClock: number }).suckClock = 6;
      }
      return {
        update(dt) {
          backClock -= dt;
          if (pack.alive < V.crusherCount && backClock <= 0) spawn();
          heapClock -= dt;
          if (heaps.length < V.crusherHeaps && heapClock <= 0) { addHeap(); heapClock = V.crusherHeapBack; }
          const c0 = pack.list[0];
          field1.update(dt, lab.prey(c0?.x ?? player.sim.pos.x, c0?.z ?? player.sim.pos.z), heaps);
          const pull = Math.hypot(field1.pull.x, field1.pull.z);
          // A heap being eaten slides up into the maw and shrinks.
          for (const h of heaps) {
            const c = pack.list.find((x) => x.alive && x.food === h.id);
            const k = c ? c.eatShare : 0;
            if (c) c.maw(mw);
            h.mesh.position.set(c ? h.x + (mw.x - h.x) * k * 0.7 : h.x, c ? h.y + (mw.y - 1 - h.y) * k * k * 0.7 : h.y, c ? h.z + (mw.z - h.z) * k * 0.7 : h.z);
            h.mesh.scale.setScalar(1 - k * 0.85);
            if (c && k > 0) h.mesh.rotation.y += dt * k * 4;
          }
          const c = pack.list[0];
          const mode = c ? ["walking", "spinning up", "sucking", "pincer", "eating", "down"][c.mode] : "none up";
          lab.hud("crushers", `crushers ${pack.alive} · ${mode}${c ? ` · ${Math.round(c.health)} hp${c.mode === SUCK || pull ? ` · pull ${pull.toFixed(1)} m/s${c.grinding ? " · GRINDING" : ""}` : ""}` : ""} · sucks ${pack.sucks} · snaps ${pack.claws} (${pack.clawHits} hit) · ground ${Math.round(pack.ground)} · heaps eaten ${pack.eaten} · killed ${pack.kills} · hits shell ${target.partHits[0]} leg ${target.partHits[1]} maw ${target.partHits[2]}`);
        },
      };
    },
  };
}
