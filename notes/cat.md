# CAT: black cat on the railing + flame that follows the finger

Agent CAT owns: `app/src/fx/BlackCat.tsx`, `app/src/fx/flameFollow.ts`, `app/assets/fx/cat/` (Codex sprites + `make_atlas.py`
→ `cat_atlas.png`), this file. Every change to files owned by other agents is a proposal below for the main agent to merge.
Tested in a sandbox copy of the app (scratchpad) on the "Pumpkin Cat 17 Pro Max" sim, Metro port 8098, demo mode.

## (A) Black cat on the railing: done

**What it does in the demo**
- 0–16 s: the cat sits on the FAR end of the back rail (x −1.72 m), pose A (body in profile facing left, head turned to the
  camera, tail up like a question mark). Out of frame at rest. When the camera looks left (≈9.3 s) you only see two
  yellow-green eye glints. **Strike 1 (9.95)** lights the sky behind it: a crisp black silhouette with a cold rim light,
  the bolt right behind it, tail swishing. After the flash only the eyes remain (blinking).
- 19.8 s: it has moved, unseen, to the NEAR end of the rail by the corner post (x −0.66 m), pose B (profile facing right,
  head lowered, staring down at the pumpkin, tail hanging over the rail). It arrives in the dark right after the porch
  light goes off (19.72), and its eye catches the candle from ≈20.5. In the rest frame it sits upper left, left of the lantern.
- **Strike 2 (22.35)** reveals it staring at the lit pumpkin, so it has turned its head since the last strike.
- 24.9 s: the bats burst out and the cat is gone (eyes snap shut).
- App mode (not demo): each strike rolls a new state (far pose A / near pose B / far pose C / gone); eyes come and go.

**How**
- The sprite is 3 Codex silhouettes (`assets/fx/cat/raw/cat_{a,b,c}.png`). `make_atlas.py` splits each into body / tail /
  eye mask. The atlas is grayscale (3×3 cells) because the iOS texture can come back as BGRA: an RGB-packed atlas came out
  green.
- In 3D, the cat is a camera-facing billboard anchored at a world point on the rail top (y 1.52, z 0.885), projected
  every frame from the view basis. Size follows depth, so it stays correct under yaw, pitch, zoom, the new rest frame and
  tilt.
  - **Catch:** measured on the sim, the background draws the thin rail without the eye-shift parallax. The depth
    reprojection picks the sky behind a 5 cm rail. A true projection put the cat 16 pt (rest frame) to 30 pt (look-left)
    above the drawn rail. So `BlackCat` projects from the base camera position (`FOLLOW_BG = true`), and the cat now sits
    exactly on the drawn rail in both views.
  - If PERF makes the background reprojection exact for thin objects, set `FOLLOW_BG = false`.
- Lighting:
  - Rim lights from the silhouette alpha toward each light's screen direction: moon (MOON_DIR), the current bolt
    (STRIKES az/el), the porch lantern (1/d²) and the candle (warm, 1/d²).
  - Body is near-black at 16 % opacity in the dark and fully opaque during a flash.
  - Distance haze. The fog canvas is drawn on top, so ground fog covers it by depth like the rest of the scene.
- The tail is bent in the shader: a twirl around the tail root whose angle grows along the tail. It gives a continuous
  swish plus an occasional flick, with no extra frames.
- Perf: one rect the size of the cat (~100 pt) and ~12 texture taps per pixel. While the cat is away the rect has width 0.

**Merge into `PumpkinScene.tsx`** (2 lines):
```diff
 import { Gust } from "../fx/Gust";
+import { BlackCat } from "../fx/BlackCat";
@@ main canvas, right after <JumpTrail …/> (behind the pumpkin, rain and fog draw over it)
               <JumpTrail trail={jump.trail} time={time} />
+              <BlackCat time={time} basis={basis} storm={storm} porch={porch} candle={flick} />
```

## (B) Flame follows the finger: `fx/flameFollow.ts`

**What it does**
- After the candle is lit, a finger touching or dragging near the pumpkin (within ~1.7 pumpkin widths) makes the flame
  lean toward it. The light beams through the carved face and the smiley pattern on the floor swing toward the finger, as
  if the pumpkin were watching it.
