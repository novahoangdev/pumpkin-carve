# ATMOS: fog, smoke, light shafts, rain, candle light

ATMOS sub-agent. Files owned: `app/src/shaders/atmos.ts`, `rain.ts`, `candleLight.ts`, `app/src/fx/storm.ts`, `notes/atmos.md`.
Doesn't touch the main agent's files, no need to change any uniform or child shader in `PumpkinScene.tsx` (atmos only uses a subset
of the uniforms already passed; scene geometry is baked in as constants from `layout.ts` and `build_scene.py`).

## 1. Fog, smoke, light shafts as real 3D volumes (`atmos.ts`), done

Feedback: "the smoke looks fake and unreal when the view rotates, doesn't match the lighting or the pumpkin".

Causes in the old version:
- Fog was 2D noise drawn on the view direction's longitude/latitude, like a skybox stuck to the eye, so tilting or orbiting
  the pumpkin had no parallax: it looked like a flat sheet stuck on the screen.
- Light shafts were a screen-space radial blur of the mask, dragged from the flame in every direction, so the streaks shot back up all the way to
  the door behind, regardless of where the fog was.
- Candle light in the fog was a screen-space halo `exp(-dist/120)`, so the floor around the pumpkin was fake "warm".

The new version shares the scene's view camera (`viewRay`, `eye`, the pumpkin jump offset `jW`) with the background and pumpkin:
- **Ground fog**: density `σ = 0.95·n·exp(−h/0.24 m) + haze`, where h is the height above the porch deck (z = 0), the front step (−0.2)
  or the yard (−0.43). The exp part is **integrated analytically** along the ray, so no grain and very cheap. The ray crosses 2 segments: the near
  segment (step and deck, under the roof so the moon doesn't hit it directly) and the far segment (yard behind the railing, moonlit). Wind noise is
  sampled at the quartile points of the fog mass along the ray, in world coordinates, so fog patches stay put in the scene when rotating or
  tilting the phone, and near and far fog slide differently with correct parallax. The ray ends at the scene surface (deck, yard, back wall) or at the pumpkin
  (real shape from the rind alpha, depth from the ellipsoid), so the pumpkin occludes the fog in the right places.
- **Lighting in the fog**: night sky and moon (Blender's `MOON_DIR` direction, blocked by the roof), porch light (point, 1/d²), lightning (bolt
  direction, the pumpkin casts a shadow into the fog), the smiley-face light pool on the deck bouncing up into the low fog layer. Scattering phase
  Henyey–Greenstein (Schlick approximation): fog is brighter when looking toward the light source.
- **Candle light shafts** (god rays): 6-sample ray-march over the part of the ray inside a 0.5 m sphere around the flame, only in the half
  space in front of the pumpkin. Each sample checks whether the sample→flame segment can get out through a carved hole: it hits the outer rind inside a hole AND crosses
  the rind thickness (1.7 cm) still inside the hole, so the thick rind blocks oblique rays. The flame is sampled as a real body of about 2×3.5 cm, so the
  shaft edges are soft. The result is shafts with the exact carved-hole shapes, the right direction, sitting properly in the fog with correct parallax.
- **Candle smoke**: a 3D smoke wisp rising from the lid gap around the stem (hot air escaping upward), straight at first (laminar) then increasingly
  twisting, leaning with the wind (+x, same direction as the fog drift). The smoke centreline is in world coordinates (a curved sheet facing the eye),
  occluded by the pumpkin and scene by depth, lit warm from below by the lid gap, and directionally by the moon and lightning.
- The porch-light halo and candle glow are now computed from the angle between the view ray and the 3D light source, no longer from screen coordinates.

Performance (measured with CanvasKit WebGL on an M5 Pro GPU, 1320×2868, 40 frames drawn back to back then one GPU sync):

| | atmos | full frame (background + pumpkin + rain + atmos) |
|---|---|---|
| before | 1.94 ms | 3.2–3.38 ms |
| after | 1.77 ms | 3.17 ms |

The new version is slightly faster than the old one: it drops the radial blur's 28 mask reads per pixel and the 4-octave fbm × 2. How it got
here: the first ray-march version cost 2.6 ms and was still grainy, hence the switch to analytic integration and a bounded region for the shafts.

## 2. Candle light on the scene (`candleLight.ts`), done

- Before: 5 fixed source points (2 on the lid, 2 on the back wall, the flame), weights summing above 1, so the deck showed 2
  hard copies of the smiley face.
- After: a physically correct light source. The flame (bright point, gives the rays bouncing up through the eyes), a hot spot on the lid right above the flame
  (the flame radiates most strongly upward, keeps the smiley shape crisp on the deck), and 16 points on the inner lid and back wall lit by the flame (area
  source, 1/d² weights to the flame, normalised). The penumbra on the deck is now soft like a real candle, brightness kept level with the old version.
- Only recomputed when the carve mask changes (offscreen), so no FPS impact.

## 3. Rain (`rain.ts`), done

- Fixed the porch light position: it was wrongly at (0, 1.3, 1.9), now (−0.08, 1.42, 1.32) exactly as in `build_scene.py`.
- Raindrops scatter strongly forward: looking back toward the moon, a lightning bolt, the porch light or the flame, the rain streaks sparkle
  brighter (backlit); looking away they're darker. Applies to rain streaks, the roof-edge drip lines and ripples.
- The rain geometry (cylinder layers around the eye, depth occlusion, no rain under the roof) is kept as before, it was already perspective-correct.

## 4. Round 2 (16:15): lightning direction, grain

- Fog, smoke and rain are now lit from the direction of the current lightning strike. Rain reads the `bolt` uniform directly; atmos in demo mode picks
  from `STRIKES` and `time` (same clock as `storm.ts`), in interactive mode it uses an average direction from the left side of the sky.
- Atmos now draws at 1/3 density (`ATMOS_DOWN`, PERF's patch) so grain amplitude is reduced from 0.035 to 0.02. The light-shaft dither is already
  computed on `floor(xy·3)` cells so it doesn't get bigger.
- FPS on the ATMOS sim (`EXPO_PUBLIC_PERF=1`, debug build, heavily loaded host): the after-lighting-and-tilt segment `ui` 43–60 fps, mostly ~52–60.

## 5. More realistic lightning (`fx/storm.ts`, `rain.ts`), 16:20 (feedback "fake thunder and lightning")

- Before: a 16-point zigzag with uniform random points, uniform stroke, no branches, looked hand-drawn.
- After: a 33-point main channel built with midpoint displacement: big segments break hard, small ones jitter, the real fractal look of lightning.
  3 side branches split off in the upper half, pointing down and outward, thin and fading toward their tips. Thin white core, blue-violet halo
  in the rain and clouds; branches thinner and dimmer. Still only drawn over the sky (depth > 60 m), so the roof, trees and houses occlude correctly.
- `bolt` format: `[az, el, w]` × `BOLT_N` (= 62); the first 2 elements are a bounding box so the shader skips far pixels. `PumpkinScene` doesn't
  need any change (still `bolt.value.flat()` and `boltPoints(...)`).
- `STRIKES`, `flashCurve`, `currentStrike` unchanged, so `synth_audio.py` is not affected.


## 6. Feedback 16:30 items 1 + 2 (fog layer bug, fake water), 16:50. MAIN AGENT NEEDS TO MERGE THE PATCH

**Merge (JS only, no native build):**

```bash
python3 notes/atmos/patch_scene.py app/src/scene/PumpkinScene.tsx      # patches by anchor string, errors out if an anchor is missing
cd app && npx tsc --noEmit && npx eslint src/scene/PumpkinScene.tsx
```

The patch changes 4 places in `PumpkinScene.tsx` (tested on a copy + the ATMOS sim, tsc/eslint clean):
1. `import { atmos }` → `import { atmosDepth }`
2. in `aU`: `...viewU.value` → `...depthU.value` (adds dK, dpSize, dRange, pFwd, pRight, pRange)
3. `<Shader source={atmosDepth} …>`: add 2 children `<ImageShader image={depthB} tx="clamp" ty="clamp" />`,
   `<ImageShader image={depthP} … />` after `skinLit`
4. rain: `<Fill blendMode="plus">` → `<Fill>` (srcOver). `rain.ts` returns alpha = 0 everywhere except the wet floor, so outside the wet floor the result is
   identical to plus; alpha > 0 on the wet floor darkens the wet wood.

Unmerged, it still runs (the files are already in the project): the old `atmos` is still exported with the old interface (lighting fixed), rain with plus has
reflections, ripples and drips but the wood doesn't darken yet. The "fog band pasted over the post" bug only goes away fully after merging (needs real depth).

**Item 1, fog** (`atmos.ts`, new export `atmosDepth`):
- Cause: the old fog didn't know the real depth, so view rays toward the yard went straight through the railing; the hard edge is where the ray switches from "hits
  the deck floor" to "goes out to the yard"; the fog out in the yard was also moonlit with ~4.7× forward scattering, so it became a blown-out blue band.
- Now: the ray end point comes from `bg_depth` / `bg_depth_pano` (`reproject`, real distance from the eye). Density is the analytic integral of
  `exp(−h/H)` along the ray: under the roof H = 0.24 m from the deck surface; out in the yard the layer is thicker (H ≈ 0.4 m × noise, from the yard surface at −0.43).
  The background haze also falls off with height (1.5 m), so the sky isn't hazed over. The near post has almost no fog, the far yard has thick fog,
  the neighbouring house windows dim behind the fog layer. The top of the fog layer undulates with noise anchored in world coordinates, no more edges.
- Lighting: fog is no brighter than the moonlit ground (sky + moon ≈ 0.2–0.38, mild forward scattering); warms up around the porch light
  (1/d²) and around the pumpkin once lit; moderately bright during lightning.

**Item 2, water** (`rain.ts`, everything is a function of time in the shader, no CPU particles):
- Removed: the glowing blue halo (old fog + rain ripples lit like light sources); drip lines with a constant base brightness of 0.2 (the
  "static dashes" at the floor edge).
- Wet floor: ray intersection with the floor plane (z = 0, beyond the deck the yard at −0.43), checked against the depth image so it doesn't paint over the post, railing, pumpkin.
  The wet area hugs the outer edge following the roof coverage (back railing ~0.5 m, left edge ~0.3 m, front edge ~0.22 m); uneven puddles, stretched
  along the board grain; the yard outside is fully wet. Wet wood darkens (alpha 0.38, needs patch 4).
- Fresnel reflections (Schlick, water F0 0.02, stronger at grazing angles): sky, moon disc (direction from the panorama), porch light, our own house's
  windows, the door glass, the two neighbouring houses' windows (3D positions found from `bg_dark_pano.jpg` + `bg_depth_pano.png`), the pumpkin image once lit, lightning flashes.
  Reflections stretch vertically like a real wet surface, are blocked by the roof when the point is under it, and roughness drops where water pools into puddles.
- Rain ripples: a 0.16 m cell grid in world coordinates, one drop per cell with a 0.8–1.7 s period. Rings spread then fade (~0.5 s), about
  20–30 rings at once in the wet strip. Ripple normals distort the reflections; splash particles live 0.12 s.
- Water drips from the railing's top rail (z 0.84) and the left roof edge (z 2.8): each drop hangs, grows, falls freely (g = 9.8), motion-blurred by
  velocity. Drops from the railing hitting the deck spawn ripples at the right spot, at the right time.
- Note: the pale blue bright strip at the deck edge outside the railing and the yellow specks on the wet edge are baked into the Blender background images (`bg_*.jpg`). If
  Hoa still finds them too bright, the gloss or brightness of the wet-edge material has to be reduced in the Blender pass (main agent's job).

**Performance** (CanvasKit WebGL, M5 Pro GPU, 1320×2868, 40 frames back to back):

| | before | after |
|---|---|---|
| rain + water (full-res) | 0.87 ms | 0.97 ms |
| atmos (computed at full-res; in the app drawn at 1/3 density so ÷9) | 1.22 ms | 1.70 ms (~0.19 ms in the app) |

The full frame in the app goes up by about 0.15 ms on the M5 Pro. Not yet measured on a real 17 Pro Max: needs the main agent or PERF to measure the
Release build after merging.

**Before/after images** (`notes/atmos/`): `sim_yaw-0.66_before-after.jpg` (sim, during lightning), `sim_yaw+0.62_before-after.jpg`,
`render_yaw-0.66_before-after.jpg`, `render_yaw+0.62_before-after.jpg` (WebGL renderer, same camera, no lightning),
`railing-base_before-after.jpg` (close-up of the railing base).

## Handing `candleLight.ts` over to LIGHT (17:20)

From 17:20, `app/src/shaders/candleLight.ts` is owned by the LIGHT agent; ATMOS no longer edits this file. No changes in progress. The current version
in the project is ATMOS's final one (item 2 above): the flame (point) + hot spot on the lid right above the flame + 16 points on the inner lid and
back wall (area source, 1/d² weights to the flame, normalised), output R = L/6 as before.

## Notes for the 120 fps recording (FEEDBACK-1720 item 2)

All ATMOS motion (fog drift, smoke twist, rainfall, ripples, drips, the `flashCurve`/`currentStrike` lightning timing, choosing the lightning direction
from `STRIKES` in atmos) is purely a function of the `time` uniform / the `t` parameter taken from the scene clock (`time.value`). As long as the demo clock
is already multiplied by `EXPO_PUBLIC_TIMESCALE`, ATMOS slows down correctly, nothing else to change. `STRIKES[].t` is in demo-clock seconds.

## Proposals for FX / the main agent (files not owned by ATMOS)

**A. The match smoke (`fx/Match.tsx`) is most likely the "fake smoke when the view rotates" the project owner mentioned.** The smoke puffs are currently
screen-space sprites (`S.x`, `S.y` = where the match went out on screen) and live about 3.5 s. The camera starts tilting 1.2 s after
lighting, so the smoke stays still on screen while the pumpkin slides away. Fix: anchor it in the world.

```ts
// when the flame goes out: world point right in front of the pumpkin under the match head (1.5 cm back toward the eye)
const bb = basis?.value ?? BASE_BASIS;
const sx = (X - VIEW.w / 2) / bb.f, sy = -(Y - VIEW.h / 2) / bb.f;
const d = [0, 1, 2].map((i) => bb.x[i] * sx + bb.y[i] * sy - bb.z[i]);
const p = pumpkinHit(bb.e, d), L = Math.hypot(d[0], d[1], d[2]);
smoke.set({ t, w: [0, 1, 2].map((i) => p[i] - (d[i] / L) * 0.015) });
// every frame: smoke puffs rise in metres then project through the view camera (M ≈ D0 / F0 ≈ 0.0014 m/pt to keep the old pace)
const wz = S.w[2] + (4 + 16 * a + 6 * a * a) * M;
const wx = S.w[0] + (Math.sin(te * 6 + a * 2.4 + ph) * (0.6 + 4.5 * a) + a * a * 2.5 * drift) * M;
proj(basis?.value ?? BASE_BASIS, wx, S.w[1], wz, o);   // o[0], o[1] = screen; sprite size times o[3] / k0
```

If there's no time for the fix, the cheapest option: reduce `SMOKE_LIFE` to about 0.9 s so the smoke clears before the camera tilts. The 3D candle smoke wisp
in atmos covers the rest of the smoke.

**B. `fx/pfx_atlas.ts`: `CX0 = 201, CY0 = 437` is the centre of the old 402×874 frame.** The frame is now 440×956 (`layout.json` view, f = 672),
so `proj`, `pumpkinWorld` and `baseToFloor` are off by about 19 pt horizontally, 41 pt vertically. Should use `VIEW.w / 2`, `VIEW.h / 2`.

## How to view

- Own sim "Pumpkin Atmos 17 Pro Max" (EA6AE9EA-…), Metro port 8094, `EXPO_PUBLIC_DEMO=1`. Most visible in the segment after
  the candle is lit while the camera looks around and tilts: fog in the yard, the smoke wisp above the stem, the smiley face on the deck.
- Comparison images and the WebGL renderer live in the ATMOS session's scratchpad (renders the whole scene from any angle with the real shaders, with ms timings).

## Notes for the main agent

- Geometry constants in `atmos.ts` follow `build_scene.py`: deck x −2.62…5.35, y −0.62…1.55; back wall y = 1.55 from
  x > −0.30; yard z = −0.43; porch light (−0.08, 1.42, 1.32); `MOON_DIR`. If the Blender layout changes, update these constants
  (or move them into `layout.json`).
- No native build needed. No files changed outside those ATMOS owns.

## 7. Fog at the new rest frame (REST oy −0.08, low eye ~0.28 m)

- Bug: at the new rest frame the eye is close to the floor, so the view ray passes through the under-roof fog layer right from the lens, creating a grey veil over the lower half of the screen (most visible once the pumpkin is lit).
- Fixed in `atmos.ts`:
  - `tA` 0.06 → 0.45: skip the first 45 cm of fog in front of the lens (real fog doesn't cling to the lens).
  - `SIG` under the roof 0.95 → 0.6: the roof shelters from rain and wind, so there's less fog under the porch than out in the yard.
  - Candle shaft factor 0.12 → 0.18: compensates for the lower density so the shafts through the eyes and mouth stay clearly visible.
- Fog in the yard and behind the railing unchanged.
- Performance: no extra samples, same cost.
- Images:
  - `atmos/render_rest-frame_before-after.jpg` (old | new, lit | tilted).
  - `atmos/sim_rest-frame_near-fog.jpg` (sim: not lit | lit).

## 8. Polish before 20:45 (X post at 23:00)

Checked the main agent's current build (18:15):
- Fully merged: `atmosDepth` + depthB/depthP, rain `<Fill>` srcOver, fog canvas at 1/3 density, `fOff` (flameFollow) in atmos.ts.
- No more hard edge on the fog layer.
- No more blue halo on the floor.

Remaining bugs found:
1. **The yard looks like a lake surface (yaw −0.66, especially during lightning).**
   - Cause: near-horizontal rays travel a very long way through the ground fog, so the yard fog is nearly opaque and flat.
   - Each pixel takes 1 noise sample at a point that jumps far along a screen row, giving horizontal streaks like water ripples.
   - Layer isolation confirmed: the background is clean, only the fog layer creates this lake surface.
2. **Reflections of our house's window / door glass at the base of the back railing are round orange blobs**, looking like they glow.
3. **Rain ripples and drips from the roof / railing are nearly invisible**: ripples get squashed to ~3 pt at grazing angles; drips ~1 pt.
4. **At the rest frame, the floor near the lens is completely dry**, with no "dark and glossy" look.

Fixed in atmos.ts:
- Yard fog averages noise at 2 quartile points (no more horizontal streaks).
- Added large ~3 m blobs drifting slowly, so the dark yard and the base of the neighbours' houses show between fog bands.
- Soft saturation of thickness: `tau2 = 1.3·(1 − e^(−tau2/1.3))`, yard fog covers at most ~73 %.
- Yard fog light ×0.8, so the fog is no brighter than the moonlit yard surface.

Fixed in rain.ts:
- **Blotchy damp wood under the roof** (`damp` max 0.26, sparse noise ~1 × 2.5 m):
  - Floor darkens by up to ~10 %.
  - Blurry Fresnel reflections (roughness 0.08) of the porch light, the lit pumpkin and the moon (blocked by the roof).
  - No standing puddles, so no ripples.
- **Rain ripples:**
  - Share of cells with a drop 0.45 → 0.75 on the deck, 0.6 → 0.8 in the yard; each ring lives 0.65 s (was 0.5 s).
  - Rings catch light ×1.8; splash particles ×1.8, visible even when the ring is squashed.
- **Drips from the left roof edge and the railing's top rail:** radius 1.7 → 2.4 mm, minimum 0.55 pt, brightness ×1.5 (drops glint like lenses).
- **Reflections:**
  - Our house's window and door glass reduced ~37 % (no more glowing orange blobs).
  - Porch light ×1.4 (still gives a faint warm streak on damp wood).
- **Performance:**
  - On wood that's only damp (no puddles), skip `ripples()` and the 4 neighbouring-house window reflections.
  - Measured on WebGL, 1320×2868, loaded machine: rain pass 3.6 ms after vs 3.9 ms before (average of 4 runs, ±0.5 ms error), so not slower.
  - Fog adds 2 noise lookups at 1/3 density: negligible.

Images:
- `atmos/sim_polish-2045_before-after.jpg`: sim, top row before / bottom row after. Column order: yaw +0.62 · yaw −0.66 during the lightning flash · −0.66 right after the strike · lit rest frame (phone tilting).
- `atmos/render_yard-yaw-0.66_before-after.jpg`: yard behind the railing: before | after, normal | during lightning.
- `atmos/render_floor-rest-frame_before-after.jpg`: floor at the rest frame: not lit before | after, lit before | after.

Tooling notes:
- My `dump.cjs` now includes the new LIGHT / FX uniforms (`candleFloorUniforms`, `fOff`, `fStretch`, `fGust`, `fTip`, `gust`, `ember`).
- candleLight's `mask` child has been added, so the offline render matches the current build.

## 9. Intro wind leaves (`app/src/fx/Gust.tsx`, owned by ATMOS since 18:45)

Bug: `render/preview/review-1828.png`, the 2.6 s frame (rest frame) has a dim, dark, out-of-focus foreground leaf lying across the pumpkin's face like a smudge.
- The gust starts at 1.6 s.
- Foreground leaves live until ~3.5 s, midground leaves until ~4.2 s, so they're still in frame after the camera has stopped (2.3 s).
- Foreground leaves are placed in world coordinates, so they can fly across the middle of the frame.

Fix:
- **Foreground leaves:**
  - Start within 0.01–0.175 s, each leaf only ~0.5 s in frame, so the last leaf leaves the frame at u = 0.68 (2.28 s), before the camera stops.
  - Placed in camera space, depth 0.32–0.62 m.
  - X sweeps across from −1.3 to +1.3 half-widths (fully entering and exiting at both edges).
  - Y within the top-edge band (even leaves) / bottom-edge band (odd leaves), 72–94 % of the half-height. I.e. only within 6–28 % of the frame edge, even while the camera is craning.
  - Smaller leaves (5.5–9 cm, was 8.5–13.5 cm), faster spin / flip.
  - Body opacity 0.9 → 0.55, motion-blur ghost 0.4 → 0.22.
- **Midground leaves:** start ≤ 0.12 s, live 0.55 s, fly at 3.6–5.8 m/s (was 1.7–3), gone before u = 0.67.
- **Floor leaves:** the gust arrives earlier (0.04–0.22 s), slide e^(−7τ), bounce 0.22–0.34 s, settle ~0.6 s after the gust.
- Lint and tsc clean.

Checked on my sim:
- Couldn't record video (another agent was recording a sim, and recording is exclusive to the whole machine).
- Instead built the sandbox with TIMESCALE 0.15 and took burst screenshots.
- Image `atmos/gust_before-after.jpg`: before (2.6 s, review-1828) | after: last 4 frames of the gust (leaves at the top-left edge, bottom edge) | clean rest frame.
