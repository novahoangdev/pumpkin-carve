# PERF — performance agent notes

Own sim: "Pumpkin Perf 17 Pro Max" (A68809D4-8A46-45D1-BF2B-46973F605A83), Metro 8095. Experiments on other people's files
are done in a sandbox copy (scratchpad); the real files are not touched.

## (18:45) Fast promo render — POLISH-1815 item 5

**Measured without touching v4b:** `sample` of the running v4b process (read-only) + a copy of `promo.py` running 10–40 frames in the scratchpad.
All numbers below were measured while v4b was still holding the GPU, so absolute numbers are slower than on an idle machine.

- On the main thread, 60 % of frame time sits in `eevee::ShadowModule::shadow_update_finished → MTLStorageBuf::read → usleep`.
  That's the CPU waiting on the GPU, i.e. the bottleneck is the GPU, not the CPU. Another 16 % is serial PNG compression (deflate), 15 % compositor.
- Tried one thing at a time (s/frame, same segment): baseline 2.1 (bat segment) · shadows off 1.3 · + TAA 8 instead of 16: **0.79** · turning off DOF/compositor
  is another 20 % faster but changes the image, so not used · motion blur is almost free · TAA 6/4 is no faster than 8.
- **Quality** (PSNR / SSIM vs baseline, 10 frames per segment): TAA 8 vs 16 on the bats-diving-at-the-lens segment 69 dB / 0.99993, the
  carving close-up (DOF) 70 dB / 0.99991. Shadows off vs on 68 dB / 0.99998: the scene is almost all Emission (background, screen, text,
  glass), shadows only fall on the titanium frame, buttons and bats. Indistinguishable by eye.
- **Parallel** (40 frames): 1 process 40 s, 2 → 25 s, 3 → 22 s, 4 → 21 s. Use 3. Joining the segments with concat copy is identical to the
  1-process version (PSNR 94 dB, most frames bit-identical). F-curve noise and rng are deterministic, independent of order.
- **Disk: only 11–12 GB free.** PNG ~3 MB/frame, so 120 fps (4140 frames) needs 12.4 GB and would fill the disk. The new version writes H.264
  lossless straight from Blender (0.8 MB/frame, 3.3 GB for 4140 frames), no PNGs. The old `render/promo/frames` takes 5.5 GB, can be deleted
  if not needed.
- "Render the mockup once and composite with ffmpeg" not done: the screen sits under the device's DOF, bloom, motion blur and perspective, compositing
  outside would lose quality.

**Apply:**
```bash
patch -p1 < notes/perf/promo-fast.patch      # promo.py: PROMO_FAST=1 (shadows off + TAA 8), --range a,b, --video out.mp4 (H.264 lossless)
cp notes/perf/promo_par.sh tools/ && chmod +x tools/promo_par.sh     # original: /private/tmp/claude-501/-Users-hoanghoa-Documents-git-personal-repo/24833126-771f-42d8-a7cf-f9519fea1710/scratchpad/promo_par.sh
BEATS=blender/scripts/beats/v4.json SCREEN=render/promo/v4b/screen-120.mp4 FILM0=<as promo.sh detects> FPS=120 \
  FINAL=render/promo/pumpkin-carve-demo-120.mp4 tools/promo_par.sh       # WORKERS=3 default; PROMO_FAST=0 = original quality
#   → 120 fps master with audio + …-x60.mp4 (even frames, no frame blending). Tried MAXF=90 → 36 s, all frames, with audio.
```
`promo_par.sh` replaces steps 5–6 of `promo.sh` (the FILM0 detection step stays). The patch changes nothing when the flag is off, so v4b and earlier
renders come out exactly as before.

**Real numbers (18:32–18:38, full pass 4140 frames 120 fps, 3 processes, GPU still shared with 4 other sim apps):** each process
1.18 frames/s, i.e. 3 processes ≈ **212 frames/min**. 120 fps (4140 frames) ≈ **19.5 min**; 60 fps (2070 frames) ≈ **10 min**.
Baseline is 37 frames/min. Running under `tools/pauseall.sh` (stops the other sims) will be faster. The measuring pass stopped midway because the main agent started
recording (`pauseall` STOPped my Blender processes), so I cancelled it to not fight over the GPU; all test files deleted.