- The motion is a spring with inertia: snappy with a small overshoot while touching. On release, a soft spring lets the
  flame sway back upright over about 1 s.
- A fast finger acts as wind. The flame stretches (×1.45 max), gets thinner, flickers harder, and is dragged along the
  stroke. The candle light flickers harder too.
- Output is one shared value `ff = { lean, stretch, gust, off }`. `off` is the light source moved up to 2.2 cm AWAY from
  the finger, so beams through a fixed hole swing TOWARD it.

**Demo segment: virtual finger plays with the flame** (`flameDemoFinger`, positions are relative to the flame in pumpkin
widths, so they follow any camera or rest frame). Proposed time: `FF_DEMO.at = 20.55` (flame has settled after the burst
at 20.107), length 1.85 s:
`0–0.3` finger appears right of the flame → `0.3–1.1` slow arc over the top to the left (flame and beams follow) →
`1.1–1.4` fast swipe back to the right (gust: flame stretches and flickers) → `1.4–1.8` hold, then lift (flame sways back).
It ends ≈22.4, right when strike 2 (22.35) reveals the cat staring at the pumpkin, so the two beats chain.
- Overlap: `demoTilt` starts at litAt + 1.2 ≈ 20.9, so the finger and the tilt overlap for 1.5 s. Two options for the
  main agent:
  1. Leave the overlap. It still reads, since the flame leans with tilt + finger.
  2. Cleaner: start the tilt at litAt + 2.7 (`const u = t - litAt - 2.7` in `demoTilt`, ≈22.4–26.0) and push `bats`
     24.9 → 26.4 (synth_audio follows `DEMO.bats`). The clip gets 1.5 s longer.

**Merge (B)**: these are the exact edits applied in my sandbox (`scratchpad/patch.py`). SkSL checked with canvaskit; tsc is
clean.

`PumpkinScene.tsx` (main agent):
```diff
+import { FF_DEMO, flameDemoFinger, useFlameFollow } from "../fx/flameFollow";
@@ after: const jump = usePumpkinJump({ time, anchor });
+  // the flame follows the finger (demo: virtual finger; app: real touches)
+  const touch = useSharedValue({ x: 0, y: 0, a: 0 });
+  const ff = useFlameFollow({ time, basis, finger: DEMO ? finger : touch, candle, jumpOff: jump.off, width: anchor });
@@ frame callback, just before: if (DEMO && litAt.value >= 0 && batsAt.value < 0 && t >= SCRIPT.bats) …
+    if (DEMO && litAt.value >= 0) {
+      const [ffx, ffy] = flameScreen();
+      const g = flameDemoFinger(t - FF_DEMO.at, ffx, ffy, anchor.value.w);
+      if (g) finger.set(g);
+    }
@@ flick: stronger flicker in the wind
-    const n = Math.sin(t * 11.3) * 0.06 + Math.sin(t * 23.7 + 1.3) * 0.04 + Math.sin(t * 5.1 + 0.4) * 0.05;
+    const n = (Math.sin(t * 11.3) * 0.06 + Math.sin(t * 23.7 + 1.3) * 0.04 + Math.sin(t * 5.1 + 0.4) * 0.05) * (1 + 1.6 * ff.value.gust);
@@ pU
-    lean: -tilt.value[0] * 0.9 + Math.sin(time.value * 1.7) * 0.08 - jump.rot.value * 2,
+    lean: -tilt.value[0] * 0.9 + Math.sin(time.value * 1.7) * 0.08 - jump.rot.value * 2 + ff.value.lean,
+    fStretch: ff.value.stretch,
+    fGust: ff.value.gust,
+    fTip: ff.value.tip,
@@ aU (after flash: flash.value,)
+      fOff: ff.value.off,
@@ bgU (after lk: …)
+    fOff: ff.value.off,
@@ real touches (app mode): any finger anywhere, alongside pan / tap / pinch
-  const gesture = Gesture.Race(pinch, pan, tap);
+  const touchG = Gesture.Manual()
+    .enabled(!DEMO)
+    .manualActivation(true)
+    .onTouchesDown((e) => { const p = e.allTouches[0]; const [x, y] = toDesign(p.x, p.y); touch.set({ x, y, a: 1 }); })
+    .onTouchesMove((e) => { const p = e.allTouches[0]; const [x, y] = toDesign(p.x, p.y); touch.set({ x, y, a: 1 }); })
+    .onTouchesUp((e) => { if (e.numberOfTouches === 0) touch.set({ ...touch.value, a: 0 }); })
+    .onTouchesCancelled(() => touch.set({ ...touch.value, a: 0 }));
+  const gesture = Gesture.Simultaneous(touchG, Gesture.Race(pinch, pan, tap));
```

