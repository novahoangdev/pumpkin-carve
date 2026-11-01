# Pumpkin Carve: Halloween pumpkin carving

An iPhone demo: carve a face into a pumpkin with your finger, then drag a match into its mouth to light the candle. The
candlelight shines through exactly the strokes you just carved, turning into light shafts in the fog and casting a
glowing smile onto the wooden porch (rays traced properly from inside the pumpkin through the carved holes); tilt the
phone and your eye orbits the pumpkin, revealing the thick rind, the flame sitting inside the pumpkin and a background
that shifts with depth; drag the background to look around the porch, pinch to zoom; tap the pumpkin to make it jump,
tap repeatedly and it flies up into the Dynamic Island and gets spat back out; it rains, lightning lights up the whole
yard and shines through the carved holes, a black cat appears on the railing in the flash, the pumpkin's face casts a
giant shadow on the house wall; finally 390 bats pour out of the pumpkin's mouth and form the words HAPPY HALLOWEEN.
The app opens with a lightning strike, a crane shot down from the moon, a flickering porch light and wind-blown leaves. Blender pre-renders the 2.5D layers (background, rind, interior, normals) from a single camera angle; the
React Native app composites them in real time with Skia v3 shaders, the carved holes are a mask drawn by your finger, and Reanimated drives the
120Hz clock, gyro and haptics. Detailed design: [PLAN.md](PLAN.md).

## Layout

```
blender/scripts/build_scene.py     builds the scene in code: pumpkin (rind, inner wall, stem, seeds, fibres), tealight candle, porch,
                                   wall, door, porch light, railing, sky backdrop, portrait camera 1320×2868 (17 Pro Max)
blender/scripts/extras/porch_wide.py  extended scene for "look around": ceiling, roof, gutter, posts, wall + windows, left
                                   railing + steps, yard, fence, trees, distant houses, a full-panorama sky (world) with a moon
blender/scripts/render_passes.py   renders the layers → app/assets/scene/ (bg lit/dark/candlelit, panorama *_pano.jpg,
                                   pumpkin shadow shadow_lit/dark.png, rind lit/dark, interior lit/unlit, data = normals +
                                   carvable area, pumpkin flesh grain, depth bg_depth*.png, layout.json)
blender/scripts/check_pano.py      projects the pano back to the original frame to measure error + look-around previews → render/v3/
blender/scripts/synth_audio.py     synthesises sounds (knife, pumpkin bits, match, candle flare, bats, night) with numpy → render/audio/mix.wav
blender/scripts/promo.py           builds the 4:3 phone-mockup clip for posting on X
blender/textures/                  hand-painted sky, pumpkin rind, pumpkin flesh, porch wood, wall boards (generated with Codex image gen)
tools/build.sh                     builds the scene + renders the layers (PREVIEW=1: 50 %, few samples)
tools/promo.sh                     records the simulator → render/promo/pumpkin-carve-demo.mp4
tools/sheet.sh                     6-frame contact sheet from a clip
app/                               Expo SDK 58 · react-native-skia 3.8 · Reanimated 4.7 · gesture-handler 3.3
```

Inside the app:

