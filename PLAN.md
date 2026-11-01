# Pumpkin Carve: Halloween pumpkin carving

> **Status (1/11, 00:40):** final cut: `render/promo/pumpkin-carve-final-v2.mp4` (60 fps, phone held still, audio `mix_final.wav`; recording `render/promo/v10` TS 0.5 60/60, FILM0 1.467, beats `v5s.json`). Old-style Island mini pumpkin + BOO!, rigid pumpkin flight (rim fixed), debris dropped, end card "Happy Halloween!". Previous cut: `pumpkin-carve-final.mp4`. Final videos are kept in the repo (see `.gitignore`). M0–M5 ✅, features in `notes/*.md`.

An iPhone demo of about 18 seconds to post on X: carve a face into a pumpkin with your finger, the rind pieces fall inside, then light the candle. The candlelight shines through exactly the strokes you just carved, making light shafts in the fog and casting the face onto the porch step. At the end of the clip a swarm of bats flies out of the pumpkin's mouth.

Plan written on 31/10/2026, Halloween itself. The goal is a postable clip by tonight (Vietnam time), so work follows the priority order in section 8: each milestone must produce something recordable before moving on.

---

## 0. Summary

**Clip story.** A wooden porch step at night, full moon, fog hugging the ground, an uncarved pumpkin, a warm yellow porch light. A finger carves the eyes, nose and mouth in turn, and each finished rind piece collapses inward with pumpkin bits spraying out. A match is dragged into the pumpkin's mouth, the porch light goes out, total darkness for 0.3 seconds, then the candle flares up. The face glows, light shafts cut through the fog, the smiling face is cast onto the porch step. Tilting the phone reveals the cut walls and the interior shifting with the viewing angle, and the flame leans with it. Finally a swarm of bats pours out of the pumpkin's mouth toward the camera, then the end card appears.

**Chosen architecture: Blender pre-renders the 2.5D layers, Skia composites in real time.**

- Fixed camera looking straight on. Blender renders the pumpkin, its interior, the background and data passes (normals, carvable area) from the same camera angle, all aligned to one `layout.json`.
- Carve strokes are a mask drawn in real time. An SkSL shader uses that mask to "cut" the rind layer: you see cut walls with thickness (pumpkin flesh), the interior and the candle inside, and light spilling out.
- The "wow" is the parallax hole. The inner edge of a carved hole is the mask shifted by the tilt angle (gyro) times the rind thickness. A pixel inside the outer hole but outside the inner hole is cut wall; inside both, you see through to the interior. Tilting the phone clearly shows a genuinely thick rind, like 3D.
- Reanimated handles the gyro, the phases (carve, light, lit, bats), springs for falling rind pieces, and the frame clock for particles and bats. Plus haptics while carving.

**Why this approach.** Rendering a freely carved pumpkin in real-time 3D (boolean mesh) is hard and tends to look bad. Blender gives nice lighting and materials, while the 2.5D shader gives a 3D feel when tilting and still runs at 120Hz. It also reuses the experience and pipeline from `goku-vs-frieza`.

### Stack

Same as `../goku-vs-frieza/app/package.json`: Expo SDK 58, RN 0.88.1, `react-native-skia` 3.8.x, Reanimated 4.7.1 + worklets 0.13, gesture-handler 3.3, expo-haptics, expo-dev-client. No `react-native-webgpu` needed (this project has no video). Must run a dev build, not Expo Go. Blender 5.2.2 at `/Applications/Blender.app`, run headless with `-b -P`; use MCP for Blender to inspect when connected. FFmpeg for the promo.

**2D assets: generate freely with Codex, no need to ask.** Used for the sky and moon, pumpkin rind texture, pumpkin flesh grain (`flesh.png`), porch wood, walls, bits and seed sprites, logo or text for the end card, and concepts to lock the art direction before building in Blender:

```sh
codex exec --skip-git-repo-check -s workspace-write "Generate <description>, no text. Save it as <name>.png in the current directory and print its absolute path."
```

If Codex fails to save the file, grab the image from `~/Library/Application Support/orca/codex-accounts/*/home/generated_images/`. Compress images before putting them in `app/assets` or `blender/textures`. Textures used in Blender must be tileable or projected to match the camera angle.

---

## 1. Art direction