`shaders/pumpkin.ts` (PERF): longer flame, curved lean, wind wobble, interior light following the flame tip
```diff
 uniform float  lean;       // flame lean
+uniform float  fStretch;   // flame height × (flameFollow)
+uniform float  fGust;      // wind: stronger flicker (flameFollow)
+uniform float3 fTip;       // flame tip offset toward the finger (m): interior light follows it
@@ flameCol
   float y = -q.y + 7.0;
-  q.x -= lean * max(y, 0.0) * 0.16;               // lean against the device tilt
-  float wob = (noise(float2(y * 0.22 - time * 8.0, time * 2.7)) - 0.5) * 1.6 * clamp(y / 16.0, 0.0, 1.0);
-  q.x -= wob;
-  float h = 21.0 * (0.85 + 0.15 * candle);       // flame height
+  float h = 21.0 * (0.85 + 0.15 * candle) * fStretch; // flame height
+  // lean (against the tilt / toward the finger): bends more toward the tip, like a flame pushed by air
+  q.x -= lean * max(y, 0.0) * 0.16 * (0.55 + 0.45 * clamp(y / h, 0.0, 1.3));
+  float wob = (noise(float2(y * 0.22 - time * 8.0 * (1.0 + fGust), time * 2.7)) - 0.5) * 1.6 * (1.0 + 2.2 * fGust) * clamp(y / 16.0, 0.0, 1.0);
+  q.x -= wob;
   float t = clamp(y / h, 0.0, 1.0);
-  float w = 7.2 * sqrt(t) * pow(1.0 - t, 1.25) + 0.25;
+  float w = (7.2 * sqrt(t) * pow(1.0 - t, 1.25) + 0.25) / sqrt(fStretch);
@@ main
-  float dB = length(B - flameW);
+  float dB = length(B - flameW - fTip);
```

`shaders/atmos.ts` (ATMOS): the beam source moves → beams through the holes swing (applies to both `atmos` and `atmosDepth`)
```diff
+uniform float3 fOff;       // beam light source offset (flameFollow), m
 uniform float  hidden;
@@ beams()
-          float3 fj = FLAME + (float3(hash(…
+          float3 fj = FLAME + fOff + (float3(hash(…
```

`shaders/background.ts` (PERF): the smiley pattern on the floor slides the other way, more the farther it is from the pumpkin
```diff
 uniform float  lk;
+uniform float3 fOff;       // light source offset (flameFollow)
@@
-      float2 lb = toBase(P - jW - cam0).xy;
+      float3 Pl = P + fOff * clamp(length((P - pc).xy) / 0.13 - 1.0, 0.0, 8.0);
+      float2 lb = toBase(Pl - jW - cam0).xy;
```
Cost: pumpkin +1 sqrt, atmos/background +1 add / +3 ops. No new samples.

**Result (sandbox, sim)**: `render/preview/cat-flame-floor.png` shows the floor with the finger held on the right (left
image) and on the left (right image): the smiley pattern slides toward the finger. `cat-flame-mouth.png` shows right /
left / fast swipe: during the swipe the flame visible through the mouth stretches and flickers. The test was a static
version (finger held right 1.6 s, left 1.6 s, then fast swipes, tilt off) because the debug sim (load ~40, 6 sims)
stutters too much to judge motion. The real demo segment is `flameDemoFinger` above.

