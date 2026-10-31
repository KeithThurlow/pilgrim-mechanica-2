# Handoff: deathstop (wip/deathstop)

Done: per-owner minigun loops + release/tick (src/audio/minigunAudio.ts), loop watchdog (src/audio/loopWatch.ts, used in sfx.ts),
Arsenal.stop() and the dead-owner guard in Arsenal.step, MechUnit.goCold() on death/reset/getting out, dead units keep stepping
weapons cold, GunStreams.clear(), tools/deathstop-check.ts in npm test. State.md Changes has the causes.
Left: Keith to try duel lab `?rival=3` (kill it mid-fire; die mid-fire with the minigun held); delete this note on merge.
Known gaps: a robot flung (state FLUNG) mid beam charge keeps its charge; enemy mechs make no growl loop (player only).
