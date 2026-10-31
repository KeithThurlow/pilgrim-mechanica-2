// How dangerous an enemy is, for its loot (pure; Keith 2026-10-31: "health pool times DPS", so a thing you have to
// spend time killing is worth killing). Threat = health × damage per second, both read off the enemy's own tuning
// (its base values, before the area level's power: depth already leans rarity and level), so retuning a robot moves
// its loot with it. DPS is nominal: each attack's damage over its cycle, blended by the share of each variant.
// At the defaults: scrapper ~38, bandit ~15, cutter ~1700, excavator ~78000.
import type { RobotValues } from "../combat/robots";
import { BIG, MID } from "../combat/robots";

/** Damage per second of a robot kind (SMALL, BIG, MID), nominal. */
export function robotDps(kind: number, v: RobotValues): number {
  if (kind === BIG) {
    // A volley of robotBigBurst lobs every (burst - 1) × round interval + pause, and the beam every cooldown + charge.
    const volley = (v.robotBigBurst * v.robotBigShotDamage) / Math.max(0.1, (v.robotBigBurst - 1) * v.robotBigRoundInterval + v.robotBigPause);
    const beam = v.robotBeamOn > 0 ? v.robotBeamDamage / Math.max(0.1, v.robotBeamCooldown + v.robotBeamCharge) : 0;
    return volley + beam;
  }
  if (kind === MID) {
    const saw = v.robotMidCutDamage / Math.max(0.1, v.robotMidCutWindup + v.robotMidLungeTime + v.robotMidCutRecover);
    const slug = v.robotMidShotDamage / Math.max(0.1, v.robotMidShotInterval);
    return v.robotMidCutterShare * saw + (1 - v.robotMidCutterShare) * slug;
  }
  const bite = v.robotBiteDamage / Math.max(0.05, v.robotBiteInterval);
  const shot = v.robotShotDamage / Math.max(0.05, v.robotShotInterval);
  return (1 - v.robotShooterShare) * bite + v.robotShooterShare * shot;
}

/** A robot kind's threat: health × DPS. */
export function robotThreat(kind: number, v: RobotValues): number {
  const hp = kind === BIG ? v.robotBigHp : kind === MID ? v.robotMidHp : v.robotHp;
  return Math.max(0, hp) * robotDps(kind, v);
}

/** The guns a camp bandit carries (src/combat/infantry.ts, src/expedition/banditCamps.ts banditDamage). */
export interface BanditThreatValues { hp: number; burstRounds: number; roundInterval: number; burstPause: number; banditDamage: number }

/** A camp bandit's threat: health × a burst's damage over its cycle. */
export function banditThreat(v: BanditThreatValues): number {
  const dps = (v.burstRounds * v.banditDamage) / Math.max(0.1, (v.burstRounds - 1) * v.roundInterval + v.burstPause);
  return Math.max(0, v.hp) * dps;
}
