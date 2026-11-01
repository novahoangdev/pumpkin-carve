# FX — notes from the FX agent

Own sim: "Pumpkin FX 17 Pro Max" (56130AAC-A641-4D99-843D-A1A6B78A9289), Metro 8093 running from a **copy** of the app in the scratchpad
(so half-done edits don't reload the main agent's sim). FX files are only copied into the real project after typecheck + lint + a look on the sim.

Feedback to address: "the particles when turning to other screen angles, and the things that fly out, look ugly and too fake".

## Main agent needs to merge (3 lines in `PumpkinScene.tsx`)

`notes/fx/scene.diff` (or run `python3 notes/fx/patch_scene.py app/src/scene/PumpkinScene.tsx`, patches by anchor string):

1. `<Particles … basis={basis} />` and **move it OUTSIDE** `<Group transform={pumpkinTransform}>` (right after that group, before the rain layer).
2. `<ImpactDust … basis={basis} />`
3. `<Match … basis={basis} />` (the match lies on the porch in 3D, see section 4)

**Merged (16:20).**

Still works unmerged: without `basis`, Particles / ImpactDust project with the base camera (Particles stays inside the
`pumpkinTransform` group as before) → debris lands on the porch correctly while the camera is still, but no parallax when looking around / tilting.
**Note:** passing `basis` while Particles is still inside the `pumpkinTransform` group transforms it twice.

## 1. Pumpkin flesh bits, seeds, fibres, juice drops — `app/src/fx/Particles.tsx`, `pfx_atlas.ts` (16:10)

Before: debris flew in 2D image coordinates stuck to the pumpkin, the fake "floor" was level with the pumpkin face (debris bounced in mid-air), garish yellow
that ignored scene lighting, and it drifted like a sticker when the view turned. Before/after shots: taken on the FX sim (before, debris floats in front
of the pumpkin face; after, it lies on the porch in front of the pumpkin).

Now:
- Lives in **scene space (metres)**: spawn point = carved hole edge projected onto the pumpkin ellipsoid (`pumpkinWorld`), velocity along the pumpkin
  surface normal + spread out from the hole centre + kicked up. Projected through the view camera every frame (`proj(basis, …)`) → when looking around / tilting / zooming, debris sits
  in the right spot on the porch (real parallax), scales with depth, and is hidden by the pumpkin when behind it (`behindPumpkin`).
- Analytic physics (`fall` in `pfx_atlas.ts`): gravity 7.6 m/s², bounces on the porch surface z = 0 with per-type restitution (seeds 0.42, wet
  flesh 0.2 and sticks to the floor, fibres barely bounce), loses horizontal velocity on each bounce, slides with friction, then rests. Stateless.
