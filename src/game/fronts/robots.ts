// The robot front (was the robot swarm lab, Keith 2026-10-24): autonomous terraforming machines swarming across the dunes, in three sizes.
// Most are small four-legged scrappers that scuttle any way: they pour in as a pack, leap onto the mech and cling on,
// tearing at its plating (sparks, scraps of plate, a grinding screech), until shot off, stomped off or shaken off at
// a run; a few hang back and shoot. Medium cutters walk in on four crab legs: some hold at range firing slugs, the
// rest close in, rear back with the saw spinning up and lunge. A few big excavators swing in from the side on four
// long excavator-arm legs, stop at range and fire heavy bursts from high up, and take a lot of killing.
import { robotFootfall } from "../../combat/robotPrints";
import * as THREE from "three/webgpu";
import type { Param } from "../../core/tweaks";
import { RobotSwarm, ROBOT_DEFAULTS, ROBOT_PARAMS, DOWN, LATCHED, BIG, MID, SMALL } from "../../combat/robots";
import { RobotsDraw } from "../../combat/robotsDraw";
import { RobotTarget } from "../../combat/robotTarget";
import { RobotTearFx, ROBOT_TEAR_DEFAULTS, ROBOT_TEAR_PARAMS } from "../../combat/robotTearFx";
import { robotRagdolls } from "../../expedition/ragdolls";
import { StriderLab, STRIDER_LAB_DEFAULTS, STRIDER_LAB_PARAMS, STRIDER_TOPIC } from "../../combat/striderLab";
import { robotDeathSound, wireRobotBlasts } from "../robotBeam";

import { DROID_ALL_DEFAULTS, DROID_PARAMS, DROID_GROUPS } from "../../combat/droids";
import { hook, type Front } from "./front";
import { splashBlast } from "../splash";
import { aggroOnAllies } from "../../summon/allies";

const WAVE_DEFAULTS = {
  robotSwarmSize: 220,
  robotGroupSize: 30,
  robotGroupEvery: 4,
  robotSpawnFrom: 100,
  robotTracerShare: 0.5,
  robotStompReach: 2.6,
  robotDroids: 0,
};
const WAVE_PARAMS: Param[] = [
  { key: "robotSwarmSize", label: "Robots on the field", min: 0, max: 1000, step: 10, group: "Robot waves", tip: "Packs keep coming until this many are up" },
  { key: "robotGroupSize", label: "Pack size", min: 1, max: 200, step: 1, group: "Robot waves" },
  { key: "robotGroupEvery", label: "A pack every (s)", min: 0.2, max: 30, step: 0.1, group: "Robot waves" },
  { key: "robotSpawnFrom", label: "They come from (m)", min: 30, max: 250, step: 5, group: "Robot waves" },
  { key: "robotTracerShare", label: "Share of rounds drawn", min: 0, max: 1, step: 0.01, group: "Robot waves", tip: "Only this share of the small ones' rounds draw a tracer and sound; the rest still hit. Medium ones' slugs always show (big ones lob charges)" },
  { key: "robotDroids", label: "Humanoid robots per pack", min: 0, max: 20, step: 1, group: "Robot waves", tip: "Off by default (Keith 2026-11-01: out of place beside the quads). The middle tier on the human rig walks in with each pack (Humanoid robots topic; their own lab: labs/droids)" },
  { key: "robotStompReach", label: "Stomp reach (m)", min: 0, max: 6, step: 0.1, group: "Robot waves", tip: "A footfall knocks off clingers and crushes small ones this close" },
];

// The player's minigun (and sword) damage × in this lab only (Keith 2026-11-02: "too slow to kill a large walker. Need
// probably 4 times more damage"), so the walkers can be played with; the guns' own values stay as they are elsewhere.
const LAB_GUN_DEFAULTS = { labGunDamage: 4 };
const LAB_GUN_PARAMS: Param[] = [
  { key: "labGunDamage", label: "Your gun damage ×", min: 0.25, max: 10, step: 0.25, group: "Lab: your guns", tip: "This lab only: the mech's minigun rounds (and sword) hit this many times harder" },
];

const SHOT = {
  [SMALL]: { flash: 0.35, hit: 0.3 },
  [MID]: { flash: 0.7, hit: 0.6 },
  [BIG]: { flash: 1.2, hit: 1 },
} as Record<number, { flash: number; hit: number }>;

