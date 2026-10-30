// Magazines and reloads (Keith 2026-10-31, docs/proposal-balance.md Answers): munition weapons (guns, launchers) fire
// from a magazine and reload once it's empty. No ammo to carry or buy (Keith 2026-10-27 stands): the reload is the cost.
// Pure; host-owned state of the mech that fires (rule 12: the player's own weapon state, like its aim).
//
// The rule: a trigger's shot takes its rounds × the gun's round cost (1, cut by `cost` Protocols such as Caseless
// rounds) from the magazine. A split shot is one round that splits into fragments (or a missile into sub-missiles), so
// it costs one (Keith 2026-10-31: splits must not drain the magazine); an overclocked tick's extra copies still count. A shot fires whole while any round is left (the last one may overdraw the magazine); at empty the
// gun reloads for its reload time (cut by reload speed: a Quick loader, an Autoloader on the waist, a tree node
// later), then the magazine is full again. The volley launchers (missile pod, mortars) are a magazine of one volley:
// their cooldown is their reload.
// Energy weapons (lasers and the like, later) draw an energy meter instead: `WeaponCost.energy` is the hook.

/** What a weapon spends per shot: magazine rounds (munitions), or energy bars (energy weapons, later). */
export interface WeaponCost {
  /** Magazine rounds per round fired (1 plain). */
  rounds: number;
  /** Energy weapons (later): energy per shot; 0 for every weapon today (a data hook, nothing reads it). */
  energy: number;
}

/** A magazine's state (plain data; a gun record or a launcher carries one). */
export interface Mag {
  /** Rounds it holds when full. */
  size: number;
  /** Rounds left. */
  left: number;
  /** Seconds a reload takes. */
  reload: number;
  /** Seconds of reload left (0: not reloading). */
  reloading: number;
  /** Reloads finished (readouts and checks). */
  reloads: number;
}

export const newMag = (size: number, reload: number): Mag => ({ size: Math.max(1, size), left: Math.max(1, size), reload, reloading: 0, reloads: 0 });

/** Can it fire now (a round left, not reloading)? */
export const magReady = (m: Mag) => m.left > 0 && m.reloading <= 0;

/** Rounds a shot puts out: split rounds × fire-rate copies (a launcher's rockets). */
/** Magazine rounds a shot takes: fire-rate copies only; a split shot is one round that splits (Keith 2026-10-31). */
export const magRounds = (_split = 1, rate = 1) => Math.max(1, Math.round(rate));
export const shotRounds = (split = 1, rate = 1) => Math.max(1, Math.round(split)) * Math.max(1, Math.round(rate));

/**
 * Take a shot of `rounds` at `cost` each: false (and nothing taken) if it can't fire; else the rounds leave the
 * magazine (a shot fires whole while any round is left), and an empty magazine starts its reload.
 */
export function magTake(m: Mag, rounds: number, cost = 1): boolean {
  if (!magReady(m)) return false;
  m.left -= rounds * Math.max(0, cost);
  if (m.left <= 1e-6) { m.left = 0; m.reloading = Math.max(1e-3, m.reload); }
  return true;
}

/** Time passes: a reload counts down and fills the magazine when it's done. */
export function magStep(m: Mag, dt: number) {
  if (m.reloading <= 0) return;
  m.reloading -= dt;
  if (m.reloading <= 0) { m.reloading = 0; m.left = m.size; m.reloads++; }
}

/** Start a reload now (a part-empty magazine; a key, later). */
export function magReload(m: Mag) { if (m.reloading <= 0 && m.left < m.size) m.reloading = Math.max(1e-3, m.reload); }

/** Fill at once (the labs' R, a bay refit). */
export function magFill(m: Mag) { m.left = m.size; m.reloading = 0; }

/** New size and reload (a refit): keeps the share left. */
export function magResize(m: Mag, size: number, reload: number) {
  const k = m.size > 0 ? m.left / m.size : 1;
  m.size = Math.max(1, size); m.reload = reload; m.left = Math.min(m.size, Math.round(m.size * k));
}

/** For a HUD: 0..1 of the magazine left, or (while reloading) 0..1 of the way through the reload. */
export const magShare = (m: Mag) => (m.reloading > 0 ? 1 - m.reloading / Math.max(1e-3, m.reload) : m.left / Math.max(1, m.size));

/**
 * Sustained shots per second from a magazine (the balance sheet and the DPS preview): `size` rounds at `cost` per
 * round, `rounds` per shot, a shot every `gap` s, then `reload` s. Never more than 1 / gap.
 */
export function sustainedRate(size: number, rounds: number, cost: number, gap: number, reload: number): number {
  const per = Math.max(1e-6, rounds * cost);
  const shots = Math.max(1, Math.ceil(size / per - 1e-9));
  // The last shot empties it; the reload starts there and the next magazine's first shot follows it.
  return shots / ((shots - 1) * gap + Math.max(gap, reload));
}
