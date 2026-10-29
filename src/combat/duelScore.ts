// The duel's scoreboard (pure): each round's time to kill and the damage each side dealt, by weapon, so Keith can try
// a loadout against a rival and compare. `hit` is told who was hurt, by which weapon kind and how much.
export type Side = "player" | "rival";

export interface Round {
  /** Who won (null: still going, or restarted before a kill). */
  winner: Side | null;
  start: number;
  end: number;
  /** Damage dealt by the player (to the rival) and taken (from the rival), by weapon kind. */
  dealt: Record<string, number>;
  taken: Record<string, number>;
  /** The rival's loadout seed, for the record. */
  rival?: string;
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export class DuelScore {
  readonly rounds: Round[] = [];
  get current(): Round | null { const r = this.rounds[this.rounds.length - 1]; return r && r.winner === null && r.end === 0 ? r : null; }

  start(t: number, rival?: string) {
    const c = this.current;
    if (c) c.end = t;
    this.rounds.push({ winner: null, start: t, end: 0, dealt: {}, taken: {}, rival });
  }

  hit(victim: Side, kind: string, amount: number, _t: number) {
    const c = this.current;
    if (!c || amount <= 0) return;
    const book = victim === "rival" ? c.dealt : c.taken;
    book[kind] = (book[kind] ?? 0) + amount;
  }

  end(t: number, winner: Side) {
    const c = this.current;
    if (!c) return;
    c.winner = winner; c.end = t;
  }

  /** Wins each way over the finished rounds. */
  tally() {
    let player = 0, rival = 0;
    for (const r of this.rounds) { if (r.winner === "player") player++; else if (r.winner === "rival") rival++; }
    return { player, rival };
  }

  /** Lines for the HUD: this round live, then the last few finished. */
  lines(now: number, max = 4): string[] {
    const out: string[] = [];
    const fmt = (b: Record<string, number>) => Object.entries(b).sort((a, b2) => b2[1] - a[1]).map(([k, x]) => `${k} ${Math.round(x)}`).join(", ") || "—";
    const tl = this.tally();
    out.push(`<b>Rounds</b> you ${tl.player} · rival ${tl.rival}`);
    const c = this.current;
    if (c) out.push(`now ${(now - c.start).toFixed(1)} s · dealt ${Math.round(sum(c.dealt))} (${fmt(c.dealt)}) · taken ${Math.round(sum(c.taken))} (${fmt(c.taken)})`);
    const done = this.rounds.filter((r) => r.winner !== null).slice(-max).reverse();
    for (const r of done) {
      const who = r.winner === "player" ? "you killed it" : "it killed you";
      out.push(`${who} in ${(r.end - r.start).toFixed(1)} s${r.rival ? ` (rival ${r.rival})` : ""} · dealt ${Math.round(sum(r.dealt))} (${fmt(r.dealt)}) · taken ${Math.round(sum(r.taken))} (${fmt(r.taken)})`);
    }
    return out;
  }
}
