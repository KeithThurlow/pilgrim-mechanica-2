// The war band front (was the war band lab, Keith 2026-10-24): a raider war band on the dunes. Pickups with machine
// guns and bigger gun trucks circle the mech and make gun runs a few at a time; bandit mechs (red Ramparts) hold off and
// trade fire. Each band beaten brings the next.
// Keith 2026-10-29: the tank is gone (bandits are scrappy salvage): a turret truck carries a salvaged tank turret; and
// a party bus, lit up and blaring music, brakes every so often and lets a wave of bandits out of its back door (the
// bandit swarm, baked Vanguard and all), until it's destroyed.
import * as THREE from "three/webgpu";
import type { Param } from "../../core/tweaks";
import { InfantrySwarm, INFANTRY_DEFAULTS, INFANTRY_PARAMS, DEAD } from "../../combat/infantry";
import { InfantryDraw, BANDIT_LOOK_DEFAULTS, BANDIT_LOOK_PARAMS, CLOTH } from "../../combat/infantryDraw";
import { loadBanditVat } from "../../combat/banditVat";
import { InfantryTarget } from "../../combat/infantryTarget";
import { BANDIT_PARTS, BANDIT_JOINTS } from "../../physics/bodies";
import { MechUnit } from "../mechUnit";
import type { RampartBody } from "../../mech/rampart";
import { Warband, WARBAND_DEFAULTS, WARBAND_PARAMS } from "../../combat/warband";
import { hook, type Front } from "./front";

const RED = 0xc4523f;
// The bus's bandits on foot: their rounds, how many draw a tracer, how far a stomp reaches.
const RIDER_DEFAULTS = { banditDamage: 0.6, riderTracers: 0.15, riderStomp: 2.4 };
const RIDER_PARAMS: Param[] = [
  { key: "banditDamage", label: "Bus bandits: damage per round", min: 0, max: 10, step: 0.05, group: "Party bus" },
  { key: "riderTracers", label: "Bus bandits: share of rounds drawn", min: 0, max: 1, step: 0.01, group: "Party bus" },
  { key: "riderStomp", label: "Bus bandits: stomp reach (m)", min: 0, max: 6, step: 0.1, group: "Party bus" },
];