- Tone: "cozy spooky", warm rather than horror. Semi-realistic, like a frame from an animated short. No gore.
- Palette: indigo night `#141a33`, blue-grey fog `#3b4a6b`, moon `#e8f0ff`, pumpkin `#f07a1a` shading to `#b34a0c` in the rib grooves, pumpkin flesh `#f6c56b`, candle flame `#ffd27a` → `#ff9a2e`, dry moss-green stem `#5b5a2e`.
- Pumpkin: round and slightly squat, 10–12 deep ribs, lightly bumpy rind, a few scratches, a curled twisted stem. Takes about 55% of the screen width, placed in the lower third.
- Background: an old wooden porch step, the base of the house wall and a dark door frame, a sky with a full moon behind thin clouds, maybe a few bare trees framing the shot. A porch light hangs at the top left (state before lighting).
- Two lighting states: **before** (warm porch light + cold moon) and **after** (only a dim moon and candlelight).

## 2. Experience and clip storyboard

| Seconds | Scene | Interaction / effect |
|---|---|---|
| 0–2 | Porch step, uncarved pumpkin, drifting fog | Slight parallax when tilting, very sparse fireflies |
| 2–9 | Carve left eye, right eye, triangle nose, jagged mouth | A knife trail follows the finger. On lift the shape closes, the rind piece collapses inward, bits and seeds spray out, with haptics |
| 9–11 | Drag the match into the pumpkin's mouth | Porch light goes out, total darkness for 0.3s, candle flares with a strong haptic. Light bursts through the carved strokes |
| 11–14 | Tilt the phone | Cut walls shift with the viewing angle, the flame leans, light shafts rotate in the fog, the face on the porch moves with it |
| 14–16 | Bats pour out of the pumpkin's mouth | About 30 bats flap toward the camera, slight screen shake |
| 16–18 | End card (done in the promo, not in the app) | |

Minimal in-app UI: a small title at the top. At the bottom, Undo and Reset buttons and a few stencils (Classic, Spooky, Cat) that carve automatically when tapped. The match sits in the bottom-right corner; drag it into the pumpkin to light it. After lighting, the UI fades out.

## 3. Carve design

- **Carvable area:** front face only. Blender exports `carvable.png`, the area whose normal faces the camera (n·v > ~0.45), excluding the stem. Strokes outside this area are clipped.
- **Strokes:** a Pan gesture on the UI thread, points smoothed (Catmull-Rom or moving average) then built into an `SkPath`. While dragging, draw a knife trail: a thin dark score with a bright highlight on one side.
- **On lift:**
  - If the stroke's start and end are close (< ~40pt) or the stroke self-intersects, close the path and fill it. That is a carved hole.
  - An open stroke becomes a thin groove (stroke ~5pt), also cut all the way through.
  - Shapes that are too small (area < threshold) are discarded, with a very light "error" haptic.
- **Mask:** an offscreen surface at about half the resolution of the pumpkin area (about 600×600). Each time a hole is added, draw the filled path into the surface and snapshot it as a uniform image for the shader. Only redraw on change. A blurred copy of the mask (for glow, rind translucency, the shadow on the porch) is computed at the same time. Undo redraws from the path list.
- **Collapsing rind piece:** when a hole closes, cut the rind image along the path (clip + snapshot) into a separate piece. That piece sinks inward: scale 1 → 0.85, darkens, drops a few pt, rotates slightly, fades over ~350ms with a spring. The hole appears right behind it.
- **Bits and seeds:** Skia Atlas with a 16-variant sprite sheet (flesh chunks, seeds, fibres). At most ~200 particles, simulated in `useFrameCallback` (gravity, rotation, bouncing on the porch, fading). Particles spawn along the hole edge when the rind piece collapses.
- **Haptics:** every ~18pt of knife stroke call `selectionAsync` (sawing feel), on rind collapse `impactAsync(Light)`, on candle lighting `impactAsync(Heavy)` then `notificationAsync(Success)`, when the bats fly out a series of Light. Called from worklets via `scheduleOnRN`, throttled.

## 4. Composite shader (composite.ts)

Layer order, back to front:

