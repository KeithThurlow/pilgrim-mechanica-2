// The mech-down riff (src/audio/mechRiff.ts): one note per item (rarest kept), commons on the root, the run climbing
// and quickening with rarity, the best item's drop sound as the finale after the run.
import { mechRiff, MECH_RIFF_DEFAULTS as V } from "../src/audio/mechRiff";

let bad = 0;
const ok = (c: boolean, msg: string) => { if (!c) { bad++; console.log("FAIL", msg); } };

ok(mechRiff([]) === null, "a mech with nothing on it has no riff");

const commons = mechRiff([0, 0, 0, 0])!;
ok(commons.notes.length === 4 && commons.notes.every((n) => n.semis === 0 && n.voice === "mute"), "commons chug on the root");
ok(commons.finale.tier === 0, "commons end on the common drop");

const many = mechRiff([0, 0, 1, 2, 0, 3, 1, 0, 4, 2])!;
ok(many.notes.length === V.riffNotes, `at most ${V.riffNotes} notes`);
ok(many.finale.tier === 4, "the finale is the best item's");
ok(many.notes[many.notes.length - 1].tier === 4, "the rarest are kept, last");
for (let i = 1; i < many.notes.length; i++) {
  ok(many.notes[i].semis >= many.notes[i - 1].semis, "the run never falls");
  ok(many.notes[i].t > many.notes[i - 1].t, "notes in order");
}
ok(many.finale.t > many.notes[many.notes.length - 1].t, "the finale after the run");

const step = (s: ReturnType<typeof mechRiff>) => s!.notes[1].t - s!.notes[0].t;
const rare = mechRiff([0, 1, 2, 2])!, legend = mechRiff([0, 1, 2, 4])!;
ok(step(legend) < step(rare) && step(rare) < step(commons), "a rarer mech plays a quicker run");
ok(legend.notes[3].semis > rare.notes[3].semis, "a rarer item climbs higher");
ok(mechRiff([2, 2, 2], { ...V, riffNotes: 0 })!.notes.length === 0, "riffNotes 0: only the finale");

if (bad) { console.log(`${bad} failed`); process.exit(1); }
for (const [name, s] of [["commons", commons], ["rare", rare], ["legendary", legend], ["mixed 10", many]] as const)
  console.log(`${name}: ${s.notes.map((n) => `${n.semis}${n.voice[0]}@${n.t.toFixed(2)}`).join(" ")} → tier ${s.finale.tier} at ${s.finale.t.toFixed(2)} s`);