## How to view
- Cat: `render/preview/cat-far-strike1.png` (strike 1: cat at the far end, eyes, bolt behind it) and
  `cat-near-strike2.png` (20.8 → 25.0: eye glint in the dark, strike 2 reveals the cat staring at the pumpkin, then it is
  gone).
- On the sim: real app + `BlackCat` already merged by the main agent. For (B), apply the diffs above, `EXPO_PUBLIC_DEMO=1`,
  look at 20.5–22.5.

## Perf
- Cat: one rect ~100×100 pt, ~12 texture taps per pixel; width 0 while the cat is away. A/B FPS on the debug sim (35 s,
  load 30–39) is within noise (mean ≈68 with the cat vs ≈72 without; per-0.5 s samples swing 8–180 either way).
- Flame follow: one small worklet per frame (a few springs, no allocations besides the output object like the other
  uniforms); shaders +a few ALU ops, no new texture samples.

## Notes for other agents
- PERF / background: the depth reprojection draws thin objects in front of the sky (the rail) without the eye-shift
  parallax: the fixed-point iteration settles on the sky depth. Measured: 16 pt in the rest frame (oy −8 cm). `BlackCat`
  works around it (`FOLLOW_BG`). If you fix it, tell me or flip the flag.
- Sorry: at 17:2x I ran `pkill -f recordVideo` while cleaning up my own recording. It may have killed a recording on
  another agent's sim (PERF was recording around then). If a recording of yours stopped early at that time, that was me.
- Tip for agents on their own sim: the "Open in Pumpkin Carve?" dialog can be accepted with
  `axe touch -x 294 -y 515 --down --up --delay 0.1 --udid <sim>` (`axe tap` does not work on that system dialog).

## POLISH-1815 (3) + (4): bats in the sky, debris (CAT now also owns `Bats.tsx`, `Particles.tsx`, `pfx_atlas.ts`)

### (3) Bats spelling HAPPY HALLOWEEN: `fx/Bats.tsx`
- In the rest frame the sky is only a narrow strip on the left (~140 pt), not enough for text 80 % of the width. So the
  camera **pans up-left to the moonlit sky** during the finale. The text is laid out in that view (`BAT_SKY` = yaw −0.36,
  pitch +0.24 from REST) and anchored in the world, so it sits in the sky between the porch ceiling and the neighbour's
  roof, with the moon behind the end of HALLOWEEN. The pumpkin stays glowing at the right edge.
  - `batLook(t − batsAt)`: the pan runs 0.5–2.4 s after the bats come out, holds through the text and the dispersal,
    and returns at 5.7–7.0 s.
- Text: Helvetica Neue bold with thin spaces between the letters (bats blur the edges). HALLOWEEN is ~72 % of the width;
  wider would run into the porch post on the right.
  - 700 bats (was 390): HAPPY 200, HALLOWEEN 345, @novahoangdev 155.
  - Bats in the text are 1.75× the gap between them, so they overlap into solid letters.
  - I tried a 900-weight font: the letter holes filled in and it stopped reading.
- Colour: in the text the bats go near-black (dark silhouettes against the bright sky). Rim: moonlight on the upper half of
  each letter, pumpkin orange on the lower half, kept low (the additive pass made the whole text orange before).
- Timing unchanged (`BAT_TIMES`, `BAT_DURATION`, so synth_audio still lines up): formed 3.0 → hold 1.2 s → fly to the
  camera 4.2–5.8.
- App mode (not demo): `sky` is false, so the text is laid out in the camera at the moment the bats come out, as before.

**Merge into `PumpkinScene.tsx`** (main agent; tested in my sandbox):
```diff
-import { Bats } from "../fx/Bats";
+import { Bats, batLook } from "../fx/Bats";
@@ frame callback, camera
-    const [dy, dp] = DEMO ? demoLook(t) : [0, 0];
+    const [dy0, dp0] = DEMO ? demoLook(t) : [0, 0];
+    const [by, bp] = DEMO && batsAt.value > 0 ? batLook(t - batsAt.value) : [0, 0];
+    const dy = dy0 + by, dp = dp0 + bp;
@@ top canvas
-              <Bats t0={batsAt} time={time} basis={basis} />
+              <Bats t0={batsAt} time={time} basis={basis} sky={DEMO} />
```
**Warning: `Bats.tsx` is already updated on disk.** Until this diff is merged, the text is built for the sky view while the
camera stays at rest, so it sits off to the upper left of the frame. Merge the diff, or tell me to switch back.