- Real sizes: bits 5–16 mm, seeds 13–17 mm, fibres 2–3 cm, juice drops 2–3 mm.
- Seeds have a 3D orientation (normal + long axis) and spin around their own axis; lying on the porch they flatten → thin ellipse with correct floor perspective.
- Debris stays 6 s before fading (real debris doesn't vanish on its own), a dark **wet mark** under where bits / drops land, drying over time; wet glints.
- Lighting: light direction comes from projecting the real light source (porch lantern `LANTERN_W` ≈ (−0.08, 1.35, 1.29) m before lighting, the candle
  `FLAME_W` after) onto the screen; brightness is darker than the old version to match the night.
- Embers after lighting are 3D too (rise from the carved hole in metres).

**For `synth_audio.py`:** the debris-landing sound (ported from the old Particles, line ~466) is now off in timing. To match, port the
`fall` function (pure math, no dependencies) with the same `hash`/parameters as in `Particles.tsx`.

## 2. Dust + leaves when the pumpkin lands — `app/src/fx/ImpactDust.tsx` (16:10)

Moved to metres around the pumpkin foot (`PUMPKIN_FOOT_W`, the landing's horizontal offset changed from pt to m): the dust cloud spreads along the porch forward and
to both sides (the back is hidden by the pumpkin), grit bounces via `fall`, leaves fall with air drag then lie flat — flip angle comes from the real view angle onto the floor, leaf veins
are projected with correct perspective; the shock ring is a circle on the porch projected through the camera (correct perspective ellipse when viewed at an angle).

## 3. Bats — `app/src/fx/Bats.tsx`, `app/assets/fx/pfx_bat.png`, `blender/fx/bat_sheet.py` (16:10)

Before: flat single-colour vector paths. Now a **headless Blender** sprite (`blender/fx/bat_sheet.py`, ~3 min CPU, file `blender/fx/bat.blend`):
- Bat built on the exact wing geometry of Bats.tsx: thin skin membrane with texture + blood vessels (translucent), finger/arm bones, furry body (sheen), head,
  ears, snout, eyes, feet, tail membrane. Wings flap via shape keys using the app's `ang`/`fold` formula.
- 24 view directions (8 azimuths × 3 elevations) × 8 flap phases, **real Cycles motion blur** (shutter 1/12 cycle).
- Pass A: moon backlight (cool rim) — the bat stays a dark silhouette against the sky. Pass B (drawn `plus`): **rim + translucent red-orange wing membrane**
  when backlit by the candle; the app tints by distance to the candle (bright right as they emerge, fading as they fly away).
- The app picks the cell from the eye direction in the bat's body frame (correct when the bat climbs, banks, or the viewer looks around), rotates the sprite by the cell's "up"
  vector projected to screen; translational motion blur (2–3 ghost copies along the 1-frame path); bats grazing the lens are drawn on the blur 5 layer.
- Trajectory, `BAT_COUNT`, `BAT_DURATION`, `delay` formula unchanged → `synth_audio.py` needs no change.
- Sheet 2048×3072 (3.2 MB PNG, ~25 MB GPU). Rebake: `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup
  --python blender/fx/bat_sheet.py -- --cell 128 --samples 24`.

## 4. Match lying on the porch — `app/src/fx/Match.tsx` (16:25)

Before: looking around the porch, the match stayed fixed in a screen corner like a sticker. Now the rest spot (`MATCH_REST`) is projected from the base image onto
the porch surface (m) and back through the view camera → it rests on the floorboards with the right position / angle / size when looking around, tilting, zooming (shadow too).
Picked up, it follows the finger as before (offset from the rest spot); more than 60 pt from the rest spot it switches to screen size/angle.
**Note for PumpkinScene:** the touch zone for picking up the match is still computed around `MATCH_REST` (screen pt). With the camera still they coincide; when
looking far to one side the match shows somewhere other than the touch zone. The demo is unaffected (the match is picked up once the camera is back to centre).

## 5. Collapsing rind piece — `app/src/carve/PoppedPiece.tsx` (16:30)

The rind piece hitches for a beat then **tips backwards around its bottom edge with a perspective 3D rotation** (`perspective` + `rotateX`), revealing the wet yellow
flesh cut face on the top edge (matching rind thickness), the rind face darkens into the pumpkin's inner shadow, then it drops and disappears behind the hole's bottom edge (every layer is clipped to
the hole shape, nothing pokes out). 560 ms (was 480 ms).

## Performance (measured 16:50)

`PerfHud` (UI thread fps, `[perf]` log) attached temporarily on the copy, FX sim, debug build, while the machine was rendering Blender. Alternated FX on /
off (off = drop Particles, ImpactDust, Bats):

| | carve 3–8 s | jump 11–17 s | bats 24.9–30 s |
|---|---|---|---|
| FX on (run 1) | 57 fps, max 35 ms | 60 fps | 60 fps |
| FX off | 57 fps, max 47 ms | 60 fps | 60 fps |
| FX on (run 2) | 57 fps, max 40 ms | 60 fps | 59 fps, max 38 ms |

Optimised before measuring: debris spawn points (ray–ellipsoid intersection) cached per burst instead of computed every frame; light direction projected once per frame;
bats near the lens dropped the offscreen blur layer (a 128 px sprite scaled ~10× is blurry enough). Bats are now 4 Atlases, no SkPath built per frame.
No new shaders.

## How to view

Current dev build + Metro: every change is JS + PNG, Metro hot-reloads. Demo times: debris 3.3–12 s (lies on the porch through the look-around 7.5–11 s, the match also follows the porch),
dust/leaves 11.4–13.7 s and 16.6 s, bats 24.9–29 s.

## Main agent edits (16:30, project owner agreed)

- `pfx_atlas.ts`: `CX0, CY0` = `VIEW.w / 2, VIEW.h / 2` (was 201/437 from the 402×874 frame → off by 19/41 pt on Pro Max).

## 6. Gust sweeping maple leaves in the intro — `app/src/fx/Gust.tsx`, `app/assets/fx/pfx_leaf_fg.png` (17:05, FEEDBACK-1630 item 3b)

**How to attach (4 lines, `notes/fx/scene-gust.diff`, or `python3 notes/fx/patch_scene.py app/src/scene/PumpkinScene.tsx`):**

```tsx
import { Gust } from "../fx/Gust";
// main canvas, right after <Particles …/> (behind the pumpkin, before rain): midground leaves + leaves lying on the floor
<Gust layer="scene" time={time} basis={basis} />
// canvas above the fog (same place as <Bats>), drawn before <Bats>: foreground leaves right at the lens, over the fog
<Gust layer="fg" time={time} basis={basis} />
```

Props: `time` (scene clock), `basis` (view camera), `at` = gust time (default **1.6 s**; `at={-1}` to disable, e.g. outside
DEMO if unwanted), `layer`.

- Foreground: 9 big maple leaves (8.5–13.5 cm) fly left → right 0.25–0.6 m from the eye, flipping + spinning, out of focus (leaf sheet downscaled ½ +
  pre-blurred, 32 px/cell scaled ~10× → very soft, no blur layer needed), motion blur with 2 ghost copies along the 1/60 s path. Fixed metre coordinates in the
  scene around the camera position → strong parallax when the camera cranes down. The gust lasts ≈ 1 s from `at`.
- Midground: 9 leaves swept across the porch (0.8–2.5 m), sharp, hidden by the pumpkin when they pass behind it.
- Floor: 6 leaves already lying on the porch boards around the pumpkin (always visible, like fallen leaves); when the gust hits they slide 12–42 cm downwind, bounce + a few flip
  over, with contact shadows, then settle.
- **No objects / arrays created per frame**: each sprite is computed directly in the `useRSXformBuffer` / `useRectBuffer` /
  `useColorBuffer` callbacks (written in place), scratch arrays allocated once on mount. A layer that isn't drawing keeps 1 sprite and doesn't read `time`. 2 draw calls total.
- Flight paths are tuned to the current intro (camera at the rest frame). Once the new crane intro is done, if the leaves should pass elsewhere, tweak
  `fgLeaf` (x/y/z in metres around `CAM.pos`).

## 7. Open items from `main.md` (17:05)

- (B) `CX0/CY0` taken from `VIEW`: the main agent fixed it in `pfx_atlas.ts`, I left it as is.
- (A) **3D-anchored match smoke**: when the flame goes out, the match head's screen point is back-projected onto the pumpkin surface (m, `screenToPumpkinWorld`),
  smoke rises in metres and is projected through `basis` every frame → if the camera tilts after lighting, the smoke stays in place above the pumpkin's mouth. Same
  smoke duration / shape as before.

## 8. Debris stays + bounces when the pumpkin lands — `Particles.tsx` (17:05)

- Debris no longer fades after 6 s: it stays on the porch until ~73 s (real debris doesn't vanish on its own) → when the candle is lit the pile of debris is still in front of the
  pumpkin, glowing in candlelight. Wet marks still dry over ~10 s.
- New prop `impacts={jump.impacts}` (already in the diff in section 6): each time the pumpkin lands, debris lying near its foot bounces a few mm–1.6 cm
  (closer + harder = higher, seeds bounce higher than flesh bits) and scatters outward a little. Unattached, the debris just doesn't bounce.

## 9. Bats spelling HAPPY HALLOWEEN at the end of the clip — `app/src/fx/Bats.tsx` (17:10)

No changes needed in PumpkinScene (same props `t0`, `time`, `basis`). Already copied into the app.

**Proposed timings** (seconds from bat release = `batsAt`; current demo `SCRIPT.bats` = 24.9 → app time in brackets):

| phase | from bat release | app time (demo) | look |
|---|---|---|---|
| swarm out | 0 → 1.25 s | 24.9 → 26.15 | 390 bats stream out of the pumpkin's mouth (left → right by position in the text), shoot up |
| turn to the text | ~0.45 → 3.0 s | 25.35 → 27.9 | each bat steers to its point (critically damped spring + slight hovering), shrinks to "text dot" size |
| **hold text** | **3.0 → 4.2 s (1.2 s)** | **27.9 → 29.1** | slow/soft flapping, gentle sway; cool moon rim + orange glow cast from the pumpkin |
| break up | starts 4.2 → 4.4 s (centre of text first) | 29.1 → 29.3 | dive straight at the lens, scaling up |
| fly past the lens | ~4.6 → 5.6 s | 29.5 → 30.5 | cross the lens plane, last bat gone at 5.8 s (30.7) |

`BAT_TIMES` exports these timings; `BAT_COUNT` = 390, `BAT_DURATION` = 5.8 (synth_audio.py can still read them by regex). **Audio:**
the old trajectory is gone so the bat port in `synth_audio.py` no longer matches. Suggestion: flapping thickens 24.9–26.2, settles into
a soft murmur while holding the text 27.9–29.1, then a series of "whooshes" past the ears 29.4–30.5 (loudest ~29.9).

- Text: `Skia.Path.MakeFromText` (Helvetica Neue Light 88 / 76 / 48 pt, 3 lines "HAPPY", "HALLOWEEN", "@novahoangdev"), samples the fill area
  of the thin font (≈ stroke centreline) on a fine grid + jitter, picked evenly by farthest-point sampling (92 / 163 / 135 bats). Runs once
  on mount. The text is built from the **camera at the moment of bat release** (always centred in frame), fixed in the scene 2.1 m from the eye (parallax if
  the camera moves while the text holds).
- "HAPPY" / "HALLOWEEN" read clearly; the "@novahoangdev" line (thin lowercase) is readable on close look — if it needs to be clearer for the clip,
  add a faint text layer at the same position (frame pt: line centre y = 0.395 × VIEW.h, size 48, Helvetica Neue Light) shown while the text holds.
- Performance: 1 mapper computes 390 bats per frame, writes into a `Float64Array` living on the UI runtime (`globalThis.__fxBats`), 2 Atlases read it back
  in place; random constants precomputed on mount. No objects / arrays created per frame. Hidden sprites use `HIDDEN_XF` (no zero RSXform).
  Measured on the FX sim (debug build, machine under heavy load): bat segment FX on ~25 fps / FX off ~28–31 fps at the same time — i.e. bats cost ~15 % relative to the scene;
  needs re-measuring on Release / a real device.
