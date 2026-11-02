// The humanoid robot front (was the humanoid robots lab, Keith 2026-11-01): the robots' middle tier on the human rig,
// between the scuttlers and the big walkers. Squads (troopers, a few tall lancers and big brutes) of white machines
// stride in over the dunes, hold a firing band and fire bursts of blue pulses, each burst told by a red seeking laser
// that lies on you first. They never break; rounds stop on them (metal).
// Flags: ?squad=N (squad size), ?max=N (on the field), ?still (one squad frozen 13 m ahead, for looking).
import type { Param } from "../../core/tweaks";
import { DROID_ALL_DEFAULTS, DROID_PARAMS, DROID_GROUPS } from "../../combat/droids";
import type { DroidSquads } from "../droidFight";
import { hook, type Front } from "./front";

export function droidsFront(q: URLSearchParams): Front {
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const WAVE_DEFAULTS = { droidField: num("max", 18), droidSquad: num("squad", 6), droidEvery: 10, droidFrom: 80 };
  const WAVE_PARAMS: Param[] = [
    { key: "droidField", label: "Robots on the field", min: 0, max: 200, step: 1, group: "Humanoid waves", tip: "Squads keep coming until this many are up" },
    { key: "droidSquad", label: "Squad size", min: 1, max: 40, step: 1, group: "Humanoid waves" },
    { key: "droidEvery", label: "A squad every (s)", min: 1, max: 60, step: 0.5, group: "Humanoid waves" },
    { key: "droidFrom", label: "They come from (m)", min: 20, max: 200, step: 5, group: "Humanoid waves" },
  ];
  let squad: ((at?: { x: number; z: number }) => unknown) | null = null;
  return {
    spec: {
      defaults: { ...DROID_ALL_DEFAULTS, ...WAVE_DEFAULTS },
      params: [...WAVE_PARAMS, ...DROID_PARAMS],
      topics: [{ id: "droids", label: "Humanoid robots", groups: ["Humanoid waves", ...DROID_GROUPS] }],
      actions: [{ label: "Squad now", onClick: () => squad?.() }],
    },
    async start({ lab, droids }) {
      const { V, bf, player } = lab;
      const f: DroidSquads = await droids();
      // A dash rams them flat (they get back up).
      hook(player, "onDash", (x, z, dx, dz) => { if (f.fights.reduce((n, g) => n + g.sw.shove(x, z, V.dashShoveRadius * 1.2, dx, dz, V.dashShove * 0.5, V.dashShoveDamage), 0)) bf.sfx.play("metalHit", player.sim.pelvis, 0.8, 0.7, false); });
      const spawn = (at?: { x: number; z: number }) => {
        const p = player.sim.pos, a = Math.random() * Math.PI * 2;
        const x = at?.x ?? p.x + Math.sin(a) * V.droidFrom, z = at?.z ?? p.z + Math.cos(a) * V.droidFrom;
        return f.spawn(Math.round(V.droidSquad), x, z);
      };
      squad = spawn;
      const still = q.has("still");
      if (still) {
        const p = player.sim.pos;
        for (const m of spawn({ x: p.x + 4, z: p.z + 13 })) f.fights[m.f].sw.frozen[m.i] = 1;
      }
      let clock = Infinity;
      return {
        update(dt) {
          clock += dt;
          if (!still && f.count < V.droidField && clock >= V.droidEvery) { clock = 0; spawn(); }
        },
      };
    },
  };
}