```
src/scene/PumpkinScene.tsx   Canvas, layers, gestures (carve, match, look around, zoom, tap), candle lighting, demo mode
src/scene/view.ts            view camera: rotate, zoom, eye offset from head/device tilt; the pumpkin is an ellipsoid for hit-testing/projection
src/shaders/viewSksl.ts      shared SkSL: view ray → original camera image, depth-based reprojection, ray–pumpkin intersection
src/shaders/background.ts    lit/dark background, candlelight through the carved holes onto the porch (thick rind blocks oblique rays), lightning flash
src/shaders/pumpkin.ts       rind, cut walls with thickness, interior and flame placed at the correct 3D position
src/shaders/rain.ts          3D rain (cylinder layers around the eye, depth-occluded, no rain under the roof), drip streams at the roof edge,
                             ripples in the yard, lightning bolts in the sky
src/fx/storm.ts              lightning schedule (demo: STRIKES), flash timing, bolt shapes
src/shaders/candleLight.ts   bakes candlelight through the carved holes onto floor + wall (area source inside the pumpkin, real penumbra)
src/shaders/lightningThrough.ts  lightning shining through the carved holes
src/fx/Gust.tsx, BlackCat.tsx  wind-blown leaves at app open, black cat on the railing
src/scene/clock.ts           time scale (EXPO_PUBLIC_TIMESCALE) for slow-motion recording → 120 fps clip
src/perf/                    GPU images (useGpuImage), FPS overlay (EXPO_PUBLIC_PERF=1)
src/shaders/atmos.ts         fog, light shafts through the carved holes, porch-light halo, vignette, film grain
src/carve/                   knife strokes → carved holes, offscreen mask + blur, collapsing rind pieces
src/fx/                      match, bats, pumpkin bits and seeds, embers, haptics
src/fx/jump.ts               pumpkin jump (squash & stretch, combo), flight into the Dynamic Island (IslandPill), impact dust (ImpactDust)
src/demo/script.ts           stencils (Classic, Spooky, Cat) and the demo script
```

## Running

```bash
PREVIEW=1 tools/build.sh      # quick preview (~1 minute)
tools/build.sh                # final: 100 %, 128 samples (~6 minutes)

cd app
npm install
npx expo run:ios --device     # dev build (Skia v3 does not run in Expo Go)
```

The app opens with a zoom from afar into the pumpkin. Draw a closed shape on the pumpkin (stroke start and end close together) to cut a hole; an open
stroke becomes a thin groove. Drag outside the pumpkin to look around the porch (it returns when you let go), pinch to zoom. Tap the pumpkin to make it jump;
keep tapping and it jumps higher and higher, then flies into the Dynamic Island. Undo, Reset, and stencil buttons carve
automatically. Drag the match from the bottom-right corner into the pumpkin's mouth to light it; a few seconds later the bats fly out. On a real device: tilt to see
the cut walls and the interior shift with the viewing angle.

Per pixel: a ray from the eye (offset a few cm from the Blender camera) → 3 iterations over the depth image to find the surface point → project
back into the original camera image; outside the frame, sample the equirect panorama (`bg_*_pano.jpg`) rendered from the same position. The pumpkin uses an analytic
ellipsoid: hit the outer surface → rind; continue through the rind thickness → cut wall; reach the inner surface at the back → interior; the flame is
a billboard at the correct 3D coordinates. With no eye offset the result matches the old homography.

## Quick tweaks

- How far the eye orbits the pumpkin when tilting: `ORBIT_X`, `ORBIT_Y` at the top of `PumpkinScene.tsx`; eye offset when turning the head:
  `NECK_UP`, `NECK_FWD` in `view.ts`.
- The light source inside the pumpkin cast onto the porch: the `main` function in `src/shaders/background.ts`. Rain density / brightness: `rain.ts`.
- Lightning timing in the demo: `STRIKES` in `src/fx/storm.ts` (thunder is delayed automatically by distance).
- Cut-wall colour, flame, rind glow: `src/shaders/pumpkin.ts`. Fog, light shafts: `src/shaders/atmos.ts`.
- Stencil strokes and demo timing: `src/demo/script.ts`.
- Scene layout, lighting, materials: `build_scene.py`; re-run `tools/build.sh` and the app picks up the new images and `layout.json`.

## Videos in the repo

The repo keeps only the published cut and contact sheets; everything else in `render/` (recordings, segments, Blender passes) is ignored by `.gitignore` since it can be rebuilt:

- `render/promo/pumpkin-carve-final-v2.mp4`: the final cut (60 fps, 4:3, phone held still, Dynamic Island mini pumpkin + BOO!, end card "Happy Halloween!").
- `render/promo/pumpkin-carve-final.mp4`: the previous cut, kept as a backup.
- `render/promo/pumpkin-carve-sheet-final*.jpg`: frame grids for a quick look.
- `render/audio/mix_final.wav`: mastered audio (−14 LUFS).

