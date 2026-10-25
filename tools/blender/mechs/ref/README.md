# Reference toolkit (mech-modeling skill, step 0)

Small scripts for working from a 3D reference model (a Tripo3D export, say). The reference never enters the repo: pass its
path from `art-refs/` (not committed) and write every output to the scratchpad. Renders or composites that contain the
reference are never committed.

| Script | Runs in | What |
| --- | --- | --- |
| `refcommon.py` | Blender | import a model headless, scale it to the game height (5.2 m; the model's z 0 is the ground) |
| `turn.py` | Blender | fixed ortho turnarounds (front, back, left, right, q34, top, rear34) and the game camera at 40 m: textured (`t_`), grey (`g_`) or a black mask (`m_`); the cameras match `shots.py`'s `match_*` shots |
| `sections.py` | Blender | raw plane sections (z, x, y stations) to json |
| `plot.py` | Python + Pillow | sections on a 0.1 m grid: `python plot.py sections.json outdir z1.50,z2.00 name [x0 x1 y0 y1]` |
| `stations.py` | Blender | convex, simplified station outlines per region box: the loft stations (`-- ref.fbx regions.json out.json`) |
| `compare.py` | Python + Pillow | the mass gate: side-by-sides and silhouette overlays (ref only blue, ours only red), IoU per view |

The gate as run for Rampart v3/v4:

    blender -b --factory-startup -P tools/blender/mechs/ref/turn.py -- <ref.fbx> <scratch>/ref mask
    blender -b --factory-startup -P tools/blender/mechs/ref/turn.py -- <ref.fbx> <scratch>/ref grey
    blender -b --factory-startup -P tools/blender/mechs/studies/rampart/shots.py -- --model rampart_v4 --pose rest \
        --out <scratch>/gate --only massmatch_front,massmatch_left,massmatch_right,massmatch_q34,massmatch_top,massmatch_back
    python -I tools/blender/mechs/ref/compare.py <scratch>/ref g_ <scratch>/gate massmatch_ <scratch>/cmp front left right q34 top back

Gate the mass at rest (IoU about 0.75 or better per view) and note the reference's own pose offsets instead of chasing them.
