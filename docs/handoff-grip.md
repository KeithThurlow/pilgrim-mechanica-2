# Handoff: grip returns with speed (`wip/grip`)

Done, checked, ready to merge (delete this note when it merges).

- `src/mech/walker.ts`: `gripAt(speed, sprinting)` (one grip curve by speed); `walkSteer` steers walk + skid as one at
  that grip and splits the part past the Shift run back into `skid`; update() takes off unsteered skids at the grip;
  `runSteer` / `boundTurnRates` use `gripAt` (unchanged at and past the legs' top).
- `src/mech/walkerTuning.ts`: `gripFullOver` 0, `gripCurve` 2, `gripLetGoOver` 0 (Move); `landFriction` relabelled
  "Skid: least grip".
- Checks: `tools/dash-check.ts` grip block; `tools/convoy-check.ts` landing velocity measures vel + skid 0.1 s in.
- Probe: `npx tsx tools/grip-probe.ts` (`GRIP_SET='{"gripCurve":1}'` to try values).
- Open: the tapped dash's 0.42 s held line has no steering by design (kept per the brief); if Keith still feels a flat
  window after a dash, give the hold grip by speed too.