If extra time is needed for 21:15: run `WORKERS=3 tools/pauseall.sh tools/promo_par.sh …`, don't open the app on the sims while rendering.

## (17:50) 120 fps recording: slow-motion capture + time compression — TESTED ON THE PERF SIM, WORKS

**Script:** `/private/tmp/claude-501/-Users-hoanghoa-Documents-git-personal-repo/24833126-771f-42d8-a7cf-f9519fea1710/scratchpad/rec120.sh` (copy: `notes/perf/rec120.sh`) → main agent moves it into `tools/`.

```bash
# the app must be built/bundled with the same EXPO_PUBLIC_TIMESCALE (Release: EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_TIMESCALE=0.25 npx expo run:ios --configuration Release …)
UDID=CA7F5A01-D288-47E0-9CED-0EFBED4178D1 TS=0.25 SECS=34 OUT=render/promo/v120 notes/perf/rec120.sh
#   → raw.mov (real recording ~2.5 min), screen-120.mp4 (setpts=PTS*TS, fps=120, CRF 12), screen-60.mp4 (even frames of the 120 version,
#     no blending), check.txt (mpdecimate: distinct frames per demo second)
TS=0.25 OUT=… RAW=existing.mov notes/perf/rec120.sh     # reprocess only
```

**Test result** (debug + Metro sandbox = real code at 17:30 + the patch below, TS=0.25, host machine overloaded — the real-time recording
was frozen 53 %, 202 gaps > 100 ms): master 33.9 s, **120 distinct frames in every second** (a few seconds 119; the whole clip has only 4 frames repeating
a 1/120 s slot), 60 fps version **60/60 every second**. Stills at 2/6/12/18/24/30 s: `notes/perf/v120-test/strip.jpg`, numbers:
`notes/perf/v120-test/check.txt`. So slow capture also wipes out the simulator's stutter: every frame gets 4× the time to draw.

- TS = 0.5 also works, but the simulator recorder jitters → some 1/120 s slots get duplicate frames. 0.25 has 2× headroom, so it's safer.
- Audio sync: `tools/sync.py` runs on `screen-120.mp4` (already in demo time), the candle flare is still at 20.107.
- `promo.sh`/`promo.py` currently conform and render 60 fps → need to render at 120 (`fps=120`, `-framerate 120`) for the master
  `render/promo/pumpkin-carve-demo-120.mp4`, then the X version takes even frames like `screen-60.mp4`.
- PerfHud: don't enable `EXPO_PUBLIC_PERF` while recording.

**Audit "all motion goes through the demo clock"** (grep withTiming/withSpring/withDelay/withDecay/Date.now/setTimeout/
useFrameCallback/dt in `app/src`):