Images: `render/preview/cat-bats-text.png` (text held in the sky), `cat-bats-sequence.png` (31–35.5 s of the recording:
bats fly out → camera pans → text → fly to the camera).

### (4) Pumpkin debris: `fx/Particles.tsx` + `assets/fx/pfx_debris.png`
- 18 pieces per hole (was 34).
- They drop out of the cut and land IN FRONT of the pumpkin: small sideways spread, pushed toward the camera, uneven speeds
  (most land close, a few roll far). No more even ring.
- Heavy-tailed sizes: mostly small crumbs, a few big chunks.
- ~22 % of the flesh chunks stay stuck on the wet skin just below the cut and creep down a few mm (no shadow or wet mark on
  the floor for those).
- Less saturated:
  - lighting tint is less red;
  - the flesh / strand rows of `pfx_debris.png` are desaturated (×0.74 / ×0.78);
  - the original sheet is kept at `assets/fx/cat/pfx_debris.saturated-backup.png`.
- Image: `render/preview/cat-debris.png` (after carving under the porch light | after lighting).

### Perf
- Debris: fewer sprites (−47 %).
- Bats: 700 instead of 390 means about 1.8× the CPU work of the bat mapper and buffers during the finale. That is about
  6 s of the clip; the GPU cost is just one Atlas per pass.
- I did not measure 120 fps on a device; the debug sim is too loaded (load ~40) to tell. If PERF sees drops in the bat
  finale on Release, lower `BAT_COUNT` to ~560 and the per-line counts in `LINES` (HALLOWEEN still reads).

### Bats round 2 (review of cat-bats-text.png, 19:15)
- Dropped the @novahoangdev line; the end card has the name.
- Font: **Avenir Next Condensed Heavy** (HALLOWEEN in Bold Condensed so the letter holes stay open). Condensed gives tall
  letters for the width we have: HAPPY ~70 pt high, HALLOWEEN ~62 pt. Each line is sized by `min(max width, max height)`.
- Letter spacing is built letter by letter (`TRACKING` 0.1 × size). Do not use space characters: Avenir has no thin or
  hair space glyph and draws a filled "missing" box, which is why the earlier version came out as blobs.
- 820 bats (HAPPY 300, HALLOWEEN 520), drawn at 1.55× the gap so they overlap into solid black letters.
  - Less wing-flap and banking while held, so the edges are less ragged.
  - Pure black: pass A 0.01–0.02. The thin moon rim lights only bats on a letter's top edge (and faintly the sides),
    found from the text path when the targets are built. Interior bats get no light.
- Position: two lines in the sky gap of the BAT_SKY view.
  - HAPPY centred at 31 % of the height, below the porch ceiling edge; its Y crosses the moon.
  - HALLOWEEN at 40.5 %, above the neighbour's roof.
  - Centre x at 41.5 %, so it stays clear of the porch post on the right.
- Perf: 820 bats is ~2.1× the old bat mapper and buffers (390), only during the ~6 s finale. If Release drops frames
  there, set `BAT_COUNT` 700 with HAPPY 260 / HALLOWEEN 440; it still reads.
- Already in place: `batLook` + `sky={DEMO}` (main agent merged them). Only `Bats.tsx` changed this round.
- Images: `render/preview/cat-bats-text.png`, `cat-bats-sequence.png`.

### Bats round 3 (19:27): margins
- Both lines shrunk to ~90 % (HAPPY width 0.54 / height 63 pt, HALLOWEEN 0.684 / 56 pt) and centred in the sky gap
  (`TEXT_CX` 0.405 = middle between the left frame edge and the porch post). HALLOWEEN now has ~30 pt on each side.
- 720 bats (HAPPY 265, HALLOWEEN 455): same density as round 2 on the smaller area, and lighter on the CPU than round 2's 820.
- Only `Bats.tsx` changed; nothing to merge. Image: `render/preview/cat-bats-text.png`.