1. **Background:** blend `bg_lit` and `bg_dark` by `porchLight`. Add the face shadow cast on the porch (see below).
2. **Interior:** blend `interior_unlit` and `interior_lit` by `candle`. A procedural flame (SkSL noise, teardrop shape, white-yellow core, orange rim) placed at `layout.candle`, leaning against the gyro direction, intensity flickering with time fbm (2 frequencies + small random jolts).
3. **Rind with parallax hole:**
   - `o = (tilt.xy * k + normal.xy * k2) * thickness`, with thickness about 10–14px at mask resolution.
   - `outer = mask(uv)`, `inner = mask(uv + o)`.
   - `outer && inner` shows the interior. `outer && !inner` shows the cut wall: the `flesh` texture (vertical fibre grain), shaded by the direction of `o` (edges facing the candle get brighter as `candle` rises, with a hot orange rim). Outside `outer` is rind: blend `skin_lit` and `skin_dark`.
   - Rind translucency: when the candle is lit, the rind near hole edges glows orange (`blurMask * candle * warm`, stronger in the rib grooves where the rind is thin).
   - Hole edges get a thin dark AO line so holes have depth.
4. **God rays:** radial blur of `(mask * interiorBrightness)` outward from the candle position, 24–32 taps, drawn at half resolution then added on top, multiplied by fog density.
5. **Fog:** 2 layers of fbm drifting sideways, denser at the bottom, lit by the candle (via the god rays) and the porch light.
6. **Face shadow on the porch:** for pixels in the porch area in front of the pumpkin (`ground.png` from Blender), map back to mask coordinates with a simple perspective transform (flip vertically, squash by depth, stretch by distance) then sample blurMask (blur increasing with distance). Add candle colour. Upgrade: Blender pre-bakes `projection.exr` (mask UV per porch pixel, computed from rays from the candle).
7. **Grade:** vignette, cheap bloom (one blur of the overbright part), very light film grain, very light chromatic aberration when the candle lights.

Control uniforms: `time`, `tilt` (vec2), `porchLight` 0–1, `candle` 0–1 (overshoots on flare), `flicker`, `shake`.

## 5. Blender

Everything is built by script so it can be re-run (same as `goku-vs-frieza/blender/scripts`):

- `build_scene.py`:
  - **Pumpkin:** squashed UV sphere, rib grooves `r *= 1 - a·|sin(n·φ/2)|^p`, plus light noise displacement, solidified into a hollow shell about 1.2cm thick. The stem is a twisted curve with bevel. Principled material: colour by groove (baked from AO and curvature), varying roughness, a bit of subsurface.
  - **Candle:** a tealight inside the pumpkin and a warm point light.
  - **Scene:** wooden porch (2 steps), base of the wall, door frame, moon (emission), sky (hand-painted texture generated with Codex if needed), porch light (warm area light) plus a cold sun as moonlight.
  - Camera: mild perspective (~50mm), portrait 1320×2868 = 440×956 pt @3x (iPhone 17 Pro Max), pumpkin in the lower third.
- `render_passes.py`, EEVEE (Cycles for passes that need quality if time allows):
  - `bg_lit.jpg`, `bg_dark.jpg`: scene without the pumpkin (pumpkin hidden from camera rays but still casting contact shadows).
  - `skin_lit.png`, `skin_dark.png`: RGBA, outer rind and stem only.
  - `interior_lit.png`, `interior_unlit.png`: front half of the rind hidden from camera, showing the interior (inner wall with fibres, clinging seeds, bottom), candle off or on. The flame layer is procedural in the app, so no flame is rendered.
  - `normal.png` (camera-space normals, encoded 0–1), `carvable.png`, `ground.png` (mask of the porch area in front of the pumpkin), `flesh.png` (tileable pumpkin flesh grain texture).
  - Everything is cropped to a square frame around the pumpkin (except the background). Frame position, candle coordinates and mouth centre (where the bats fly out) are written to `app/assets/scene/layout.json`.
- `sprites.py`: renders the sprite sheets `bats.png` (silhouette bats flapping, 8 frames, orange rim light) and `chunks.png` (16 bits or seeds).
- Export at @2x relative to logical points, compressed (pngquant for PNG, JPG quality ~85 for backgrounds).

## 6. Folder layout

