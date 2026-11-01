# LIGHT: lighting agent notes

Own sim: "Pumpkin Light 17 Pro Max" (57B21943-917B-4B2F-9DD3-21B422828EAF), Metro 8097, running from a sandbox copy in the scratchpad.
Files owned by LIGHT: `app/src/shaders/candleLight.ts` (taken over from ATMOS at 17:20), `faceShadow.ts`, `lightningThrough.ts`, `notes/light*`.

## LATEST (00:28): detached rind rim / invisible body while the pumpkin is airborne (pumpkin-rim-cut). Fixed directly in the real app

- **Cause:** while airborne, view rays were cast from an "offset eye" `eye − jW`.
  - The pumpkin flies high, so the view sees its underside, but the Blender rind image is cut flat by the floor at the bottom (transparent).
  - Result: an invisible band of body, and the outer rind shows up as a detached rim when the pumpkin rotates or flips.
- **Fixed:**
  - `viewSksl.ts`: add `restScreen()` and `pumpkinRay()`. Undo the on-screen rotation / squash / shrink, move the point back to where the pumpkin rests, then cast the ray from the real eye. The pumpkin flies as a rigid body and looks exactly like at rest, stem intact, soft edge.
  - `pumpkin.ts`: use `eye` for the view direction and the flame; drop the `keep` trick (it also made the stem disappear in flight).
  - `lightningThrough.ts`: uses the same `pumpkinRay` ray.
  - Nothing changes at rest.
