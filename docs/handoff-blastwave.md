# Handoff: blast waves (`wip/blastwave`, 2026-10-31)

Keith 2026-10-31: every explosion gets a blast wave / distortion by default, expandable per kind; rockets and missiles
get heat shimmer, the beam too.

**Done:** `src/fx/blastWaves.ts` (pure: `post(kind, x, y, z, radius, {ground, fam})`, `exhaust`, `heat`, `puff`,
merging, caps), `src/fx/blastWavesDraw.ts` (instanced clip-space quads sampling `viewportSharedTexture`, hidden with
nothing live; ground rings; night `hold` light; scene scan for `userData.heat`). Wired: `Battlefield.blast(..., kind)`
(+ `Shell.wave`, default by team), `Arsenal` (rocket, lineMortar, missile, cannon; `get waves()`), `ArsenalDraw`
exhaust, `Battlefield.lightShells` exhaust, warband `blowUp` (death), `robotBeam.ts` release (beam), `robotBeamDraw`
heat, `expedition/loop.ts` far blasts. Sliders in `LOOK_PARAMS`/`LIGHT_GROUPS`. Check `tools/blastwaves-check.ts`
(excluded from tsconfig: uses node:fs).

**Left:** see it in a browser (never rendered or compiled on a GPU). If the bend reads inward instead of outward, or
sits off the blast in WebGL, the screenUV origin is the suspect (`blastWavesDraw.ts` vertexNode `cy`). Robot deaths
have no wave. Not registered with hold-V (transient).

**Test:** `npx tsx tools/blastwaves-check.ts`; robots lab `?barrage&proto=splitter`, `?swarm=300&barrage&time=22`,
`?beam`; weapons lab `?k1=mortar`; off: `?set=waveOn:0`.
