// The summoner's units on the swarm lab's field (was the summoner lab, Keith 2026-11-02: "the summoner archetype ...
// drones that can fly around the mech and target enemies", docs/proposal-summoner.md). Not an enemy kind: ?summon adds
// them to whichever enemies come. Attack drones orbit the mech and go for the target lock (Tab, or the soft lock under
// the cursor), else the nearest foes, circling them and firing bursts. Companions (mech replicas or weapon quads) walk
// at your flanks; the scrap swarm trails you and bites what comes close, Z throws it at the cursor (or your lock), C
// calls it back. Robots near your units turn on them (the robots front, src/summon/allies.ts).
// Flags: ?drones=N (4), ?companions=replicas|quads|both, ?replicas=N, ?comps=N (turret quads), ?scrappers=N (16),
// ?send (the swarm thrown 30 m ahead at once), ?summoner (the summoner gear fitted: drone rack on key 1, swarm hive on key
// 2, replica bay on the pack; counts from the items), ?dismissat=s (dismissed s in, as at a convoy pickup, summoned again
// 30 s later).
import { typing } from "../../core/input";
import { Summons, SUMMON_DEFAULTS, SUMMON_PARAMS, SUMMON_TOPIC } from "../../summon/summons";
import { applyGear, isSwarmKey } from "../../summon/gear";
import { resolve, type Resolved } from "../../items/loadout";
import { loadoutFor, pickFromParams, type Pick } from "../../items/weaponPick";
import type { Front } from "./front";

/** Does the URL fit summoner gear (?summoner, or drones/hive on a shoulder key, or the replica bay)? */
export function summonGearInUrl(q: URLSearchParams): boolean {
  return q.has("summoner") || ["k1", "k2"].some((k) => q.get(k) === "drones" || q.get(k) === "hive") || q.get("k3") === "replicas";
}

export function summonerFront(q: URLSearchParams, onReady: (s: Summons) => void): Front {
  let summons: Summons | null = null;
  return {
    spec: {
      defaults: { ...SUMMON_DEFAULTS },
      params: [...SUMMON_PARAMS],
      topics: [SUMMON_TOPIC],
      selectables: [{ topic: "summons", label: "Drones, companions and swarm", objects: () => summons?.meshes ?? [] }],
      actions: [{ label: "Dismiss / summon", onClick: () => summons?.setActive(!summons.active), active: () => !!summons && !summons.active }, { label: "Send the swarm (Z)", onClick: () => summons?.send() }, { label: "Recall (C)", onClick: () => summons?.recall() }],
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
      // Summoner gear (Keith 2026-11-02): ?summoner (or ?k1=drones|hive, ?k2=drones|hive, ?k3=replicas) fits the items
      // (the combat lab fits them on the mech), and the summons' counts come from them instead of the sliders; a swarm
      // hive's key (1 or 2) throws and recalls the swarm.
      let gear: Resolved | null = null;
      {
        const pick: Pick = { left: "minigun", right: "minigun", k1: "none", k2: "none", k3: "pack" };
        if (pickFromParams(pick, q)) {
          const r = resolve(loadoutFor(pick));
          if (r.summons.replicas + r.summons.drones + r.summons.scrappers > 0) { gear = r; applyGear(V, r); }
        }
      }
      // ?dismissat=s: dismissed s seconds in (as a convoy pickup), summoned again 30 s later.
      const dismissAt = q.has("dismissat") ? Number(q.get("dismissat")) || 10 : -1;
      let clock = 0;
      lab.refresh();
      const s = new Summons(bf, lab.app.scene, V, field, player, lab.enemies, lab.deaths, { look: lab.toon });
      summons = s;
      onReady(s);
      // Z sends the swarm (at the lock, else the cursor), C calls it back.
      addEventListener("keydown", (e) => {
        if (typing(e) || e.repeat) return;
        if (e.code === "KeyZ") s.send();
        if (e.code === "KeyC") s.recall();
        if (gear && (e.code === "Digit1" || e.code === "Digit2") && isSwarmKey(gear, e.code === "Digit1" ? 1 : 2)) s.sendOrRecall();
      });
      const sendAtStart = q.has("send");
      // The demo throws the swarm at the nearest foe every 12 s.
      let demoSend = 0;
      return {
        update(dt) {
          clock += dt;
          if (dismissAt >= 0) s.setActive(!(clock >= dismissAt && clock < dismissAt + 30));
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
