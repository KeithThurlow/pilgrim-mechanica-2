# Handoff: the coordinator (2026-10-31)

Keith is moving the work from one long chat into a Claude project. This note lets a fresh coordinator pick up where
the old one left off. Read `CLAUDE.md` (the rules) and `state.md` (every system, In progress, Changes) first; this
note covers what those don't: how the coordinating works, what's waiting on Keith, and what's next.

## What the coordinator does

- Turns Keith's asks into short agent briefs, picks the model (rule 14: Opus for anything with a visual or feel
  intent and for specs; Sonnet for code from a clear spec), merges finished branches to `main`, and reports back to
  Keith in plain words: what changed, the numbers, the lab URLs to try, rough edges.
- Logs every ask in `docs/decisions.md` (Keith's calls as his) and keeps `state.md` In progress current.
- Propose before big new systems (rule 9); small asks and fixes go straight to an agent.

## Working setup (cloud container)

- Repo at `/home/claude/pilgrim-mechanica-2` (GitHub `KeithThurlow/pilgrim-mechanica-2`, branch `main`). The old
  Unity project is cloned at `/home/claude/pilgrim-mechanica` (reference only: animations, the Blender kit, old docs).
- `node_modules` is a symlink to `/home/claude/vendor` (gitignored; never commit it: it broke Keith's Windows pull
  once). Shared type links live in `/home/claude/node_modules` (`@types/three`, `@dimforge/rapier3d-compat`); if
  they vanish, recreate them pointing into `/home/claude/vendor`.
- Typecheck: `npx tsc --noEmit -p . --preserveSymlinks`. Checks: `npm test` (about 2-4 minutes; run it once per
  merge, in a background-safe way, e.g. redirect to a log and grep for `fail`). There's no browser here: nothing can
  be seen, so Keith's play is the first real test of anything visual.
- Spawn agents with the shell's working directory inside the repo, or worktree creation fails.
- Agents work in worktrees, push WIP to `wip/<topic>`, keep `docs/handoff-<topic>.md`, and never push to main.

## Merging a finished agent

1. `git fetch -q origin +refs/heads/main:refs/remotes/origin/main && git merge -q --ff-only origin/main`
   (the explicit refspec keeps `origin/main` fresh; a stale ref made the stop hook report "unpushed" commits).
2. `git merge --no-edit worktree-agent-<id>`. If that branch has no new commits, the agent may have committed only
   to `wip/<topic>`: fetch `refs/heads/wip/<topic>` and merge `origin/wip/<topic>` instead.
3. Conflicts are almost always `state.md` and `docs/decisions.md` (everyone adds to the top of Changes, In progress
   and the decisions table). Keep both sides: new Changes entries above older ones, decision rows from both, and
   rewrite the agent's In progress line to "merged <date>, Keith to try <URLs>". `package.json`'s `test` line also
   conflicts when two agents add checks: keep every check.
4. Delete the agent's `docs/handoff-<topic>.md`, typecheck, full `npm test`, commit (the attribution lines in the
   commit message), push to `origin main`, refresh the tracking ref.
5. Agents sometimes repeat their hand-back after finishing; once merged, stop them (TaskStop).
- Force pushes and deleting remote branches are blocked from here: Keith deletes merged `wip/*` branches on GitHub.
- `robots-check` timing can fail under load (flaky); rerun before chasing it.

## Awaiting Keith's play (built 2026-10-28 to 31, mostly never run in a browser)

Movement and feel (played, good: "massive improvement"): responsive walk, crisp dash, grip by speed, lean,
trample ("awesome"). In flight: the dash exit (`wip/dashexit`, merge it first).

Not yet played or only glanced at:
- Duel lab: rival levels (`?rivallevel=`), `?rivalup=N`, dodge as a chance, steady painted aim, rail vs dash rule.
- Combat: balance pass 2 (armour, pierce, magazines, multiplying Protocols, DPS preview, health bars), shoulder
  gear (feeds, incendiary, capacitor), clip-fed rockets and the channelled arm missile pod, line mortar band,
  14 m mortar, robot danger and the excavator charging beam, party bus and turret trucks, bandit dive rolls.
- Looks at night: night lights, rocket and tracer lights, tube lights on gun streams, enemy lights, lit telegraphs,
  blast waves (never compiled on a GPU: `?set=waveOn:0` if it breaks), day-night cycle (blue hour muddy).
- The loop: factions in the convoy lab (`?clash`, `?warband`, `?banditcamp`), extraction pads and convoy unlocks
  (`?pad=60&unlock=all`), loot feel and loot sounds, depth danger and salvage heat.
- Frame time at night with everything firing (`labs/robots/?swarm=300&barrage&time=22&proto=splitter`) is the
  number most wanted from Keith's PC.

## Open questions for Keith

- Progression (`docs/proposal-progression.md`): the progression currency's name (Survey suggested); one tree for
  the mech or also a pilot tree; respec cost; build a first drone bay with the tree's drone region; the four starting
  frames (names, all four or three first, the heavy's shield instead of a dash, the energy frame's hover legs).
- Extraction fee: carried scrap only, or bank top-up (default: carried first, bank tops up at ×1.5).
- Grenade launchers: shape (lobbed, bouncing or timed; blast 7-9 m suggested).
- Agent calls to confirm: excavator armour 10 (8 proposed), the dash backpedal off by default, Recruit rivals
  still fire undodgeable homing missiles, robots get no blast wave when they die, bites/saws/raider guns ignore
  armour.
- Faction steps 3-5 (`docs/proposal-factions.md`): war band melee infantry (old Mixamo melee clips), the Warden
  (a heavy turreted quadruped robot), rival military squads (tanks, armoured rocket infantry, mechs).

## Next candidates

- Grenade launchers (once the shape is agreed).
- Faction steps 3-5 (above).
- Performance with Keith's numbers: crater and dent spikes, far LOD and shadow distance for units, light clustering
  flicker (lights hopping between clusters).
- Progression: the tree and the starting frames, once the questions above are answered.
- Rams on big robots and enemy mechs; a proper trample crunch sound; enemy rocket and gun loops.
- Walker refactor (`walker.ts` is very large), shot events by register id (multiplayer readiness).

## Ground rules worth repeating to every agent

Rule 7 (numbers first, no filmstrips), rule 13 (commit and push WIP, handoff note), rule 14 (short reports,
full `npm test` once at the end), and "stay out of files another agent owns" when several run at once.