// Flags: ?robotline puts a frozen line of mixed robots ahead of the mech (scrappers, cutters, an excavator) and stops
// the packs; ?beam, ?pulse, ?lineup, ?quads set pieces; ?swarm=N a big swarm. Striders (the strider lab folded in here,
// Keith 2026-11-01): ?strider=N, ?strider=beam|slam|grab, ?striderdist=m.
export function robotsFront(params0: URLSearchParams): Front {
  let swarm: RobotSwarm | null = null;
  let draw: RobotsDraw | null = null;
  let droidMeshes: THREE.Object3D[] = [];
  let pack: (() => void) | null = null;
  const striders = new StriderLab(params0);
  return {
    spec: {
      defaults: { ...ROBOT_DEFAULTS, ...ROBOT_TEAR_DEFAULTS, ...WAVE_DEFAULTS, ...DROID_ALL_DEFAULTS, ...STRIDER_LAB_DEFAULTS, ...LAB_GUN_DEFAULTS },
      params: [...WAVE_PARAMS, ...ROBOT_PARAMS, ...ROBOT_TEAR_PARAMS, ...DROID_PARAMS, ...STRIDER_LAB_PARAMS, ...LAB_GUN_PARAMS],
      topics: [{ id: "robots", label: "Robots", groups: ["Robot waves", "Robots", "Robots: attack", "Robots: tearing", "Robots: medium", "Robots: big ones", "Robots: beam", "Robots: terraform pulse", "Robots: weapon quads", "Robots: hit parts", "Robots: big weak points", "Robots: big death", "Lab: your guns"] }, { id: "droids", label: "Humanoid robots", groups: DROID_GROUPS }, STRIDER_TOPIC],
      selectables: [{ topic: "robots", label: "Robots", objects: () => (draw ? draw.group.children : []) }, { topic: "droids", label: "Humanoid robots", objects: () => droidMeshes }, striders.selectable],
      actions: [{ label: "Pack now", onClick: () => pack?.() }, ...striders.actions],
      report: () => ({ robots: swarm?.count ?? 0, clinging: swarm?.latchedCount ?? 0, ...striders.report() }),
      onChange: (key) => { if (key === "striderScale") striders.restart(); },
    },
    async start({ lab, contact, droids: shared, summons: allies }) {
      const { V, bf, player, field } = lab;
      striders.attach(lab);
      if (striders.scenario) V.robotSwarmSize = 0;
      // Humanoid robots (the middle tier on the human rig) walk in with each pack (robotDroids, off by default).
      const droids = await shared();
      droidMeshes = droids.meshes;
      const sw = new RobotSwarm(V, field);
      sw.lookGround = bf.lookGround;
      // A dash throws clingers off and bowls over small ones in the way.
      hook(player, "onDash", (x, z, dx, dz) => {
        const r2 = V.dashShoveRadius * V.dashShoveRadius;
        for (let i = 0; i < sw.hi; i++) {
          const st = sw.state[i];
          if (st === LATCHED) { sw.shakeOff(i); continue; }
          if (st >= DOWN || sw.kind[i] !== SMALL) continue;
          const ox = sw.px[i] - x, oz = sw.pz[i] - z;
          if (ox * ox + oz * oz < r2) sw.damage(i, V.dashShoveDamage, dx, dz);
        }
      });
      swarm = sw;
      // ?swarm=N: a big swarm (N on the field, in packs of 60 every 1.5 s), e.g. ?swarm=300&barrage&time=22.
      if (params0.has("swarm")) {
        V.robotSwarmSize = Number(params0.get("swarm")) || 300;
        V.robotGroupSize = 60; V.robotGroupEvery = 1.5;
      }
      // ?still: they stand where they are and only shoot back (the summoner lab's flag, for watching your units work):
      // one pack 25 m ahead, no more coming.
      if (params0.has("still")) {
        V.robotSwarmSize = 0;
        Object.assign(V, { robotRunSpeed: 0, robotMidSpeed: 0, robotQuadSpeed: 0, robotBigSpeed: 0, robotLeapRange: 0, robotShooterShare: 1 });
        const p = player.sim.pos;
        sw.spawn(Math.round(V.robotGroupSize), p.x, p.z + 25, 6, { mid: 0.15, big: 0 });
      }
      const robotLine = params0.has("robotline");
      if (robotLine) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos;
        // ?robotline=m: the line starts m to the side (the gun's muzzle is off the mech's centre) and meets the centre
        // line at ?lmb's distance, so a shot aimed there runs down it.
        const off = Number(params0.get("robotline")) || 0, meet = Number((params0.get("lmb") ?? "").split(",")[1]) || 52;
        const put = (dz: number, dx: number, mid: number, big: number) => { for (const i of sw.spawn(1, p.x + dx + off * (1 - dz / meet), p.z + dz, 0, { mid, big })) sw.setFrozen(i, 1); };
        put(12, 0.4, 0, 0); put(16, -0.3, 0, 0); put(21, 0, 1, 0); put(26, 0.5, 0, 0); put(34, 0, 0, 1); put(44, -0.4, 1, 0); put(50, 0.3, 0, 0);
        // Some off the line, to show what the sheet leaves alone.
        put(18, 5, 0, 0); put(30, -7, 1, 0);
      }
      const d = new RobotsDraw(sw);
      draw = d;
      lab.app.scene.add(d.group);
      const target = new RobotTarget(sw, 3);
      bf.targets.push(target);
      // Hot metal glows (Keith 2026-11-05, src/game/burn.ts).
      d.heatMap = () => { d.heatGlow = (bf.v as { heatGlow?: number }).heatGlow ?? 1; return bf.burns.heatsOf(target); };
      d.chillMap = () => { d.frostLook = (bf.v as { frostLook?: number }).frostLook ?? 1; return bf.chills.chillsOf(target); };
      hook(player, "onStomp", (x, z, k) => sw.stomp(x, z, V.robotStompReach * Math.min(1.5, k)));
      // Deaths go to the physics: the body and its leg parts fall apart loosely (small ones fly, walkers fold where they
      // stand, excavators topple from height).
      robotRagdolls(sw, lab.deaths);
      // Walkers' feet coming down kick up the sand (a bucket a lot, a medium foot a little); latched small ones tear at
      // the plating, medium ones' saws bite.
      sw.onFootfall = robotFootfall(bf, sw);
      // Their deaths, heard (the recorded robot death, src/game/robotBeam.ts).
      robotDeathSound(bf, sw);
      // Big ones lob charges through the battlefield's shells: a ring on the sand where each lands, filling as it comes
      // down, so a dash takes the mech out of it.
      const lobFrom = new THREE.Vector3();
      sw.onLob = (i, fx, fy, fz, x, z, flight) => {
        if (!player.alive) return;
        const l = sw.lobOf(i);
        bf.lob(3, lobFrom.set(fx, fy, fz), x, z, flight, l.arc, l.radius, l.damage);
      };
      // Big ones' beams, terraform pulses, the unstable-core warning and the death blast (the shared hookup, #116):
      // burnt down the line on the battlefield, a scorch and a crack; a dead one's core going up hurts robots too.
      wireRobotBlasts(bf, sw, d.coreWarn, V.robotBeamReach, (x, z, r, sp) => { if (player.alive) player.shoveFrom(x, z, r, sp); });
      // ?beam: no packs, two excavators stopped at range either side of the mech, about to charge (and again every
      // cooldown).
      if (params0.has("beam")) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos;
        sw.spawn(1, p.x - 16, p.z + 18, 0, { mid: 0, big: 1 }).forEach((i) => { sw.primeAttacks(i, 0.3); });
        sw.spawn(1, p.x + 18, p.z + 14, 0, { mid: 0, big: 1 }).forEach((i) => { sw.primeAttacks(i, 2.5); });
      }
      // ?pulse: no packs, one big walker 10 m off, about to beam the ground under it (the terraform pulse; again every
      // cooldown).
      if (params0.has("pulse")) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos;
        sw.spawn(1, p.x + 6, p.z + 8, 0, { mid: 0, big: 1 }).forEach((i) => { sw.primeAttacks(i, 99, 1.5); });
      }
      // ?bigdeath[=s]: no packs, a big walker 12 m off with small ones round its feet, destroyed after s (1 by
      // default): watch its core go unstable and blow, and get clear (Keith 2026-11-02).
      if (params0.has("bigdeath")) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos, at = Number(params0.get("bigdeath")) || 1;
        const [b] = sw.spawn(1, p.x + 4, p.z + 11, 0, { mid: 0, big: 1 });
        sw.setFrozen(b, 1);
        for (const i of sw.spawn(14, p.x + 4, p.z + 11, 6, { mid: 0.2, big: 0 })) sw.setFrozen(i, 1);
        let t = 0;
        lab.onFrame((dt) => { if (t < at && (t += dt) >= at) sw.damage(b, 1e6, 0, 1); });
      }
      // ?quaddeath[=s]: the same with a weapon quad 9 m off (Keith 2026-11-06: its reactor, smaller and sooner).
      if (params0.has("quaddeath")) {
        V.robotSwarmSize = 0;
        // Off by default (Keith 2026-11-06, round 2: only the tall walkers go up); the flag turns it on to look at.
        V.robotQuadDeathOn = 1;
        const p = player.sim.pos, at = Number(params0.get("quaddeath")) || 1;
        const [b] = sw.spawn(1, p.x + 3, p.z + 9, 0, { mid: 1, big: 0, quad: 1, weapon: 0 });
        sw.setFrozen(b, 1);
        let t = 0;
        lab.onFrame((dt) => { if (t < at && (t += dt) >= at) sw.damage(b, 1e6, 0, 1); });
      }
      // ?weak[=still]: no packs, one big walker 28 m ahead coming in (still: frozen there), to shoot its legs off or hit
      // its reactor (Keith 2026-11-06, src/combat/robotWeakPoints.ts): Tab-lock it and point at a leg or the orb on top.
      if (params0.has("weak")) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos, still = params0.get("weak") === "still";
        for (const i of sw.spawn(1, p.x + 2, p.z + 28, 0, { mid: 0, big: 1 })) { if (still) sw.setFrozen(i, 1); sw.primeAttacks(i, 8, 8); }
      }
      // ?lineup: no packs, a frozen row of one of each kind ahead of the mech, for looking at them.
      if (params0.has("lineup")) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos;
        const put = (dx: number, dz: number, mid: number, big: number, quad = 0, weapon = 0) => { for (const i of sw.spawn(1, p.x + dx, p.z + dz, 0, { mid, big, quad, weapon })) sw.setFrozen(i, 1); };
        put(-4, 9, 0, 0); put(-2.5, 10, 0, 0); put(1, 10, 1, 0); put(10, 16, 0, 1);
        for (let w = 0; w < 4; w++) put([9, 15, -9, -15][w], 1, 1, 0, 1, w);
      }
      // ?quads: no packs, one weapon quad of each weapon (minigun, rockets, laser, rail) coming in from ahead.
      if (params0.has("quads")) {
        V.robotSwarmSize = 0;
        const p = player.sim.pos;
        for (let w = 0; w < 4; w++) sw.spawn(1, p.x - 15 + w * 10, p.z + 34, 0, { mid: 1, big: 0, quad: 1, weapon: w });
      }
      const tear = new RobotTearFx(bf.gunFx, bf.sfx, field, V);
      lab.app.scene.add(tear.group);

      const spawnPack = () => {
        const a = Math.random() * Math.PI * 2;
        const p = player.sim.pos;
        sw.spawn(Math.round(V.robotGroupSize), p.x + Math.sin(a) * V.robotSpawnFrom, p.z + Math.cos(a) * V.robotSpawnFrom, 5 + Math.sqrt(V.robotGroupSize));
        if (V.robotDroids >= 1 && !robotLine && !params0.has("beam")) droids.spawn(Math.round(V.robotDroids), p.x + Math.sin(a) * (V.robotSpawnFrom + 8), p.z + Math.cos(a) * (V.robotSpawnFrom + 8));
      };
      pack = spawnPack;

      const aimAt = new THREE.Vector3(), aggroList: number[] = [];
      const from = new THREE.Vector3(), dir = new THREE.Vector3(), bitePos = new THREE.Vector3(), up = new THREE.Vector3(0, -1, 0);
      let packClock = Infinity, slot = 2; // the first pack comes at once
      // Into the register for the soft lock and the weapons: the hub, or a walker's chassis (a cursor among a walker's
      // feet takes its body too).
      bf.register.add(target);
      let lastPrey = "mech";
      let wadeTick = 0;
      return {
        update(dt) {
          player.damageScale = V.labGunDamage;
          packClock += dt;
          if (sw.count < V.robotSwarmSize && packClock >= V.robotGroupEvery) { packClock = 0; spawnPack(); }
          // The swarm goes for the mech, or the pilot on foot when he's nearer to it (src/pilot/quarry.ts); a change of
          // prey shakes the clingers off.
          let cx = 0, cz = 0, n = 0;
          for (let i = 0; i < sw.hi; i++) if (sw.state[i] < DOWN) { cx += sw.px[i]; cz += sw.pz[i]; n++; }
          const prey = n ? lab.prey(cx / n, cz / n) : lab.prey(player.sim.pos.x, player.sim.pos.z);
          if (prey.kind !== lastPrey) for (let i = 0; i < sw.hi; i++) if (sw.state[i] === LATCHED) sw.shakeOff(i);
          lastPrey = prey.kind;
          const p = prey.at;
          // Robots near your summoned units (nearer them than you) turn on them, a share of them (src/summon/allies.ts).
          const units = allies();
          if (units) aggroOnAllies(sw, units, p, V.allyAggro, V.allyAggroShare, aggroList);
          sw.update(dt, { x: p.x, y: p.y, z: p.z, radius: prey.radius, vx: prey.sim.vel.x, vz: prey.sim.vel.z, latchLow: prey.latchLow, latchHigh: prey.latchHigh },
            (fx, fy, fz, tx, ty, tz, kind, ri) => {
              // On one of your units (a companion or scrapper it turned on), the round goes where it aims.
              const own = sw.hasT[ri] === 1;
              if (!own && !prey.alive) return;
              from.set(fx, fy, fz);
              if (!bf.canSee(from, own ? aimAt.set(tx, ty, tz) : p)) return;
              dir.set(tx - fx, ty - fy, tz - fz).normalize();
              const drawn = kind !== SMALL || Math.random() < V.robotTracerShare;
              if (drawn) slot = slot >= 19 ? 2 : slot + 1;
              const damage = sw.shotDamage(ri);
              const look = SHOT[kind];
              bf.fire(slot, 3, from, dir, from.distanceTo(own ? aimAt : p) + 8, damage,
                drawn ? { flashScale: look.flash, voice: "other", hitScale: look.hit } : { tracer: false, voice: "none" });
            },
            (i, damage) => {
              if (sw.hasT[i]) { splashBlast(bf.targets, 3, bitePos.set(sw.px[i], sw.py[i] + 0.4, sw.pz[i]), 1.6, damage, up); return; }
              if (!prey.alive) return;
              prey.unit.damage(damage, bitePos.set(sw.px[i], sw.py[i], sw.pz[i]), up);
              tear.bite(sw.px[i], sw.py[i], sw.pz[i], p.x, p.z);
            },
            (ci, damage, x, y, z) => {
              if (sw.hasT[ci]) { splashBlast(bf.targets, 3, bitePos.set(x, y, z), 1.8, damage, up); return; }
              if (!prey.alive) return;
              // A saw strike: the damage plus a heavier spray of sparks and a torn plate where the blade bites the hull.
              prey.unit.damage(damage, bitePos.set(x, y, z), up);
              tear.bite(x, y, z, p.x, p.z);
              tear.bite(x, y, z, p.x, p.z);
            });
          // Wading: a sixth of the swarm a frame checks for water and leaves rings as it moves.
          if (bf.water) {
            wadeTick = (wadeTick + 1) % 6;
            for (let i = wadeTick; i < sw.hi; i += 6) {
              if (!(sw.state[i] < DOWN)) continue;
              const sp = Math.hypot(sw.vx[i], sw.vz[i]);
              if (sp < 0.3 || Math.random() > sp * dt * 6 / Math.max(0.3, V.wakeEvery)) continue;
              if (bf.inWater(sw.px[i], sw.pz[i])) bf.water.ripple(sw.px[i], sw.pz[i], 0.35, 0.8);
            }
          }
          d.update(dt);
          tear.update(dt);
        },
        touch() {
          contact.robots(sw, target);
          lab.hud("robots", `robots ${sw.count} up · clinging ${sw.latchedCount} · saw strikes ${sw.cuts} · charges ${sw.lobs} · beams ${sw.beams} · destroyed ${target.kills} · hits body ${target.partHits[0]} leg ${target.partHits[1]} foot ${target.partHits[2]} reactor ${target.partHits[3]} · legs shot through ${sw.legsBroken}`);
          const rl = lab.arsenal.last;
          if (rl.railHits !== undefined) lab.hud("rail", `last rail slug: ${rl.railHits} bodies, ${Math.round(rl.rail ?? 0)} damage${rl.railGround ? " · stopped in a dune" : ""}`);
        },
      };
    },
  };
}
