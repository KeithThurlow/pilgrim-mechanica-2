// The summoner's units on the swarm lab's field (was the summoner lab, Keith 2026-11-02: "the summoner archetype ...
// drones that can fly around the mech and target enemies", docs/proposal-summoner.md). Not an enemy kind: ?summon adds
// them to whichever enemies come. Attack drones orbit the mech and go for the target lock (Tab, or the soft lock under
// the cursor), else the nearest foes, circling them and firing bursts. Companions (mech replicas or weapon quads) walk
// at your flanks; the scrap swarm trails you and bites what comes close, Z throws it at the cursor (or your lock), C
// calls it back. Robots near your units turn on them (the robots front, src/summon/allies.ts).
// Flags: ?drones=N (4), ?companions=replicas|quads|both, ?replicas=N, ?comps=N (turret quads), ?scrappers=N (16),
// ?send (the swarm thrown 30 m ahead at once).
import { typing } from "../../core/input";
import { Summons, SUMMON_DEFAULTS, SUMMON_PARAMS, SUMMON_TOPIC } from "../../summon/summons";
import type { Front } from "./front";

export function summonerFront(q: URLSearchParams, onReady: (s: Summons) => void): Front {
  let summons: Summons | null = null;
  return {
    spec: {
      defaults: { ...SUMMON_DEFAULTS },
      params: [...SUMMON_PARAMS],
      topics: [SUMMON_TOPIC],
      selectables: [{ topic: "summons", label: "Drones, companions and swarm", objects: () => summons?.meshes ?? [] }],
      actions: [{ label: "Send the swarm (Z)", onClick: () => summons?.send() }, { label: "Recall (C)", onClick: () => summons?.recall() }],
      report: (): Record<string, unknown> => ({ drones: summons?.hud() ?? "" }),
    },
    async start({ lab }) {
      const { V, bf, player, field } = lab;
      if (q.has("drones")) V.droneCount = Number(q.get("drones")) || 0;
      // ?companions=replicas|quads|both: which kind walks with you (replicas by default, Keith 2026-11-02).
      { const c = q.get("companions"); if (c === "quads") { V.compCount = 2; V.repCount = 0; } else if (c === "both") { V.compCount = 2; V.repCount = 2; } }
      if (q.has("comps")) V.compCount = Number(q.get("comps")) || 0;
      if (q.has("replicas")) V.repCount = Number(q.get("replicas")) || 0;
      if (q.has("scrappers")) V.swarmCount = Number(q.get("scrappers")) || 0;
      lab.refresh();
      const s = new Summons(bf, lab.app.scene, V, field, player, lab.enemies, lab.deaths, { look: lab.toon });
      summons = s;
      onReady(s);
      // Z sends the swarm (at the lock, else the cursor), C calls it back.
      addEventListener("keydown", (e) => {
        if (typing(e) || e.repeat) return;
        if (e.code === "KeyZ") s.send();
        if (e.code === "KeyC") s.recall();
      });
      const sendAtStart = q.has("send");
      // The demo throws the swarm at the nearest foe every 12 s.
      let demoSend = 0;
      return {
        update(dt) {
          s.update(dt);
          lab.hud("summons", s.hud());
          if (sendAtStart && s.allies.sends === 0 && s.allies.scrappers >= Math.min(8, V.swarmCount)) {
            const h = player.sim.heading; s.allies.sendSwarm(player.sim.pos.x + Math.sin(h) * 30, player.sim.pos.z + Math.cos(h) * 30);
          }
          if (lab.demoOn() && (demoSend += dt) > 12) {
            const p = player.sim.pos, reg = bf.register, e = reg.nearest(p.x, p.z, 120, lab.enemies);
            if (e >= 0) { demoSend = 0; s.allies.sendSwarm(reg.x[e], reg.z[e]); }
          }
        },
      };
    },
  };
}