```
pumpkin-carve/
  PLAN.md  README.md
  blender/scripts/   build_scene.py  render_passes.py  sprites.py  promo.py
  blender/textures/
  tools/             build.sh (Blender → app/assets)  promo.sh (record simulator → 4:3 clip)
  app/               Expo SDK 58
    src/scene/PumpkinScene.tsx      Canvas, layers, phases
    src/carve/useCarveGesture.ts    pan, smoothing, path closing, carvable-area clamp
    src/carve/useCarveMask.ts       offscreen mask + blurMask, undo
    src/carve/PoppedPiece.tsx       collapsing rind piece
    src/shaders/composite.ts  godrays.ts  fog.ts  flame.ts
    src/fx/Particles.tsx  Bats.tsx  Match.tsx
    src/state/phase.ts              idle → carving → lighting → lit → bats
    src/demo/script.ts              pre-built carve strokes + fake tilt for demo mode
  render/  versions/
```

## 7. Demo mode and X clip

- `EXPO_PUBLIC_DEMO=1`: the app plays the storyboard from section 2 on its own. Carve strokes replay from hand-drawn point lists (at human speed, with a faint "virtual finger" dot). The match drags itself. The simulator has no gyro, so `tilt` follows a preset curve (slow sway left then right after lighting). The dev build also adds a two-finger drag to simulate tilt.
- `tools/promo.sh`: copied and adapted from `../goku-vs-frieza/tools/promo.sh` and `blender/scripts/promo.py`. 4:3 frame, 60fps, titanium-bezel iPhone mockup, gradient background changing colour per segment (night purple → orange → purple). Large text behind the phone: "CARVE" → "LIGHT" → "BOO". End card with the "Pumpkin Carve" logo, tagline "Carved with your finger. Lit by Skia.", credits "Expo · React Native · Skia · Reanimated · Blender", and "by Hoa Hoang · @novahoangdev". Status bar 9:41. The simulator recording must be conformed to CFR by the container's pts before editing, keep speed close to 1.0x, no cross-dissolve between two mismatched shots.
- Include a contact sheet (6 frames) and a draft X caption following the template: "React Native can carve a jack-o'-lantern 🎃✨", a one-line pitch, the lines "Expo @expo / Skia @wcandillon / Reanimated @swmansion", then a "Follow along…" line.

## 8. Build order (each milestone must be recordable)

| Milestone | Content | Done when |
|---|---|---|
| **M0** | App setup (config copied from Goku), Blender builds pumpkin + background, preview render passes, `layout.json`, scene displays correctly | Porch and pumpkin visible on the simulator |
| **M1** | Carving: gesture, mask, parallax hole, cut walls, collapsing rind pieces, haptics | Can carve a face and tilt to see rind thickness |
| **M2** | Lighting: candle, flame, lit interior, rind translucency, god rays, fog, shadow on the porch, porch light off | The candle-lighting moment looks "wow" |
| **M3** | Demo mode, record and edit the promo clip, contact sheet, caption. **This is tonight's X post** | Clip file exists |
| **M4** | Bats, bits and seeds, draggable match, stencils, fireflies, high-quality final render, re-record the clip | Clip v2 |
| **M5** | Audio (knife, candle flare, bats; synthesised with numpy like Goku or just mixed in the promo), performance measurement on a real device | |

If M0–M2 go fast, do the bats (M4) before recording M3, since they are the clip's strong ending.

## 9. Risks and mitigations

- **Skia v3 (Graphite) offscreen surface API on the UI thread:** check early in M1. If it is not stable, build the mask with a `Picture` (`Skia.PictureRecorder`) then `makeImageFromPicture`, or use `drawAsImage`. Last resort: send up to ~16 paths to the shader as simple SDFs.
- **Performance:** god rays and bloom run at half resolution. The mask only redraws on change. Particles use Atlas (one draw call). Measure on the simulator first, real iPhone later.
- **Simulator has no gyro:** use fake tilt in demo mode and two fingers in the dev build.
- **Ugly hand-drawn strokes:** demo mode uses nice pre-built stencils. Real users get smoothing and automatic path closing.
- **Slow Blender renders:** M0 uses EEVEE at 50%, only the final uses full resolution (like Goku's `PREVIEW=1 tools/build.sh`).

## 10. Chosen defaults (changeable)

- Display name "Pumpkin Carve", bundle id `dev.hoanghoa.pumpkincarve`.
- Recording device: the project's own simulator "Pumpkin 17 Pro Max" (iPhone 17 Pro Max, iOS 27.0,
  UDID `CA7F5A01-D288-47E0-9CED-0EFBED4178D1`), portrait, 1320×2868 px = 440×956 pt screen. Do not use the old 17 Pro sim.
- iOS only. Do not create a git repo or push without asking.