| Where | Status |
|---|---|
| Scene clock `time` (`PumpkinScene` frame callback × `TIMESCALE`) → shaders (rain, fog, flame, lightning), Particles, Bats, ImpactDust, Gust, Smoke, BlackCat, Match, IslandPill, jump.ts (physics on `time`'s dt), storm, demo script | ✓ (main agent did it) |
| `lightUp` (porch/candle/flash/matchFade/burn/uiFade), `headerStyle`, `PoppedPiece` | ✓ already wrapped in `ms()` / `spring()` |
| **`scene/clock.ts` `spring()`**: defaults mass 1 / damping 10 / stiffness 100 (Reanimated 3) | ✗ **wrong even at TIMESCALE = 1**: Reanimated 4.7 defaults are mass 4 / damping 120 / stiffness 900, so the old `withSpring(1, {damping: 7, stiffness: 120})` ran with mass 4; now mass 1 → the candle flare oscillates 2× faster and settles slower. Fixed in the patch |
| **`fx/blowOut.ts` `extinguish`**: candle 240 ms, porch flicker 40/90/50/120/260 ms + `PORCH_BACK_MS` | ✗ not scaled (the demo blows the candle out via the `demoBreath` script) → wrapped in `ms()` in the patch |
| `fx/flameFollow.ts`: `dt = clamp(t − last, 1/240, 1/20)` | ✗ at TS ≤ 0.25 on 60 Hz the real dt = 1/240 → right at the bound; smaller TS makes the spring run faster than the demo. Lower bound changed to 1/2000 |
| `fx/Match.tsx`, `blowOut` gust: integrate on `time`'s dt | ✓ (smaller dt → smoother, same shape) |
| Haptic `setTimeout` in `onLit`, `batHaptics` | doesn't affect the image (could wrap in `ms()` for correct timing when testing by hand) |
| Gestures (withDecay/withSpring when dragging to look around, match, reset) | only run outside DEMO — skipped |
| Wait for `t0` (1600 ms before t = 0) | real time, intended (waiting for shaders) |

```bash
patch -p1 < notes/perf/timescale-fixes.patch     # scene/clock.ts (R4 defaults), fx/blowOut.ts (ms()), fx/flameFollow.ts (dt min)
```
(Tested in the sandbox above; `tsc` clean.)

## Release 17:01: Atlas log is gone (0 `non-invertible` lines over the whole demo). The 17:05 video measurement is meaningless because 6 PumpkinCarve apps were running at once — see "Recording the simulator…" item 2.

## (16:50) — Release stutters at flip → fall → bats: Atlas prints a warning per sprite, per frame

**Cause.** `fx/pfx_atlas.ts` `useSpriteBuffers` (used by Particles, ImpactDust, Bats, Match) and `fx/Gust.tsx` "hide" spare sprites
with `RSXform(0, 0, 0, 0)`. A scale-0 matrix is non-invertible → Graphite `Device::drawAtlas` calls
`SkLog("[skia] WARNING - Skipping draw with non-invertible/non-finite transform")` for **every spare sprite, every frame**, written to stderr.

**Evidence.**
- `xcrun simctl launch --console-pty` on the 16:13 Release build: **974 408 warning lines in 30 s** (~32 000/s). Current debug code
  (sandbox, with console): 1 589 590 lines in ~18 s of demo. After the fix: **0**.
- `sample` of Release, app time 13.5–18.5 (flip/release/fall): Skia render thread 2696 samples in `produce()`, **2457 samples (91 %) in
  `SkLog → vfprintf → write`**. So the render thread is almost only printing logs → dropped frames. The bat segment (Bats, 4 large Atlases) is even heavier.
- The debug build barely shows it because its stderr is buffered (write = 0 samples), so measuring on debug doesn't reveal it.

**Fix (diff for FX, 4 lines of logic):** hidden sprite = scale 1e-3 (invertible) placed off screen (−1e4); `put()` with scale ≈ 0/NaN
pushes a hidden sprite with alpha 0. No visual change.

```bash
patch -p1 < notes/perf/atlas-hidden.patch      # app/src/fx/pfx_atlas.ts, app/src/fx/Gust.tsx
```

Check after a Release build: `xcrun simctl launch --console-pty <udid> dev.hoanghoa.pumpkincarve | grep -c non-invertible` (Ctrl-C
after ~20 s) must give 0. **Rule for every new Atlas:** never set RSXform (0,0,0,0); use `HIDDEN_XF`.

### Release 16:13 per segment (before the Atlas fix), measured from the recorded video

`% frozen` = total missing-frame time (gap − 16.7 ms) / segment length. Background control (light animation in Safari on the same sim, at the same
time) ≈ 8 % — due to the host machine/recorder.

| intro 0–3 | carve | look around | jump | flip 13.8–16.6 | fall 16.6–18.4 | match | candle flare | lit | bats |
|---|---|---|---|---|---|---|---|---|---|
| **32 %** (450 ms stutter right at t≈0) | 9 % | 8 % | 11 % | 11 % | **17 %** | 8 % | 17 % | 20 % | **36 %** |

**Intro (for the main agent, `PumpkinScene.tsx`):** 2–3 stutters of 400–450 ms in the first ~0.8 s after t=0 = first-time shader pipeline
compilation (background, pumpkin, rain, fog, Atlas…). Proposal: hold the clock at t=0 longer so the shaders finish compiling before the intro runs:

```diff
-    if (t0.value < 0) t0.set(timestamp + 120); // wait a few more frames for textures to reach the GPU
+    if (t0.value < 0) t0.set(timestamp + 700); // wait for shaders to compile (Release stutters 400 ms in the first 0.8 s if it only waits 120 ms)
```

The new intro (near-black screen 0–0.45 s, then lightning) hides the rest; will re-measure once the new intro is done (FEEDBACK-1630 item 3b).

## (17:20) Stutter when effects first appear — the main agent's 16:39 recording

`notes/perf/fpscheck.sh 0 render/promo/raw.mov`, mapped to app time (candle flare = 20.107): frozen intro 21 %, carve 8 %, look around 8 %,
jump 15 %, flip 10 %, fall 13 %, match 9 %, **candle flare 31 %**, lit 15 %, bats 18 % (noise floor ≈ 8 %).

- A pair of ~80 ms gaps regularly every ~1.4 s through the clip: also present in the Safari control → machine/recorder, not the app.
- The remaining 110–200 ms hits land exactly on **the first time an effect appears**: 0.8–0.95 s and 1.6–1.7 s (opening lightning, leaf gust), 17.0 (impact
  dust when the pumpkin lands), 20.8 (flame/smoke after the candle flare), 22.6 (lightning 2), 27.2 (bats). Two causes seen in Release `sample`:
  1. **FX sprite images are raster** (`useImage` in Bats, Particles, ImpactDust, Match, Smoke, Gust) → the render thread uploads + builds mipmaps
     on the CPU on the effect's first frame (bat sheet 2048×3072 = 25 MB + mips). Fix: `useGpuImage(SHEET, { mipmapped: true })`:
     ```bash
     patch -p1 < notes/perf/fx-gpu-sprites.patch     # 6 FX files, only the useImage + import lines change; tsc + eslint done
     ```
  2. **First-time shader pipeline compilation** right on the render thread (`PipelineManager::InlineCompile`, 121 ms in the first 9 s). Cheap option
     if there's time: during the 1.6 s wait before t=0 (already in DEMO), draw each effect for one frame at opacity 0.01 so Skia compiles ahead.
     Not done because it means editing many FX files; lower priority than 1.

## Measure it right: use the recorded video, not in-app fps

The in-app frame callback clock (`PerfHud`, `[perf] ui=`) only measures the UI thread. Skia draws on its own thread pool and **drops frames** when
the GPU/render thread is late, so the app can report 60 fps while the screen is frozen. The right metric for the clip is the gap between frames
in the simulator recording (the simulator only writes when the screen changes):

```bash
UDID=<sim> notes/perf/fpscheck.sh 36            # terminate + launch app then record 36 s, print gaps > 34/50/100 ms per recording second
UDID=<sim> notes/perf/fpscheck.sh 0 raw.mov     # analyse an existing recording
```

The posted v3b (`render/promo/v3b/raw.mov`): 77 gaps > 50 ms, clustered from right after the candle flare to the end of the bats (recording seconds 23–32).
The old "distinct frames per second" count was inflated because the 3 canvases present a few ms apart → 2–3 frames written in 1 vsync.

**Step 3 (main canvas at 2x) — WITHDRAWN.** A/B from recorded video gave contradicting results between runs (host load 10 one time, 100+ another),
inconclusive; the main agent removed it (16:31). Don't apply `patch_scene_main.py`.

---

## TL;DR — 2 things for the main agent to merge (biggest, do before recording) — MERGED 16:07; step 3 added below

| # | Fix | Where | Measured effect |
|---|-----|-------|------------------|
| 1 | Scene images → **GPU images** (`useGpuImage`, `toGpu`) | `PumpkinScene.tsx` (5 lines) + `perf/gpu.ts` (exists) | Skia render thread: 3.9 s CPU / 7 s → 0.7 s / 5 s; no more texture re-upload every frame |
| 2 | **Fog (atmos) drawn on its own canvas at 1/3 pixel density** | `PumpkinScene.tsx` | Volumetric atmos version (15:27): whole clip ~15 fps, 1.2 s stutter at the candle flare → ~50–60 fps (measured at the same time) |

Apply (from the `pumpkin-carve/` directory):

```bash
patch -p1 < notes/perf/scene.patch                       # if PumpkinScene.tsx hasn't changed since 16:00
# or, more robust if the file has changed (replaces by anchor string, errors out if an anchor is missing):
python3 notes/perf/patch_scene.py app/src/scene/PumpkinScene.tsx app/src/scene/PumpkinScene.tsx
cd app && npx tsc --noEmit && npx eslint src/scene/PumpkinScene.tsx
```

No native build needed (JS only). Typechecked + linted on the sandbox copy = the real file at 16:00 + patch.

### 1. Why: the 128 MB texture cache thrashes

`useImage` returns a raster (CPU) image. Graphite only draws GPU images, so RN Skia uploads through a shared cache, **capped at 128 MB**
(`node_modules/react-native-skia/cpp/rnskia/RNImageProvider.h`, `kDefaultBudgetInBytes`). The scene binds ~220 MB of decoded images
at once (RGBA 8888):

| image | size | MB |
|-----|-----------|----|
| `bg_lit/dark/glow_pano.jpg`, `bg_depth_pano.png` | 3200×2400 ×4 | 123 |
| `bg_lit/dark/glow.jpg`, `shadow_lit/dark.png`, `bg_depth.png` | 1206×2622 ×6 | 76 |
| `lightMap` (drawAsImage) | ~1206×2622 | 13 |
| skin/interior/data, flesh, mask, blur | | ~13 |

→ the LRU evicts and re-uploads tens of MB **every frame**. `sample` (macOS) while carving: 3479/7000 samples of the `RNSkia Render 3` thread are in
`DawnContext::upload → TextureFormatXferFn::run → memmove`. After the fix: 0 upload samples.

`toGpu(img)` = `img.makeTextureImage()` (uploaded once on the JS thread at load, outside the cache, shared by every canvas without copying).
`useCarveMask.ts` already uses it for mask/blur (my file). The patch changes 16 `useImage` → `useGpuImage` and `setLightMap(toGpu(img))`.

### 2. Fog at 1/3 density

The new `atmos.ts` is a volumetric ray-march: 11 samples/pixel × `lightAt` (with the candle lit: 2× `through()` = 2 ellipsoids + 4 mask reads), smoke 3
loops, running on the **whole screen 1320×2868 = 3.8 MP**. Fog and light shafts are soft anyway, so draw it on a separate canvas 3× smaller (440×956
px), scaled back up by the View's transform (Core Animation, bilinear) → the GPU does 9× less work for the heaviest layer. Layer order is kept with
3 stacked canvases:

1. main canvas (with GestureDetector): background → pumpkin → dust → collapsed rind/debris/knife strokes → rain → match
2. fog canvas (View `width/3 × height/3`, `transformOrigin: "0 0"`, `scale: 3`, `pointerEvents="none"`), Group `fitTransform / 3`
3. top canvas (pointerEvents none): bats, black screen, virtual finger, IslandPill

Screen shake (`fitTransform`) runs off the same shared value so the 3 layers shake in sync. Change `ATMOS_DOWN` (1 = as before, 2, 3) to compare.
Comparison images left = full, right = 1/3: `notes/perf/cmp-9.9.jpg` (lightning), `cmp-21.5.jpg` (just lit), `cmp-26.jpg` (bats), 1:1 crop
`crop-21.5.jpg` (the two captures are a few frames apart, so smoke/tilt differ slightly). Fog/light shafts look the same; the only difference: film grain
(grain in atmos) is 3× coarser.

**For the atmos agent (if still editing `atmos.ts`):** the shader now runs at 1/3 density, so the per-pixel `fract(52.98…)` dither will be 3× larger —
if you see banding, switch to dithering on `xy * 3.0` or drop it. Film grain (`grain`) is also 3× coarser → better move grain to a
full-res layer (e.g. a small `Fill` in the top canvas) or reduce its amplitude. Don't add ray-march samples since this layer is cheap now; prefer keeping ≤ 11 samples.

## Step 3 (WITHDRAWN, see above): main canvas at 2x density

Steps 1+2 merged (16:07). Step 3 draws the main canvas (background, pumpkin, rain, match…) at 1/1.5 density = 2x instead of 3x, scaled back up by the View's
transform; the fog canvas (1/3) and the top canvas (bats, IslandPill, virtual finger — full res) are unchanged. Gestures move to a transparent View
covering the screen, above the canvases and below the UI → coordinates are still screen pt, gesture logic unchanged.

```bash
python3 notes/perf/patch_scene_main.py app/src/scene/PumpkinScene.tsx app/src/scene/PumpkinScene.tsx   # or patch -p1 < notes/perf/scene_main.patch
```

- Back-to-back A/B (same machine load): `MAIN_DOWN = 1` → 33–44 fps; `1.5` → 43–58 fps (debug, sim 60 Hz).
- 1:1 images on a 3x screen (left 3x, right 2x): `notes/perf/main2x-crop-6.5.jpg`, `main2x-crop-21.5.jpg` — very slightly softer. The X clip puts the phone
  at ~1300 px tall in a 1920×1440 frame, i.e. ~45 % of native resolution → 2x (1912 px tall) still has headroom, no visible difference.
- For an absolutely sharp recording keep `MAIN_DOWN = 1` (steps 1+2 still apply).

## Measuring

- Overlay: `EXPO_PUBLIC_PERF=1` → `src/perf/PerfHud.tsx` (mounted in `IslandPill.tsx`, outside the pill's Group): 120-frame graph
  (lines at 8.3 / 16.7 / 33 ms), `ui` fps = Reanimated frame callback rate (the Skia thread reads shared values), `drop` = frames > 1.5× the shortest
  interval, `js` = requestAnimationFrame on the JS thread. Every 0.5 s prints `[perf] t=<app time> ui=… uiMax=… drop=… js=… jsMax=…` to the
  Metro console → easy to map to the demo script.
- `EXPO_PUBLIC_PERF_RELOAD=http://localhost:8096/reload.txt`: the app calls `DevSettings.reload()` when the URL's content changes (to rerun the demo
  from the start without tapping the "Open in…" dialog). Only with PERF=1.
- All off when the variables aren't set (no effect on recordings).

### Results (debug build, sim 60 Hz, machine running 5–6 other sims + renders, load avg ~500 → absolute numbers are noisy, compare relatively)

Average fps per script segment (min, longest frame):

| build | intro | carve | look around+lightning | jump | flip | match | candle flare | lit+tilt | bats |
|-----|-------|------|----------------|------|-----|----------|----------|--------------|-----|
| base1 (old atmos 28 taps, 14:50) | 46 | 42 | 52 | 51 | 54 | 50 | 42 (205 ms) | **16** | **15** |
| old atmos, god rays off | 40 | 44 | 58 | 54 | 37 | 35 | 29 | 46 | 37 |
| base2 (volumetric atmos 15:27) | 23 | **15** | **16** | **15** | 18 | 22 | **5 (1174 ms)** | 14 | 9 |
| + fog 1/3 | 57 | 35 | 48 | 42 | 44 | 52 | 56 | 51 | 54 |
| + fog 1/3 + GPU images | 51 | 40 | 47 | 56 | 59 | 59 | 59 | 60 | 55 |

(The last 3 rows were measured a few minutes apart; after that the machine got even more loaded so later A/B runs only reached ~30 fps for both builds — use the profiler instead of fps.)

Remaining stutters (debug): 0.1–0.5 s right when a carved hole finishes (JS thread: CPU mask draw + candle-light `drawAsImage` with readback +
React commit) and scattered ones from the host machine. Needs re-measuring on Release + an idle machine (last section).

## Suspects examined

- **Heavy shaders:** atmos (above) ≫ rain (8 cylinder layers + depth) ≈ background (`reproject` 4 depth reads + ~10 images) > pumpkin (only ~15 % of the screen).
- **Mask redraw:** only when the hole list changes (useMemo) — fine. Mask/blur are now GPU images.
- **JS thread / re-renders:** the demo doesn't re-render React every frame (everything goes through shared values). Re-renders only when a carve finishes / on lighting.
  Worklets take ~8 % of the main thread (fine).
- **Large images / decode:** decoding happens in `useImage` at app launch (before t=0 since the clock waits for `ready`). The real problem was re-upload (item 1).
- **Haptics / audio:** `expo-haptics` is called async via `scheduleOnRN`, not visible in the profile. No audio in the app.
- **GC:** Hermes `hades` runs concurrently, no long pauses seen in `sample`.
- **Main thread** now mostly waits on the GPU (`waitUntilScheduled` in `presentRecordings`) → the remaining limit is the host GPU.

## Recording the simulator with the least resources (for the main agent)

1. **Release** build (Hermes JS bytecode, no dev-client/HMR/LogBox, worklets without debug checks):
   `cd app && EXPO_PUBLIC_DEMO=1 npx expo run:ios --configuration Release --device CA7F5A01-D288-47E0-9CED-0EFBED4178D1 --no-bundler`
   (do NOT set `EXPO_PUBLIC_PERF` — the overlay would end up in the clip).
2. **Most important.** At 17:05 there were 7 Pumpkin sims up and 6 PumpkinCarve processes all drawing the heavy scene on ONE GPU + Blender
   `promo.py` → the 17:01 Release recorded on the Perf sim was frozen ~70 % in every segment (gaps 400–800 ms), even with the code fixed. While recording, pause
   everything (kill -STOP, auto `-CONT` when done — `promo.sh` already has `PAUSE_PATTERN`):
   ```bash
   PAUSE_PATTERN='Devices/(EA6AE9EA|0DCEAC26|8B860304|56130AAC|57B21943|A68809D4)[^ ]*/PumpkinCarve\.app/PumpkinCarve$|Blender|ffmpeg' \
     tools/promo.sh --beats blender/scripts/beats/v3.json
   ```
   (UDID = Atmos, Blow, Cat, FX, Light, Perf — every sim except "Pumpkin 17 Pro Max" CA7F5A01. Check first: `pgrep -fl "$PAUSE_PATTERN"`.)
   After recording run `UDID=CA7F5A01-D288-47E0-9CED-0EFBED4178D1 notes/perf/fpscheck.sh 0 render/promo/<version>/raw.mov` — target:
   gaps > 50 ms close to 0 after t=0.
3. `recordVideo --codec=h264` (already used): hardware encoder, lighter than the default `hevc`. No fps/resolution options — the simulator
   writes real frames (VFR); `promo.sh` already conforms to `fps=60` by pts. Don't run ffmpeg transcodes in parallel while recording.
4. You can close/minimise the Simulator.app window: `simctl io recordVideo` reads the sim's framebuffer, no window needed (less WindowServer work).
5. Check before rendering: `UDID=… tools/simrec.sh fps` or `ffmpeg -i raw.mov -vf mpdecimate,showinfo -f null -` to count distinct frames
   per 0.5 s — target ≥ 55 in every segment.

## Files I changed / added

- `app/src/perf/PerfHud.tsx` (new): overlay + log + remote reload, only with `EXPO_PUBLIC_PERF=1`.
- `app/src/perf/gpu.ts` (new): `toGpu`, `useGpuImage`.
- `app/src/fx/IslandPill.tsx`: mounts `<PerfHud>` (when PERF=1).
- `app/src/carve/useCarveMask.ts`: mask/blur → GPU images.
- `notes/perf/patch_scene.py`, `notes/perf/scene.patch`: proposal for `PumpkinScene.tsx` (steps 1+2, merged).
- `notes/perf/patch_scene_main.py`, `notes/perf/scene_main.patch`: step 3 (WITHDRAWN).
- `notes/perf/atlas-hidden.patch`: Atlas log fix (FX: `pfx_atlas.ts`, `Gust.tsx`).
- `notes/perf/fpscheck.sh`: measures gaps in a recording.
- `notes/perf/rec120.sh` (original in scratchpad), `notes/perf/timescale-fixes.patch`, `notes/perf/v120-test/`: 120 fps recording.
- `notes/perf/fx-gpu-sprites.patch`: FX sprites → mipmapped GPU images (`perf/gpu.ts` gains a `mipmapped` parameter).
- `app/src/shaders/background.ts`, `pumpkin.ts`: skip reading the "lit" image when the porch light is fully off, skip the "dark" image when fully lit and no lightning (checked SkSL + screenshots).
