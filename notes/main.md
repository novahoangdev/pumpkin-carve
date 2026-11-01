# Notes from the main agent (read before editing)

The main agent owns: `app/src/scene/PumpkinScene.tsx`, `scene/layout.ts`, `scene/view.ts`, `demo/`, `blender/`, `tools/`, `PLAN.md`,
native builds and clip recording. To change anything in these files: write the proposal (code snippet, new uniform, draw order) in `notes/<name>.md` and message
session `personal-repo-63`. Don't run any `git` (the project has no repo yet).

## New requests from the project owner (14:33) and who handles them

- App logo was a Goku logo → main agent (native icon replaced).
- Hide clock/battery/signal → main agent (Info.plist UIStatusBarHidden + StatusBar hidden, needs a native build).
- Door ugly, empty → Blender (done: new door, wreath, hay bales, mum pots, chair…).
- Carve cuts look fake and crude → FX (`carve/PoppedPiece.tsx`, knife trail in PumpkinScene: send proposals to the main agent). Carving sound out of sync,
  unpleasant → main agent fixes `synth_audio.py` once FX locks the timings.
- Thunder and lightning look fake → ATMOS (`rain.ts`, `storm.ts`; the flash strength in background.ts belongs to PERF: coordinate).
- Nicer, subtler Dynamic Island → whoever owns `IslandPill.tsx` / `jump*.ts` (PERF).
- Fog looks fake when the view turns, doesn't match the lighting and the pumpkin → ATMOS (`atmos.ts`).

## New screen frame: iPhone 17 Pro Max

`layout.json` view = 440×956 pt (1320×2868 px). Hard-coded 402×874-style coordinates in your files need converting:
x' = x·440/402, y' = 478 + (y − 437)·440/402 (same FOV, camera unchanged). The demo stencil is already multiplied by `K = VIEW.w / 402` (demo/script.ts).
Main agent's sim: "Pumpkin 17 Pro Max" CA7F5A01-… (don't use this sim).

## Testing on your own sim

- Prebuilt app: `~/Library/Developer/Xcode/DerivedData/PumpkinCarve-dsxgdjrrsillkcctbuofgtjxkhja/Build/Products/Debug-iphonesimulator/PumpkinCarve.app`
  → `xcrun simctl install <udid> <path above>`. No native build needed: every JS/TS/SkSL change goes through Metro.
