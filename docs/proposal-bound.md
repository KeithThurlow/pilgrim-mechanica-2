# Proposal: the bound, a sprint you hold that turns the mech into a vehicle (built 2026-10-26: see "As built" at the end)

Keith, playtest 2026-10-26:
- The default speed should be quite a bit faster, closer to the running speed. **Done:** walk 6 m/s, Shift runs 8.5.
- A proper sprint with both legs up in the air. Hold Space, and the mech gets faster and faster.
- You end up sprinting along the ground really fast and start acting like a vehicle. You jump off sand dunes and glide
  over the terrain a bit, which would make going out and back a lot more fun.
- Fuel use goes up, but that can feel good.
- It should feel good as progression too. At first you get fast but don't make insane jumps. With better gear you go
  really fast and jump really far off dunes.
- Later, maybe emergent play: jumping into fortresses.

Keith, 2026-10-26 09:10: landing on your legs is something every mech does from the start (the crane drop already
has it). The mech should squat depending on how hard it lands, and the system should be general.

**This builds on the airborne and landing system that's already built** (`src/mech/walker.ts`, 2026-10-26):
- **One air state for every cause.** A crane drop, a crest taken fast, a blast later, and the bound's leaps all use it.
- **In the air:** the body is ballistic. The legs tuck going up and reach coming down, one foot ahead. The body pitches
  with the flight path.
- **Leaving the ground** is decided by the sim. When the ground falls away faster than gravity can follow
  (`leaveG` × g), the mech flies.
- **Landing:**
  - It hits with its speed into the ground, so landing along a slip face is gentle.
  - The squat grows with the impact.
  - Past `landHard` it staggers; past `landHurt` it takes damage.
  - Speed the legs can't run on with skids the planted feet.

So the bound is mostly an input, a speed and a gait on top of that.

## Input

| Space | Does |
| --- | --- |
| Tap (released within 0.2 s) | The dash, as now. |
| Hold | The bound. It starts from the walk or run you're in: the next push-off is the first leap. Speed builds while held. Let go and the mech lands out of its current leap, skids, and runs on. |
| Hold with a booster pack | The bound, faster and floatier. The pack's fuel goes into thrust (a higher top speed, quicker build) and glide (falling slower off crests). |

**Folding in today's boost slide.** Keith liked the slide (2026-10-25), so keep it as the end of a bound. Let go at
speed and the mech lands and skids on its momentum (`landFriction`). It goes further downhill, as the slide does now.

The dash-then-hold boost goes away. The booster pack's job moves to the bound (thrust and glide).

The tap/hold split delays the dash by up to 0.2 s. The other way is to dash on press and turn a hold into the bound
after the dash. That's instant, but every bound then starts with a dash. Question 1 below.

## Gait: from walk to run to bound

