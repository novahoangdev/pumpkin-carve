# Feedback from Hoa at 16:30, 31/10. Fix before recording the final version

Images in the same folder: `fog-layer-bug.png`, `water-fake.png`, `opening-angle.png`.

## 1. Fog layer bug (`fog-layer-bug.png`), assigned to ATMOS

When looking left, the fog is a flat bright band with a hard top edge, as if cut with a ruler. The band covers the feet of the railing posts like a sticker. Near and far posts are covered equally densely, so it looks like a pasted image rather than fog.

Fix:
- Compute fog from **real depth** (`bg_depth` / `bg_depth_pano`). Fog density is the integral of height fog (`exp(-h/H)`) along the view ray, from the eye to the scene point.
  - Near objects (near railing posts, floor edge) have almost no fog.
  - Fog is thick far out in the yard.
- No hard edges anywhere: the fog top height fades out, and the fog's rolling noise is anchored in world coordinates, not screen coordinates.
- Fog must stay fixed in space when yaw/pitch change.
- Fog must not be brighter than the moonlight falling on it. Fog near the porch lamp and near the pumpkin (once lit) is warmer.
- Check at yaw −0.66 and +0.62 (the two look-around marks in the demo) and while tilting.

## 2. Water needs to look more natural (`water-fake.png`), assigned to ATMOS (+ main agent if the Blender pass needs fixing)

The blue glow strip along the foot of the railing is blown out and smeared into a blue smoky streak, looks fake. Rain splashes at the floor edge are short static dashes.

Fix:
- **Remove the glowing blue halo.** A wet floor means the wood is **darker**, more saturated, and has sharp Fresnel reflections.
  - Reflections include the moon, the porch lamp, the neighbour's windows, and the pumpkin glow once lit.
  - The more grazing the view, the stronger the reflection.
- **Raindrop ripples:** small circles that spread out then fade, in world coordinates on the floor plane.
  - About 15–30 rings at once, only in the wet area at the outer edge.
  - The rings distort the reflections via the ripple normal.
- Puddles have irregular shapes (along the board gaps and the outer edge), not laid out as a straight band.
- Add a real detail: **water dripping from the roof edge and the railing's top rail** onto the floor, each drop making a ripple where it lands. Cheap detail that looks very real.
- Small splash particles, short-lived about 0.15 s, no static streaks.
- Keep 120 fps: ripples computed in the shader as a function of time, no CPU particles.

## 3. New, more dynamic opening (`opening-angle.png`), assigned to the main agent (+ FX)

Hoa doesn't like the current camera angle. The pumpkin sits small at the right edge, the bottom half of the frame is empty floor, the roof above is dark, so opening the app feels very flat.

### 3a. New rest frame (main camera angle after the intro)
- Low angle, at pumpkin height.
- Pumpkin about 50–55% of the screen width, **centred horizontally**, slightly below centre (about 58% of the height).
- Porch lamp and moon still in frame at the top.
- Less empty floor in front.
- Two ways to do it, the main agent picks whichever is faster and more correct:
  - (a) Change the default view (yaw/pitch/zoom, add `oy` to lower the eye).
  - (b) Re-place the Blender camera, if the final pass is being re-rendered anyway.
- If (a): check every coordinate currently computed from the base frame (stencil `CENTER`, `matchTarget`, Dynamic Island, particles) so they stay in the right place.

### 3b. Intro script 0.0 → 3.0 s (carving still starts at 3.2 so no later timings need to move)

| t (s) | Visual | Audio / haptic |
|---|---|---|
| 0.0–0.45 | Screen almost black, only glinting rain streaks. Camera is looking up at the moon behind clouds (pitch ≈ +0.7, zoom ≈ 1.4) | Rain, distant rumbling thunder |
| 0.45 | **Opening lightning:** 2-beat flash (bright 70 ms, dark 110 ms, bright 50 ms). The PUMPKIN CARVE title flashes with the lightning then cools to warm orange | Thunderclap, heavy haptic |
| 0.6–2.3 | **Crane down from the moon:** pitch pans from +0.7 to the rest frame, yaw gradually turns toward the pumpkin, zoom 1.4 → 0.85 → 1.25 (push in), eye gradually lowers (`oy`). Strong ease-in-out, fastest in the middle, light motion blur along the pan direction at peak speed | Wind whoosh |
| ≈1.4 | As the camera sweeps past, **the porch lamp flickers twice** | Small electric click |
| ≈1.6 | **A gust sweeps maple leaves** right past the lens (big foreground leaves, out of focus, strong parallax) and a few leaves on the floor slide along. This part goes to FX: new file `app/src/fx/Gust.tsx` | |
| 2.3–2.9 | Camera settles on the rest frame with a slightly overshooting spring then holds. The pumpkin wobbles slightly (light squash) as if pushed by the wind | Light haptic |
| 3.2 | Carving starts as before | |

General requirements:
- The whole intro smooth at 120 Hz on the 17 Pro Max.
- No JS objects created per frame in worklets.
- Cheap motion blur: a few offset samples along the pan direction, only enabled at high speed.