To keep another video, add a line `!render/promo/<name>.mp4` to `.gitignore` (files under 100 MB).

## Recording a 120 fps clip

The Mac display is 60 Hz, so record in slow motion and then compress time: build Release with `EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_TIMESCALE=0.25`, then

```bash
tools/pauseall.sh env UDID=<udid> TS=0.25 SECS=35 OUT=render/promo/v5 tools/rec120.sh   # → screen-120.mp4, screen-60.mp4, check.txt
BEATS=blender/scripts/beats/v5.json SCREEN=render/promo/v5/screen-120.mp4 FILM0=<t0> FPS=120 \
  FINAL=render/promo/pumpkin-carve-demo-120.mp4 tools/pauseall.sh tools/promo_par.sh   # → 120 fps master + X version …-120-x60.mp4
```

`tools/pauseall.sh` pauses every app on other simulators, ffmpeg and Blender while recording. `check.txt` must show a full 120 / 60 distinct
frames per second. All motion in the app comes from the `time` clock (already scaled) or `ms()` / `spring()` in `scene/clock.ts`.

`promo_par.sh` renders with 3 parallel Blender processes, writing lossless H.264 directly (no PNGs, ~0.8 MB/frame), about 20 minutes for
the 120 fps version; delete the `render/promo/par_*` folders afterwards. `<t0>` = the second in the recording that corresponds to app t = 0: take the first flash frame of a
lightning strike (app 0.45 / 9.95 / 22.35) minus that mark, or use `tools/sync.py` (candle flare at app 20.107).

## Recording the demo clip (for X)

```bash
tools/build.sh
SYNTH_DUR=32.5 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/scripts/synth_audio.py
# the project's own simulator: "Pumpkin 17 Pro Max" (iOS 27.0, 1320×2868 = 440×956 pt), UDID CA7F5A01-D288-47E0-9CED-0EFBED4178D1
cd app && EXPO_PUBLIC_DEMO=1 npx expo run:ios --configuration Release --device CA7F5A01-D288-47E0-9CED-0EFBED4178D1 --no-bundler && cd ..
tools/promo.sh --beats blender/scripts/beats/v3.json     # record (defaults to the sim above) + build → render/promo/pumpkin-carve-demo.mp4
tools/sheet.sh render/promo/pumpkin-carve-demo.mp4 render/promo/pumpkin-carve-sheet.jpg blender/scripts/beats/v3.json
```

Rebuild from an existing recording: `tools/promo.sh --beats blender/scripts/beats/v3.json --screen render/promo/v3b/screen.mp4`
(the candle-flare mark is detected automatically; add `PCT=50` to render at half resolution, `--stills 13.9,16.6,20.1` to preview a few frames).
All camera marks, background text, background colours, punch/shake and 3D bats live in the beat sheet `blender/scripts/beats/v*.json`.
`synth_audio.py` reads its timings straight from the app code (`script.ts`, `jump.ts`, `Bats.tsx`…), `SYNTH_DUR` = audio length.

`EXPO_PUBLIC_DEMO=1` makes the app play the storyboard on its own: zoom in from afar; a virtual finger carves eyes, nose, mouth; look around the porch;
lightning strikes while looking out at the yard; tap to make the pumpkin jump, then fly into the Dynamic Island; drag the match; the porch light goes out, the candle flares;
simulated tilt (orbiting the pumpkin), a second lightning strike; the bats pour out.
`EXPO_PUBLIC_STENCIL=spooky|cat` changes the carved face in the demo.

`promo.sh` sets the status bar to 9:41, records the simulator, conforms it to a steady 60fps by pts,
detects the candle-flare frame for sync (`tools/sync.py`: brightness rises and stays up, so it is not confused with lightning), then `promo.py` builds the 4:3 clip with a titanium iPhone frame, large text behind the phone and an end card.