export function warbandFront(): Front {
  let warband: Warband | null = null;
  let riderDraw: InfantryDraw | null = null;
  let next: (() => void) | null = null;
  return {
    spec: {
      defaults: { ...WARBAND_DEFAULTS, ...INFANTRY_DEFAULTS, ...BANDIT_LOOK_DEFAULTS, ...RIDER_DEFAULTS },
      params: [...WARBAND_PARAMS, ...RIDER_PARAMS, ...INFANTRY_PARAMS, ...BANDIT_LOOK_PARAMS],
      topics: [
        { id: "raiders", label: "Raiders", groups: ["War band", "Raider driving", "Raider guns", "Raider health", "Raider wrecks"] },
        { id: "bus", label: "Party bus", groups: ["Party bus", "Bandits", "Bandits: guns", "Bandits: morale", "Bandits: stomp & bodies", "Bandits: dodge", "Bandits: look"] },
      ],
      selectables: [{
        topic: "raiders", label: "Raiders",
        objects: () => warband ? [...warband.raiders.filter((r) => r.kind !== "partyBus").flatMap((r) => r.body.meshes()), ...warband.mechs.flatMap((m) => (m.body as RampartBody).regions().hull)] : [],
      }, {
        topic: "bus", label: "Party bus and its bandits",
        objects: () => [...(warband ? warband.raiders.filter((r) => r.kind === "partyBus").flatMap((r) => r.body.meshes()) : []), ...(riderDraw ? [riderDraw.mesh] : [])],
      }],
      actions: [{ label: "Next band", onClick: () => next?.() }],
      report: () => ({ band: warband?.waves ?? 0 }),
    },
    async start({ lab, contact }) {
      const { V, bf, toon, player, arsenal } = lab;
      // Bandit mechs: red Ramparts, loaded ahead so a band can field them at once.
      const spare: MechUnit[] = [];
      for (let i = 0; i < 2; i++) {
        const b = await lab.loadRampart();
        const m = new MechUnit(bf, V, b, toon, 2, 20 + i * 2, false);
        m.paint = RED;
        b.paint(toon, RED);
        spare.push(m);
      }
      const wb: Warband = new Warband(bf, V, (): MechUnit | null => spare.find((m) => !wb.mechs.includes(m)) ?? null, lab.deaths);
      warband = wb;
      next = () => wb.spawn(player.sim.pelvis);
      lab.app.scene.add(wb.group);

      // The party bus's bandits: one infantry swarm (seeded), drawn as the baked Vanguard, stomped and dashed through,
      // dying as ragdolls, in the register for the soft lock.
      const riders = new InfantrySwarm(V, lab.field, 41, bf.rules.world);
      wb.riders = riders;
      const vat = await loadBanditVat().catch((e) => { console.warn("bandit bake not loaded, boxes instead:", e); return null; });
      const rd = new InfantryDraw(riders, V, vat);
      rd.cull = lab.bf.view;
      riderDraw = rd;
      lab.app.scene.add(rd.group);
      const riderTarget = new InfantryTarget(riders, 2);
      bf.targets.push(riderTarget);
      rd.chillMap = () => { rd.frostLook = (bf.v as { frostLook?: number } | undefined)?.frostLook ?? 1; return bf.chills?.chillsOf(riderTarget) ?? null; };
      bf.register.add(riderTarget);
      hook(player, "onStomp", (x, z, k) => riders.stomp(x, z, V.riderStomp * Math.min(1.5, k)));
      hook(player, "onDash", (x, z, dx, dz) => { riders.shove(x, z, V.dashShoveRadius, dx, dz, V.dashShove, V.dashShoveDamage); });
      riders.hideDead = true;
      riders.onDeath = (i, nx, nz, speed) => {
        lab.deaths.ragdoll(BANDIT_PARTS(CLOTH[riders.look[i] & 3]), BANDIT_JOINTS, riders.px[i], riders.py[i], riders.pz[i], riders.heading[i],
          { x: riders.vx[i] * 0.3, y: 0, z: riders.vz[i] * 0.3 }, nx, nz, speed);
      };
      const from = new THREE.Vector3(), dir = new THREE.Vector3();
      let slot = 2;

      // Into the register for the soft lock and the weapons: raiders and bandit mechs.
      bf.register.add({ name: "warband", publish: (r) => wb.publish(r) });
      return {
        update(dt) {
          // The band goes for the mech, or the pilot on foot when he's nearer to it (src/pilot/quarry.ts).
          let cx = 0, cz = 0, n = 0;
          for (const r of wb.raiders) if (r.alive) { cx += r.sim.pos.x; cz += r.sim.pos.z; n++; }
          wb.update(dt, n ? lab.prey(cx / n, cz / n) : player);
          // The bus's bandits run at whoever is nearer them and shoot.
          let rx = 0, rz = 0, rn = 0;
          for (let i = 0; i < riders.hi; i++) if (riders.state[i] < DEAD) { rx += riders.px[i]; rz += riders.pz[i]; rn++; }
          const prey = rn ? lab.prey(rx / rn, rz / rn) : lab.prey(player.sim.pos.x, player.sim.pos.z);
          const p = prey.at;
          riders.update(dt, { x: p.x, y: p.y, z: p.z, radius: prey.kind === "pilot" ? 1 : prey.kind === "summon" ? prey.radius + 1 : contact.body.reach }, (fx, fy, fz, tx, ty, tz) => {
            if (!prey.alive) return;
            from.set(fx, fy, fz);
            if (!bf.canSee(from, p)) return;
            dir.set(tx - fx, ty - fy, tz - fz).normalize();
            const drawn = Math.random() < V.riderTracers;
            if (drawn) slot = slot >= 19 ? 2 : slot + 1;
            bf.fire(slot, 2, from, dir, V.fireRange + 5, V.banditDamage, drawn ? { flashScale: 0.35, voice: "other", hitScale: 0.3 } : { tracer: false, voice: "none" });
          });
        },
        touch(dt) {
          riders.dodge(contact.threats(arsenal, bf.shells, V));
          contact.infantry(riders, riderTarget);
          contact.vehicles(wb.raiders, dt);
          rd.update(dt);
          const live = wb.raiders.filter((r) => r.alive).length;
          const buses = wb.raiders.filter((r) => r.kind === "partyBus");
          const busText = buses.map((b) => `${b.alive ? Math.round(b.hp) + " hp" : "wrecked"}, ${b.crew!.alive(riders)} of its ${b.crew!.dropped} out`).join("; ");
          lab.hud("band", `band ${wb.waves} · raiders ${live} live, ${wb.raiders.length - live} wrecked · bandit mechs ${wb.mechs.filter((m) => m.alive).length}${buses.length ? ` · party bus: ${busText}` : ""} · on foot ${riders.count} · rams ${contact.rams}`);
        },
      };
    },
  };
}