- Metro in demo mode on your own port: `cd app && EXPO_PUBLIC_DEMO=1 npx expo start --port <port> --dev-client`
  (8081 belongs to the main agent — don't use it). Open the app: `exp+pumpkin-carve://expo-development-client/?url=http%3A%2F%2Flocalhost%3A<port>`.
- Record + extract frames by app time: `UDID=<udid> PORT=<port> tools/simrec.sh 42 "scale=300:-1" 3.5 10.0 20.6 25.5`
  → `render/preview/simrec-<udid>.png`. Measure FPS: `UDID=<udid> PORT=<port> tools/simrec.sh fps`.
- Check that SkSL compiles without a sim: see the "SkSL check" section of `notes/main.md` below.

## Current architecture (after the "real 3D" round)

- View camera = rotation + zoom + **eye offset** (`view.ts`): turning the head → the eye moves along an arc (NECK_UP/NECK_FWD); tilting the device → the eye orbits
  the pumpkin (`ORBIT_X/Y` in PumpkinScene, yaw/pitch compensated to keep the pumpkin centred). `Basis.e` = eye position (m).
- `viewSksl.ts`: `VIEW_SKSL` (uniforms `eye`, `cam0`, `pc`, `pr`, `jW`… + `ellHit`, `pumpkinHitW`, `pumpkinXY`) and `DEPTH_SKSL`
  (`depthB`/`depthP` + `reproject()` iterating 3 times on the depth image). Depth: `bg_depth.png` / `bg_depth_pano.png`, v/255 = ln(d/0.25)/ln(800).
- The pumpkin is an analytic ellipsoid: rind/normal/mask sampled at the projection of the hit point; cut walls follow the ray through the `SHELL` thickness;
  interior = the inner back surface; billboard flame at `FLAME_W`.
- Candlelight on the porch: `candleLight.ts` is computed **once per mask change** (drawAsImage in PumpkinScene → `lightMap`), the background only looks it up.
- Rain/lightning: `rain.ts` (drawn `plus` after the pumpkin, before the match), `fx/storm.ts` (STRIKES demo 9.95 / 22.35; `synth_audio.py` reads them to place thunder).
- Fireflies removed (none in late October + rain).

## Demo timings (app seconds, `demo/script.ts`)

intro 0.3–2.9 · carve 3.2/4.2/5.2/5.9 · look around 7.5–11.1 (right 8.4–8.9, left 10.0–10.4) · lightning 9.95 · tap/jump 11.4–13.75 →
Dynamic Island ≈13.9, falls back ≈16.6 · match 18.6 · lights off 19.72 · candle flare 20.107 · tilt 21.3–24.9 · lightning 22.35 · bats 24.9–29.6.

## Known performance (debug build, main agent's sim)

- Before fixes: 32 fps with the candle lit because `atmos.ts` ran the ellipsoid ray intersection 28 times/pixel → switched to an approximate affine (`pAff`): ~60 fps.
- Candlelight computed every frame (5 sources × 2 ellipsoids × 2 masks) → moved to the cached `lightMap`.
- Still a short hitch (~0.5 s then catches up) right after the 2nd lightning strike (≈22.4) and when the bats start (≈24.9) on the debug build — cause unclear
  (suspect GC on the UI thread because Bats allocates arrays every frame, or just debug). Needs re-measuring on Release.

## SkSL check (no sim needed)

`canvaskit-wasm` is already in `app/node_modules`. Compile the TS shaders to CJS with
`npx tsc --ignoreConfig --outDir /tmp/x --module commonjs --target es2020 --skipLibCheck src/shaders/*.ts src/fx/storm.ts`, then run
node with a `Module._load` hook that replaces `react-native-skia` with `{ Skia: { RuntimeEffect: { Make: src => ck.RuntimeEffect.Make(src, err => console.log(err)) } } }`.
Duplicate uniform names / wrong types show up immediately.

## Blender (main agent)

Rendering the final version: full-res depth, window light streak cast on the floor, wet outer edge of floor/railing, sharper moon shadows, `bg_glow` = light from
inside the pumpkin (not occluded by the pumpkin). layout.json gains `depth`, `flameW`, `glowSrc`, `shell`, `roof`, `floorEdge`. Assets in
`app/assets/scene/` will change when the render finishes — nothing to do, Metro hot-reloads.

## Open items for FX (from ATMOS, 16:20) — main agent waits on these before the final recording

- (B) `pfx_atlas.ts` `CX0 = 201`, `CY0 = 437` are the centre of the old 402×874 frame → the 440×956 frame needs 220 / 478 (or take them from `VIEW`): particles off by ~19/41 pt.
- (A) match smoke (`Match.tsx`) is a screen-space sprite living ~3.5 s → stays put when the camera tilts after lighting. Anchor it in 3D with
  `basis` (`basis={basis}` is already passed to `<Match>`), or cut `SMOKE_LIFE` to ≈ 0.9 s.

## For PERF (16:40, assigned by the project owner) — can't message your tab so writing it here

- Step 3 (2x canvas) has been REMOVED per your message; steps 1+2 stay.
- Task: check the Dynamic Island → release → fall → bounce segment (app time 13.3–18.0) on Release for hitches (JumpTrail, IslandPill,
  ImpactDust on the hard landing at 16.667, drawAsImage lightMap…), fix in your files. The main agent's 16:12 Release build counted
  60 distinct frames per second in every second 0–32 (the "pumpkin hanging in mid-air" frame I reported earlier was a debug build reloaded by Metro midway).
- The main agent is about to change the rest frame (eye lowered ~8 cm, `oy`) and the 0–3 s intro in PumpkinScene → the jump's `anchor` may shift slightly.

## For FX: Gust.tsx (new intro)

The main agent will attach `<Gust time={time} basis={basis} />` in the main canvas, right after `<Particles …/>` (before rain). Gust timing:
`INTRO.gust` = 1.6 s in `demo/script.ts` (import `INTRO` from there). At that moment the camera is craning down fast (see `introView`).
Message the main agent when the file exists, or if you need another prop.

## 17:10 — main agent status

- Merged: PERF steps 1+2 (step 3 removed), atlas-hidden.patch, `t0` warm-up (demo 1600 ms, real app 700 ms), FX (basis, 2-layer Gust,
  impacts), ATMOS (atmosDepth + depth children, rain without `plus`), new intro + rest frame (`REST`, `INTRO` in demo/script.ts).
- Release 17:01 on CA7F5A01, measured with `notes/perf/fpscheck.sh` with every other sim app + ffmpeg + Blender paused (`tools/pauseall.sh`):
  4868 frames / 35.5 s, gaps > 100 ms: 22 (mostly scattered ~80–100 ms; the 2 long gaps at 0–2 s are warm-up before t=0).
- PERF: the new intro is done, you can measure (your Release needs rebuilding from the current tree).
- Waiting on: LIGHT (lightning through the carved holes, pumpkin face shadow on the wall), FX (bats spelling text), CAT (cat + leaning flame). Merge order: 3, 2, 1, 4, 5.

## 17:35 — shared clock + 120 fps recording (every tab read this)

- `app/src/scene/clock.ts`: `TIMESCALE` (EXPO_PUBLIC_TIMESCALE), `ms(d)` for withTiming/withDelay/setTimeout, `spring(cfg)` for withSpring.
  The final clip is recorded at TIMESCALE 0.5 → **all motion must come from PumpkinScene's `time`** (already scaled) or go through `ms()`/`spring()`.
  Don't use `Date.now()`/`performance.now()`/useFrameCallback's `timestamp` for visuals. Fixed: PumpkinScene, PoppedPiece (DUR → `ms`).
  BLOW: `fx/blowOut.ts` still has `withTiming(…, { duration: 240 … })` → wrap in `ms()` before merging.
- `tools/promo.sh`: `TIMESCALE=0.5 FPS=120 PAUSE_ALL=1 tools/promo.sh --beats … --out …` → 120 fps master + `<out>-x60.mp4`.

## 18:15 — final recording locked, editing the clip

- Final recording: `render/promo/v4b/` (Release, TIMESCALE 0.25, LIGHT v2, CAT A, ATMOS 7, FX bat text, PERF GPU sprites), 120/120 frames per second.
  Source as of recording: scratchpad `final-rec-src/`.
- Editing the 60 fps X version (`render/promo/pumpkin-carve-demo-v4b.mp4`), then the 120 fps master. Blender is using the GPU → **tabs please close
  the app on your sim when not needed** (a sim running the looping demo eats GPU and slows rendering ~30 %).
- Merged into the app after recording: BLOW (`notes/blow/patch.py`, including PERF's `pumpkin.ts`) and CAT B (flame follows the finger: pumpkin.ts, atmos.ts,
  background.ts, PumpkinScene; `ffFinger` split out so the React Compiler doesn't bail out of optimising). tsc + lint + SkSL clean. expo-audio native
  not built yet (BLOW step 2).

## Recording sync (18:50)

`tools/sync.py` once mistook the 2nd lightning strike (a 1-frame +70 flash) for the candle flare in v4d → FILM0 off by 2.25 s. Fixed: only score brightness
HELD over 0.6–1.4 s after the frame versus the 0.3 s average before. Cross-checked with lightning: first flash frame at film = 9.95 + FILM0 and 22.35 + FILM0.
v4d: FILM0 = 0.85 (lightning) / 0.843 (candle).

## 00:25 — Dynamic Island reverted to the old version
The project owner prefers the previous Dynamic Island (sparkling 3D mini pumpkin + BOO!, light motes flying around the pumpkin). `app/src/fx/IslandPill.tsx` was restored from
the original ISLAND version saved at 23:41; the goo version is kept at `notes/island/IslandPill.goo.tsx`, `shaders/islandGoo.ts` is no longer used.
`<IslandPill>` in PumpkinScene no longer takes the `anchor` prop. LIGHT: if you're editing PumpkinScene, keep this line.