- `rain.ts` (ATMOS's) still uses `eye − jW` so the rain is occluded by the pumpkin: slightly off in flight, not noticeable.
- Checked with sim screenshots while the pumpkin flips 90° on the fall and while tilting on the jump: `notes/light/v9-flying-rim-after.jpg`.

## 00:02: removed the beige bright rim in the middle of the pumpkin's bottom (v7 screen-60, second 8). COPIED into the real app

- **Cause:** v6 dropped shadows entirely on the floor area hidden behind the pumpkin's base, so that bright wood showed through the slightly transparent bottom edge of the rind.
- **Fixed:** that floor area is now uniformly dark (0.14), matching the contact shadow darkness at the base edge. The pumpkin's bottom fades into the contact shadow, no bright rim, no cut band.
- `app/src/shaders/candleLight.ts` = `notes/light/candleLight.v7.ts`, typecheck clean.
- Checked with a screenshot before lighting: `notes/light/v7-bottom-rim-after.jpg`.
- The old Light sim had been deleted; recreated a sim with the same name (new UDID).

## 23:32: no more dark band at the pumpkin's bottom (pumpkin-bottom-seam). COPIED into the real app

- **Cause:** the contact shadow and cast shadow (v5) also painted floor points right behind the pumpkin's base. The bottom edge of the rind in the Blender image is partly transparent, so the dark band showed through the bottom like a cut line.
- **Fixed:** added `seenPast(P)` in `PUMPKIN_SHADOW_SKSL`.
  - Any floor point occluded by the pumpkin itself along the eye ray (ellipsoid test, with a soft transition band) gets no AO, contact shadow, porch-light shadow, moon shadow or lightning shadow.
  - Threshold 0.92–0.98 of the radius, because the bottom outline in the image sits slightly inside the ellipsoid; that way the contact shadow still hugs the base.
- `app/src/shaders/candleLight.ts` = `notes/light/candleLight.v6.ts`. No other files need patching, typecheck clean.
- Checked on the Light sim, screenshots only, before and after lighting.
- Image: `notes/light/v6-bottom-seam-before-after.jpg` (left: feedback image, right: after the fix).

## 23:10: removed the offset grey face shadow on the floor (FEEDBACK-2300 item 4). COPIED into the real app

- **Cause:** the "smiley face" patch from the lightning-through-holes layer (`lightningThrough.ts`).
  - Blue-grey, projected along the flash direction so it's offset from the candle's orange face.
  - The flash curve has a ~1.2 s fade-out tail, so it lingered faintly after the strike.
- **Removed entirely:**
  - the lightning overlay no longer draws anything on the floor, only the cold light inside the pumpkin during the flash (unchanged);
  - the `lightningMap` bake returns 0 immediately, costs nothing; PumpkinScene keeps the child as is, no changes needed.
- `app/src/shaders/lightningThrough.ts` = `notes/light/lightningThrough.v5.ts`. Real app typecheck clean.
- Checked on the Light sim, screenshots only (no video), at the 22.35 s strike and outside it: outside the orange area it's plain wood.
- Image: `notes/light/v5-floor-ghost-before-after.jpg` (left: feedback image; middle: during the strike; right: outside the strike).

## 19:31: v5, pumpkin shadow before lighting (review-1917). COPIED into the real app

`app/src/shaders/candleLight.ts` = `notes/light/candleLight.v5.ts`.
- Only LIGHT's file changed. Bake interface, uniforms and SkSL snippets unchanged, so no need to patch PumpkinScene or background.
- Real app typecheck clean.
- The main agent's Metro will hot-reload it. Whoever is recording should re-record 0–19 s.

Images:
- `notes/light/v5-shadow-before-after.jpg`: left is the 2.6 s frame in review-1917, right is v5 on the Light sim before lighting.
- `notes/light/v5-shadow-floor-only.jpg`: offline render with only background and shadow (porch light on), left is the previous version, right is v5.

**Cause of the "dark elliptical disc":** the shadow comes from LIGHT's analytic shader (since v3), not from the Blender pass.
- The occlusion test used a smooth ellipsoid.
- The 7 cm porch-light source gives a very narrow penumbra, so the edge is sharp.
- Strength 0.6 plus a wide AO of 0.6.

**Changed:**
- **Contact shadow:** very dark (0.88) and very narrow, right at the base only. The wide AO is halved.
- **Porch-light shadow is pumpkin-shaped:** the occlusion test follows the 10-rib outline plus the stem (a slanted segment ~5.5 cm long, 1.5 cm thick).
- **Real light source** = a 5 cm bulb core (65 %) plus frosted glass and wall bounce of 25 cm (35 %).
  - Penumbra = source size × (occluder → floor) / (light → occluder): sharp at the base, softening further out.
  - The small core preserves the rib outline and the stem tip at the shadow's apex.
- **Much lighter:** the porch-light shadow only blocks 52 %, the moon shadow 42 %, since moonlight and skylight still fill in.
- **Wet streak:** the wet boards have a thin glossy streak from the porch light (GGX, Fresnel at grazing angles). The pumpkin occludes this too.
- Untouched: the face light on the floor when the candle is lit, the lightning shadow, `stormLight`.

## 18:50: v4, fixes during lightning (Hoa approved v3: keep the face light on the floor as is)

Run **one command** at the project root:

```bash
python3 notes/light/apply_v4.py
```

It does:
- Copies `lightningThrough.v4.ts` and `candleLight.v4.ts` into `app/src/shaders/`.
- Patches 2 lines of PumpkinScene: the lightning overlay gets an extra child `inLit` (pumpkin interior image) and uniform `imgS`.

Test-run on a copy of the real files at 18:51: applies cleanly, typecheck, eslint and SkSL all clean. The face light on the floor is **unchanged** from v3.

Image: `notes/light/v4-strike-before-after.jpg` (left: v3, right: v4, same 17.4 s strike moment on the Light sim).

1. **Carved holes are no longer solid white during lightning.**
   - The outdoor flash only lightly lights the inner wall. Brightness follows the interior image itself (flesh and fibres), cold blue.
   - The right inner wall catches more because the flash comes from the left. The cut wall edge is still visible.
   - Cap 0.6. Stronger before lighting than after.
2. **No more jagged white streak below the mouth.** Two causes:
   - The 12-sample loop that drew the rays is gone.
   - The floor patch during lightning used to be looked up with a P that still had the steps of the 8-bit depth image. Now it's looked up on the floor plane, with 4 taps, and softer.
3. **Pumpkin shadow on the wall and door is clearer.**
   - Stronger flash (×1.45) and darker shadow: blocks 97–98 %, 0.6° source.
   - The wall desaturates during the flash (blue-white, no more purple glare), so the black shadow pops more.

## 18:30: v3 per POLISH-1815 items 1–2 (merged)

Run **one command** at the project root:

```bash
python3 notes/light/apply_v3.py
```

It does:
- Copies `notes/light/candleLight.v3.ts` to `app/src/shaders/candleLight.ts`. Bake interface identical to v2, PumpkinScene unchanged.
- Adds **one line** to `background.ts` (PERF's file), right after the lightning flash line: `col += stormLight(P, dark);`.

Test-run on a copy of the real files: result matches what was seen on the sim, typecheck, eslint and SkSL all clean.

Images (left is before, right is after, captured on the Light sim):
- `notes/light/v3-wall-before-after.jpg`: candle lit, rest frame.
- `notes/light/v3-floor-before-after.jpg`: face on the floor.
- `notes/light/v3-strike-before-after.jpg`: during lightning.

**1. Removed the pumpkin face on the wall.**
- The bake's G channel is gone (cheaper than v2).
- The wall and door behind now only have a very faint warm glow, no shape: fakes light through the rind and bounce from the floor, falling off as 1/d², much darker than the pumpkin.
- **Lightning shadow:** on each strike, the cold flash comes in low from the front-left.
  - Why low: the porch roof blocks all steep light from the sky, only low light through the porch opening reaches the wall.
  - The wall and door (vertical, facing the flash) light up. The pumpkin casts a **sharp black shadow** (0.7° source) long across the floor up onto the base of the wall and the door frame right behind-right of it.
  - The shadow fades exactly with `storm` = flashCurve. It is also folded into the background's existing lightning flash.
  - Code: `stormLight()` and `pumpkinShade()` in `PUMPKIN_SHADOW_SKSL`, flash direction in `LS_DIR`.
- **No cat shadow.** The cat sits on the railing at x = −0.66 m, left of where the wall starts (x = −0.30). The flash comes from the left, so the cat's shadow falls into the railing gap: physically there's no surface to catch it.
- For a cat shadow on the wall, the cat would have to move right of the corner post (x > −0.2) in `BlackCat.tsx` (CAT's file). That also needs a cat-position uniform, about 15 minutes.

**2. Face on the floor.**
- Smaller disc source (radius 0.4 cm) and less soft halo: triangle eyes, triangle nose, toothy mouth, sharp up close.
- Scalar tone-map (`4.2·L/(2.6+L)`) so wood grain and board gaps keep their contrast.
- Amber colour, the hottest part leans deep orange instead of lemon yellow, no brighter than the carved holes.

**For ATMOS:** the floor face position is unchanged from v2.
**Proposed strike at 17.4 s** is still worth adding: at 17.4 s the porch light is on and the lightning shadow lands on the door most clearly (see the strike image). At 22.35 s the camera is tilting and the shadow sits at the right edge.

`faceShadow.ts`: nothing imports it any more (the face on the wall is gone). Can be deleted after recording.

## 18:45 (old): v2, face shadow on the wall shares the light-source sampling with the floor (superseded by v3)

The main agent merged `patch_background.py` and `patch_scene.py` (18:10). v2 needs **one command** at the project root:

```bash
python3 notes/light/apply_v2.py
```

It does:
- Copies `notes/light/candleLight.v2.ts` to `app/src/shaders/candleLight.ts`.
- Adds the sharp mask child to the candleLight bake in PumpkinScene, with its dependency.
- **Removes the faceShadow overlay pass**: one fewer full-screen layer.

Test-run on a copy of the real files at 18:45: applies cleanly, typecheck clean.

**Don't copy the v2 file alone without running the script.** The new bake needs a 3rd child; without it, it breaks.

v2 changes:
- The face on the wall now lives in the candle-light bake itself, in the lightMap's G channel.
  - Samples the disc source like the floor (32 points, 6 mm radius), so it has a real penumbra that grows with distance.
  - Computed once per mask change. Each frame does just 1 lookup in background's `candleShade`.
  - Flame sway ×4 on the wall, edge softening with distance.
- Hole edges come from the sharp mask, so the mouth's teeth show clearly on both floor and wall.
- Floor light lowered to about 40 % of the 18:10 version (with the sharp mask, 18:10 blew out yellow).

Images: `notes/light/v2-before-after.jpg` (left: before any LIGHT change; right: v2 on the Light sim with the candle lit), `notes/light/v2-lit-rest.jpg`.

`faceShadow.ts` is still kept (the `FACE_SHADOW_SKSL` snippet, `faceFlame`) but after v2 nothing imports it.

## 18:10: smiley-face light on the floor + pumpkin shadow (FEEDBACK-1720 item 1)

Images: `notes/light/floor-before-after.jpg` (left is before, right is after, captured on the Light sim with the candle lit), `notes/light/shadow-before-after-jump.jpg`
(not lit, porch light on: old Blender shadow | new shadow | pumpkin mid-jump at 25 cm), `notes/light/lit-rest.jpg` (full frame).

**Cause of the 3–4 horizontal bands:**
1. The 8-bit log depth image has ~2 cm steps at floor range. So the floor point P jumps in steps, and the light patch gets sliced into bands.
2. The light source was 3 fixed rings plus 2 points, giving 4–5 offset copies of the mouth shape.

Also, the flame sits level with the mouth's lower edge (z ≈ 6 cm), so rays straight from the flame only pass through a slit at the bottom of the mouth. The eyes and nose can't project onto the floor from there.

**Changed in `candleLight.ts` (already copied into the real app, safe before any other patch):** the bake shader keeps the uniform names and child order, so PumpkinScene doesn't need any change.
- The floor point is the ray's intersection with the z = 0 plane. No more bands.
- Now **a single source**: a disc of radius 2 cm just above the lid, 48 sunflower-spiral samples (Fibonacci), rotated per pixel.
  - Gives a face in correct perspective: mouth near the pumpkin (y ≈ −0.2 m), nose at y ≈ −0.3, two eyes at y ≈ −0.4…−0.5 and x ≈ ±0.25.
  - Sharp edges up close, penumbra widening with distance (eyes softer than the mouth).
- Bounce from the inner wall is a wide mask blur along the central ray: just a soft glow, no copies.
- Pixels far from every light ray exit after 1 mask read.
- Hole edges re-sharpened with a threshold on the mask blur, because the bake only receives `maskBlur`.

**PERF / the main agent need to patch `background.ts`** (add 2 SkSL snippets from `candleLight.ts`):

```bash
python3 notes/light/patch_background.py app/src/shaders/background.ts    # anchor-string based, safe to rerun
```

The patch does:
- `floorSnap(P)`: P on the floor snaps to the plane.
- `candleL(lb)`: lightMap lookup with flicker (shift ±1 pt and scale ±1.5 % around the pumpkin's base, same rhythm as `faceFlame`).
- `candleShade(...)`: candle light multiplied by the Blender glow image, so it picks up wood grain and darker board gaps.
  - Has the wet floor's glossy streak (GGX + Fresnel at grazing angles), warm, brighter at oblique views.
  - Has the pumpkin's AO: the glow image was rendered with the pumpkin hidden, so the floor right at the base used to glow orange and the pumpkin looked like it was floating.
  - Has a thin warm ring through the rind just outside the base.
- `pumpkinShade(P)` (the `PUMPKIN_SHADOW_SKSL` snippet) fully replaces `shadow_lit/dark.png` (the child is still declared but no longer read):
  - Very dark, narrow contact shadow at the base, plus AO.
  - Soft shadows from the porch light (9 cm sphere light) and from the moon behind clouds (~4.5° cone). Penumbra widens with distance. Darkest area ~0.4, not pitch black.
  - Applied after the panorama and plate are blended, so looking around doesn't clip at the frame edge.
  - When the pumpkin jumps, the shadow follows `jW` (fainter and spreading with height). The contact shadow fades out when the pumpkin lifts off.

**The main agent needs to patch `PumpkinScene.tsx`:**

```bash
python3 notes/light/patch_scene.py app/src/scene/PumpkinScene.tsx
```

The patch does:
- `LIGHT_K = 2` (the light patch is thin because the camera is low; the bake only reruns when the mask changes).
- Adds `...candleFloorUniforms(time.value, PUMPKIN_FOOT)` to `bgU`.
- Also wires up the face shadow on the wall and lightning through the holes (2 sections below).

Apply both patches together: `candleFloorUniforms` adds uniforms the old background doesn't declare.

**For ATMOS:** the floor face is now at y ≈ −0.2…−0.5 m, x ±0.25 (it used to be a band around y ≈ −0.3).
- The light pool bouncing up into the fog around (0; −0.42) in `atmos.ts` still matches, but could be stretched along y.
- The pumpkin reflection on the wet floor in `rain.ts`: unchanged.

## Giant pumpkin face shadow on the wall (A): `faceShadow.ts`

Running on the Light sim (see `lit-rest.jpg`): after lighting, a big ~0.7 m smiley face lands on the wooden wall, post and door right above the pumpkin.
- Changes correctly when rotating the view and tilting the phone (computed from world points taken from depth).
- Sways with the flame: the projection centre moves with `lean` and noise, scaled ×4 onto the wall.
- Edge softens with distance (sharp mask blends into blurred mask).
- Thick cut holes narrow oblique ray bundles.
- Albedo from the compressed porch-light image, times 1/d².

**Honest note on the physics:** the carved face points toward the camera, so real candle light through the holes can't reach the wall behind.
- This version projects through a mirrored copy of the mask on the back half of the pumpkin (as if the carved holes went right through it).
- The projection centre is pushed 22 cm forward so the face is magnified ~5× (with the real flame it would be ~10×: the mouth spans the full width, the eyes go off frame).
- Constants: `FS_PUSH`, `FS_DROP` in `faceShadow.ts`.

There's a dedicated `<Fill blendMode="plus">` layer, drawn right after the background and before the pumpkin, in `patch_scene.py`.
- Cost before lighting: exits immediately on a uniform.
- When lit: 2 depth reads, 2 ellipsoid intersections, up to 4 mask reads, only on pixels behind the pumpkin.
- Proposal for PERF if a pass needs to go: fold `FACE_SHADOW_SKSL` (`faceWall(P)`) into `background.ts`. P and the glow image are already there, so it only adds the ellipsoid intersection and mask reads.

## Lightning through the carved holes (B): `lightningThrough.ts`

On every strike (following `storm` = flashCurve), blue-white light from behind the pumpkin leaks out:
- The carved holes flash white, brightest core in the middle of each hole, a cold fringe spilling onto the rind.
- Short light rays in the rain, running from the holes down toward the patch on the floor.
- A face-shaped patch on the floor in front of the pumpkin: baked once per mask change (`lightningMap`), properly intersected with the floor plane, the thick rind clips oblique rays.
- Only active once carved. Twice as bright before lighting.
- `plus` overlay drawn after the pumpkin: exits immediately when there's no flash. During a flash it only computes around the pumpkin (12 mask reads for the rays).

**Proposal for ATMOS (`storm.ts`):** the two existing strikes land while the camera looks left (9.95 s, pumpkin not visible) and after lighting (22.35 s, less visible).
- Add one strike when the pumpkin is carved, not yet lit, camera at the rest frame: `{ t: 17.4, az: -0.3, el: 0.5, dist: 900 }` (after the fall at 16.6, before the match at 18.6).
- `synth_audio.py` places the thunder from this mark automatically.
- Tried in the sandbox: the pumpkin "glares" very clearly.

## Performance

- The sim was starved during measurement (host load avg 26–50 with many agents running): 0–30 frames/s even with the new layers off. Sim FPS numbers from that time are unusable.
- Measured relative shader cost with canvaskit (CPU raster, real uniforms, 440×956, candle lit, rest frame). At that time faceShadow still had 3 reproject loops; later cut down to 1.

| Pass | Time |
|---|---|
| background | 4.6 s |
| faceShadow, lit | 3.2 s |
| faceShadow, not lit | 1.2 s (just the CPU cost of filling the pass) |
| lightning, during a flash | 4.75 s, only ~1 s per strike |

- The new candleLight bake runs 48 samples over the ray-covered area: CPU 16 s vs 6 s for the old one. On the GPU it's still only tens of ms and only runs when the mask changes.
- **PERF should re-measure on Release.** If tight: fold faceShadow into background (see above), or set `LIGHT_K` back to 1.