- **Walk and run (built).** At least one foot is always down (planted share 0.57 at a walk, 0.54 at a run).
- **Bound (new).** A two-footed leap: both feet push off together and both land together, one reaching ahead of the other,
  with the lead foot swapping each leap. It reads as a gallop or a kangaroo bound. Each cycle:
  1. **Stance**, about 0.10–0.15 s. Both feet are planted and skid a little on the momentum. A small squat from the
     landing (impact is about the leap's vertical speed, around 3 m/s, so a soft dip).
  2. **Push-off.** The hocks open and the toes push (the existing heel roll-off, sped up). The hips rise.
  3. **Flight**, about 0.5–0.7 s on the flat. This is the walker's air state: tucked rising, reaching falling.
  4. **Land**, then back to stance.
- **Blending.** The bound starts from the run's phase. The run's next lift-off becomes the push-off, so there's no
  pop. Letting go lands out of the leap into the run gait (the landing already hands its speed to the run, up to
  sprint speed, and skids the rest).
- **In the sim:**
  - A `bound` flag on the walker replaces the stepping phase with the cycle above.
  - Stance and push-off are two short states. Flight is the existing `airborne`.
  - `airLead` (built) swaps the lead foot.
  - New pose values (sliders): push-off hock extension, the stance crouch, and leg reach and split in flight. The
    split would be bigger at speed, like a galloping stride.

## Speed

- **Curve.** Each second held closes `boundBuild` of the gap to the top speed, from the run (8.5). About 4–6 s to top.
- **Uphill and downhill.** The existing grade slow-down applies uphill. Downhill, the leaps get longer by themselves.

| Gear | Top speed | Build | Leap (m/s up) | Notes |
| --- | --- | --- | --- | --- |
| Starting legs (Rampart) | 14 m/s | 0.30 /s | 3.0 | Crests give hops of about 0.5–1 s. |
| Mid legs (Stilt) | 18 m/s | 0.40 /s | 3.4 | Real jumps off big crests. |
| Late legs | 22–26 m/s | 0.50 /s | 3.8 | Long flights; with a booster's glide, 2–3 s in the air off a big dune. |

## Handling like a vehicle

- **Turning circle grows with speed.** The turn rate is `grip × g / speed`, so the radius is speed² / (grip × g).
  With grip 0.6: about 17 m at 10 m/s, 38 m at 15, 68 m at 20. At a walk the turn rate cap (120°/s) is the limit,
  as now.
- **Drift.** The flight keeps part of its old line at each push-off (`boundDrift`). The feet land skidding sideways
  (the landing skid, with dust and furrows), so a hard turn at speed slides out. Better legs grip more.
- **In the air.** Little steering (`airSteer`, 0.25 of the turn rate). Commit to a jump before you take it.
- **Braking.** Let go of Space: the mech lands, skids and runs on. Hold S (against the heading) to dig in and skid
  harder: `landFriction` × 2.

## Jumps off dune crests

- **Takeoff** is the sim's rule (built). Over a crest at speed s with ground curvature c, the mech leaves the ground
  when c × s² > `leaveG` × g. It flies with the climb it carried to the crest. At a walk this never fires on the lab's
  dunes. At a run it fires about 3 times a minute (small hops, sometimes a glide down a slip face). At 16 m/s, about
  1 leap in 5 becomes a crest jump of 1–1.7 s.
- **Distance** comes from speed and the crest: roughly s × the flight time. At 16 m/s the spike makes flights of
  15–27 m off the lab's dunes.
- **Glide** (booster).
  - While falling, the pack cancels `boundGlide` of gravity and burns boost fuel.
  - At 0.4 glide, hang time goes up by about half.
  - A better booster could add a little forward thrust and more air steering.
- **Landing hard** uses the built thresholds (sliders):

  | Threshold | Speed into the ground | Drop on the flat | Effect |
  | --- | --- | --- | --- |
  | Soft, under `landSoft` | 3 m/s | under 0.5 m | A dip. |
  | Squat | 3–10 m/s | 0.5–5 m | 0.14 m deeper per m/s, up to 1.4 m deep. |
  | `landHard` | 10 m/s | about 5 m | 0.7 s stagger. |
  | `landHurt` | 11 m/s | about 6 m | 40 damage per m/s over. |

  - Landing down a slip face is gentle because only the speed into the slope counts. Landing on the flat or an
    up-slope from a big jump is what hurts.
  - Legs and absorbers raise `landHard` and `landHurt`.

## Fuel

- **Bounding burns `fuelBound` × walking per second,** climbing with speed: about 3× at 10 m/s and 5× at 20.
  - Walking at 6 m/s costs 0.17 s of fuel per metre. Bounding at 16 m/s at about 4.4× costs 0.27 s per metre.
  - So the bound is about 1.6× the fuel per metre for 2.7× the speed. Time against fuel is the choice.
- **Glide** burns the booster's own fuel, not the pack's (`boostFuel`, already on the booster).
- **Return estimate.**
  - Keep "Home 3:40" at walk pace (the safe number).
  - Add a second figure when you could bound home: "bound 1:20, 1:50 of fuel". The fuel figure is the bound's burn
    over that distance.
  - Amber and red warnings stay on the walk figure.
- **Files:**
  - `fuel.ts` gets `bounding` in `Burn` (like `boosting`).
  - `returnPoint` gets a second pace.
  - The HUD shows both figures.

## Progression (which items raise what)

| Part | Raises | Example rolls |
| --- | --- | --- |
| Legs | top speed, build, leap, grip, landHard, landHurt | Rampart 14 / 0.30 / 3.0 / 0.6 / 10 / 11; Stilt 18 / 0.40 / 3.4 / 0.5 / 9 / 10 (fast, fragile); Siege 12 / 0.25 / 2.6 / 0.8 / 13 / 15 (slow, lands anything) |
| Power pack | fuel capacity, bound burn | 14 min (×1.0 burn); a long-range pack 20 min (×0.85) |
| Booster pack | glide, thrust (+ top speed), air steering, boost fuel | Starter: glide 0.25, +1 m/s, 0.25; late: glide 0.5, +4 m/s, 0.45 |
| Protocols | small trade-offs | "Shock absorbers" (+2 m/s landHard, −5% top); "Featherweight" (+10% leap, −15% hull) |

The early mech gets fast but doesn't make huge jumps: 14 m/s and hops of under a second. Late gear at 24 m/s with
0.5 glide makes 30–50 m jumps off big crests. Fortress jumps come out of that later.

## Risks

- **Feet through the ground.** In the air the feet are clamped to the ground and touching lands. On the ground the
  bound's stance is planted feet. The walker check covers drops; a bound check would cover a minute of bounding on
  the dunes (the spike's headless run: 0 foot-frames under the ground).
- **Legs out of reach at speed.** The bound never steps, so stride reach doesn't apply. Push-off and landing poses are
  set from the hips. The spike shows 0.7–1.2% reach misses, all at landings on steep faces; landing poses would aim
  the low foot further down.
- **Camera at 20 m/s.**
  - At the default 40 m zoom you see about 30 m ahead: under 2 s at 16 m/s.
  - The camera needs look-ahead along the velocity (about 0.6 s of travel) and to zoom out with speed (40 m at the
    run to 55–60 m at top).
  - Shake on hard landings only.
  - Dune shadows already show the ground falling away; a landing ring (a faint predicted touchdown mark) would help
    on big jumps.
- **Dust and dents at speed.**
  - Each landing is a stomp burst. At 1.5 leaps a second that's a lot of dust: the bound scales it down, more on
    hard landings.
  - Prints at landings only.
  - Skid furrows when drifting.
  - Dents from hard landings only (the other agent's dent layer), so the ground isn't cratered every 10 m.
- **Enemies keeping up.**
  - Robots and raider vehicles run about 10–19 m/s, so a bounding mech outruns most swarms.
  - Good for getting home. To keep pressure, raider bikes (fast) and jump robots could chase.
  - Bounding with guns: the torso still aims, but miniguns at 16 m/s mostly miss. Option: no firing while bounding
    (like the old game's sprint), or a spread penalty.
- **Frame cost.** The air state is a few height samples a step, negligible. The camera zoom-out shows more chunks,
  so the streamer radius may need to follow the zoom.

## Files, data and key values

- `src/mech/bound.ts` (new, pure): input hold, the speed build, the stance and push-off timer, grip-limited turning,
  drift, glide, and fuel need.
  - **Sliders** (group "Bound", topic Legs): `boundTop` 14, `boundBuild` 0.3, `boundHop` 3.0 m/s, `boundStance`
    0.12 s, `boundGrip` 0.6 g, `boundDrift` 0.5, `boundGlide` 0, `boundTap` 0.2 s, `boundCam` (look-ahead s),
    `boundZoom` (m per m/s).
- `src/mech/walker.ts`: a `bound` mode (stance and push-off poses). Air and landing are built.
- `src/game/mechUnit.ts`: runs the bound alongside the dash. Dust per landing is scaled down while bounding.
- `src/core/isoCamera.ts`: look-ahead and zoom with speed (sliders).
- `src/expedition/fuel.ts`, `returnPoint.ts`, `expeditionHud.ts`: the bound's burn and the second home figure.
- `src/items/bases.ts`: the stats above on legs, packs and boosters.
- `tools/bound-check.ts` (new), covering:
  - a minute of bounding on the dunes with feet never under the ground and no NaN;
  - the speed reaching top within the build time;
  - the turning radius growing with speed;
  - crest jumps happening at top speed and not at a walk;
  - landings over `landHard` staggering.

## Plan in steps

1. **Air and landing (done 2026-10-26).** One air state, crest takeoffs, the scaled squat, stagger, damage, skid. The
   crane drop uses it.
2. **The bound in the walker lab.** Port the spike into `bound.ts` and the walker's stance and push-off poses, with
   tap/hold input and the check. Filmstrips from the side and the game camera.
3. **Camera.** Look-ahead and zoom with speed. Judge it from the game camera at 16–20 m/s.
4. **Handling.** Grip, drift and braking, with skid dust and furrows.
5. **Fuel and items.** The burn, the second home figure, and the stats on legs, packs and boosters.
6. **Into the convoy lab and the combat labs.** Enemies that can keep up come later.
7. **Later:** fortress jumps (walls and ramps worth leaping), and landing on enemies (a stomp that hurts what's under
   the feet).

## What the spike showed (walker lab `?bound`, 2026-10-26)

**This is a spike, not the system.** It lives in `labs/walker/boundSpike.ts` and only the walker lab loads it, behind
`?bound`. Hold Space to bound; a tap still dashes. With `?walk=straight` the demo bounds by itself. It has its own
sliders under "Bound (spike)". It has no items, fuel, camera work or push-off pose.

It drives the walker from outside:
- On the ground it zeroes the gait and skids both planted feet on its speed for `boundStance`.
- Then it calls `launch()` with the speed and `boundHop` up, swapping the lead foot and widening the stride in the
  air (`airLead`).
- Everything else is the built air and landing system.

Headless, 40 s on the lab's dunes with the straight demo:

| What | Result |
| --- | --- |
| Speed | 8.5 to 13.7 m/s in 4 s, 16 by 10 s |
| Leaps | 59, plus 14 take-offs off crests, all by the sim's rule |
| Time in the air | 82% |
| Crest flights | 1.0–1.7 s and 16–27 m, hips up to 3.4 m over standing |
| Landings | Impacts 4–9 m/s (squats 0.3–0.9 m). No staggers: landing down slip faces is gentle |
| Feet under the ground, NaN | 0, 0 |
| Leg reach misses | 2.4% of leg-frames on dunes, at landings on steep faces; 0 on the flat |

**Filmstrips** (side and game camera) show:
- The two-footed leaps with a dip at each landing.
- A crest jump: the shadow pulls away down the slip face, then a squat and dust burst at the landing.
- From the game camera, the dust and paired prints at each landing read well as a trail.

**What it confirms:**
- The approach works. One air state plus a stance timer gives a bound with no new leg solver.
- Crests turn into jumps for free, scaled by speed.
- Landing on slopes needs the impact measured into the ground, not straight down. That's built.

**What it shows is missing:**
- **A push-off pose.** The legs go straight from the planted pose to the air pose.
- **A forward lean at speed.**
- **The camera.** It falls behind at 16 m/s, and the mech sits near the top of the screen.
- **Landing poses on steep faces.** The reach misses above.
- **Less dust per landing.** A puff every leap is a lot.

## Questions for Keith

1. **Tap or hold.** Should the dash wait for the release (tap = dash, hold = bound; up to 0.2 s of dash delay), or
   should Space dash at once and holding after the dash turn into the bound?
2. **The booster's slide.** OK to retire "hold after the dash to boost and slide" and give the booster to the bound
   (thrust and glide)? Letting go of a bound at speed still slides.
3. **Guns while bounding.** Can you fire, with a spread penalty, or are the guns offline like the old game's sprint?
4. **Bound and Shift.** Is Shift's run still wanted, or does the bound replace it (walk 6, then hold Space)?
5. **Top speeds.** 14 m/s early and 22–26 late: does that sound right, or should late gear be faster still?
6. **Hard landings.** Is a stagger and damage from a big jump onto the flat right, or should the bound never hurt
   you, so only drops and blasts do?

## Answers (Keith 2026-10-26)

- **What it should feel like:** a sprint, not a rocket slide. Tap Space dashes in the WASD direction at once. Keep
  holding and the mech carries on into a digitigrade sprint that keeps getting faster: a real running gait, not
  boosted sliding. Today's held Space feels "boosted by rockets"; that isn't it.
- **Jumps off dunes, yes, but not exaggerated.** Dashing at a steep wall today can fling the mech so high it dies
  from its own landing. Keith loved finding it ("we have the right idea going on") but it's too much. Full landing
  damage stays possible.
- **Top speed:** 14 m/s early, 22–26 m/s late is about right.
- **Hard landings hurt:** absolutely. Sprinting fast and jumping over things should carry some risk.
- **Guns while bounding:** undecided. Being up in the air and firing down felt really cool. Claude's default: guns
  fire while bounding (a slider for an accuracy penalty in the air), revisit after play.
- **Shift's run:** no answer yet. Claude's default: keep it until the sprint is played.
- **Booster pack:** follows from the first answer. The rocket slide on hold goes; the booster later adds thrust and
  glide to the sprint.

## As built (2026-10-26)

What differs from the proposal above, after Keith's answers:

- **Input.** Space dashes at once (no tap/hold wait). Keep holding and the sprint starts as the dash's shove ends,
  carrying its speed (at least the run's 8.5 m/s). With no dash charge, holding `boundTap` (0.2 s) starts it from the
  walk. Let go and the mech lands out of its stride and runs on, skidding off what the run can't hold (`landFriction`).
  The rocket boost on hold is gone; so is the slide as the default hold (the dash's own glide-out stays).
- **Gait** (`walker.ts`, `bound`): a gallop rather than a pure two-foot hop. Each stride: a stance where the first foot
  down is the first up and the other lands a moment later and pushes off last (`boundStagger`), planted feet locked,
  heels rolling and hocks opening by stance progress (the walk's push-off), the body dipping to soak up the landing and
  spring into the push-off (`boundSquat`); then a leap on the air state, the trailing leg staying out behind and drawn up
  as it swings through (`boundSwing`, `boundTuck`), the lead foot reaching (`boundReach`, `boundSplit`) and swapping
  each leap. The run's first push-off comes out of a short stance on the feet as they are. Landings under
  `boundAbsorb` (7 m/s) are just the next stride; harder ones are the normal squat, stagger and damage.
- **Speed and handling.** As proposed: `boundBuild` share of the gap per second (about 6 s from the run to near 14 m/s),
  uphill slows the top. Turning: the line of run follows the body at grip × g / speed on average over a stride; the
  body may turn `boundYaw` faster, and the gap (up to `boundDriftMax`, 30°) is a drift that scrubs speed and skids the
  planted feet sideways (dust and furrows). In the air a quarter of that steering.
- **Walls (the fling).** Keith found that a dash at a steep wall could throw the mech so high its landing killed it: the
  air system took off with the dash's 60 m/s shove times the slope behind (a dash at the foot of an 8 m 60° face rose
  354 m headless). Now ground steeper than `wallGrade` (0.9, 42°) takes the speed going into it away (all of it from
  `wallStop`, 1.6, 58°) for the sprint, the dash's shove, skids and the walk; a shove up a slope is laid onto it; a body
  rising into a face in the air loses the speed into it, and lands if its hips reach the ground; nothing takes off upward
  faster than `launchUpMax` (6 m/s). Crest jumps still come from speed and the ground falling away.
- **Booster (simple version).** While its tank lasts: top speed + `boostTop` (3 m/s) and a `boostGlide` (0.3) off
  leaps; it burns `boostBurn` (0.25) tank-seconds a second sprinting and refills when not.
- **Guns** fire while sprinting; `airSpread` (+3°) in the air; `boundGuns` 0 turns them off while sprinting.
- **Fuel** `fuelBound` 0.27 s per metre. The HUD keeps "Home" at walk pace and adds "sprint home m:ss, burns m:ss".
- **Camera** leads `camLead` (0.6 s) of travel above `camLeadFrom` (7 m/s), at most 14 m, and pulls out `camSpeedZoom`
  (1.2 m per m/s over that).
- **Items.** Top speeds live on the leg types (Rampart 14, Stilt 18, Siege 12, with grip, hop and landing limits); the
  leg items don't carry a sprint stat yet (the loadout was another agent's at the time).
- **Not done yet:** landing poses aimed at steep faces, dust and dents tuned only from filmstrips, chasers that keep up,
  fortress jumps and landing on enemies.

## Revised after Keith's playtest (2026-10-26 18:28)

Keith: the gallop reads as skipping ("bang, bang, and it jumps up in the air"); it works well as a falling and landing
animation, but the sprint on the ground should be a real run with the foot cadence even. So:

- **The ground gait is a run** (`walker.ts`: `runK`, `runSwing`, `tuckPose`): left, right, left, right on the walk's
  gait phase, with its own cadence (3 steps/s at the run, 3.6 at top) and a planted share of 2.1 m of ground per stance
  over the stride, so short flights appear and grow with speed. Sprinter mechanics: the hock opens further at push-off
  (`runHockExtend`), the heel rolls earlier and further, the foot follows through behind, swings up into a tuck (thigh
  50° up, shin folded back, hock folded, foot hanging toes-down, toes curled), reaches and sweeps back into a plant under
  the hips. The hull keeps `runClear` over the highest ground ahead (`runLookAhead`), with a feed-forward on the hips'
  height so a ramp doesn't lag under it.
- **The gallop is the way into and out of the air:** running off a crest flies on the gallop's air pose and lands on its
  staggered stance; that stance hands over to the run (`runFromStance`). `boundGallop` 1 brings the whole gallop back.
- **Speed, handling, fuel, guns and the booster are as built** (top 14 m/s, grip, drift, walls).
- **The dash pushes off a foot** and a held Space flows from the push-off into the run (`dashHoldRun`, `dashIntoRun`);
  see `docs/decisions.md`.
