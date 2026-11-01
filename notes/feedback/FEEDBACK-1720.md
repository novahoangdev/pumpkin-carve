# Feedback from Hoa 17:20: shadows and candlelight on the floor must look more real; record at 120 FPS

Image: `shadow-fake.png` (same folder).

## 1. Shadows and candlelight on the floor (assigned to LIGHT; LIGHT also takes over `app/src/shaders/candleLight.ts` from ATMOS)

What's wrong:
- The smiley-face light on the floor is **stacked into 3–4 overlapping horizontal bands**, like several offset copies. The cause is almost certainly the 16 point sources arranged in 3 fixed rings plus the `hot` point and `flameW` in `candleLight.ts`: each ring of sources produces a copy of the mouth shape.
- The light band has horizontal streaks like aliasing or a low-resolution `lightMap`.
- The pumpkin shadow is a dark elliptical blob, hard-edged, uniformly dense. No contact shadow at the pumpkin's foot.

Target:
- **The smiley-face light on the floor is a single shape** with correct perspective: stretched away from the pumpkin, with eyes, nose and mouth all present.
  - Sharp edges near the pumpkin, softer further away (penumbra grows with distance, as with an area light).
  - Brightness falls off as 1/d².
- Soften by **sampling many continuous random sources** (about 48–96 samples via blue noise or Fibonacci over the lid and inner wall, rotating samples per pixel), not fixed rings.
  - The map is only computed once per mask change, so extra samples are affordable.
  - Add a light blur by penumbra if needed. Raise `lk` if the map is coarse.
- The light **picks up the wood grain**: multiplied by the wood albedo, gaps between boards darker, and the wet floor gets a warm glossy streak (specular) depending on view angle. Don't just add a flat orange layer.
- **Flicker with the flame** without recomputing the map: very slight shift and scale, plus brightness varying with noise (in sync with the flame).
- **Pumpkin shadow:**
  - A very dark, narrow contact shadow right at the pumpkin's foot (AO).
  - Shadows cast from the porch lamp and the moon soften with distance, no more hard elliptical edge.
  - After lighting, a warm glow around the pumpkin's foot cast from inside through the carved holes.
  - If the Blender pass (`shadow_lit` / `shadow_dark`) needs fixing, write a proposal for the main agent, or do the shadows in a shader.
- Check at the new rest frame, while tilting the device, and during lightning. Keep 120 fps.

## 2. Record at 120 FPS (assigned to the main agent + PERF)

Machine reality:
- The Mac display is at **60 Hz** (4K, 60.00Hz), and `tools/simrec.sh` records in real time. So the simulator can't produce 120 distinct frames per second when recorded directly.
- The app already has `CADisableMinimumFrameDurationOnPhone` enabled.

How to get real, perfectly smooth 120 fps: **record slowed down, then compress time.**
- Add `EXPO_PUBLIC_TIMESCALE` (e.g. 0.5 or 0.25). **All** motion must come from a demo clock scaled by this factor, including:
  - demo script, camera, carve strokes, rain, lightning, particles, bats, flame, bouncing,
  - every `withSpring` / `withTiming` used in the demo (switch to functions of the demo clock, or scale durations and spring configs by the factor).
- Record the simulator at 60 fps real time with timescale 0.5: gives 120 frames per demo second.
  - `ffmpeg -i raw.mov -vf "setpts=0.5*PTS" -r 120 …`, then CFR 120.
  - Timescale 0.25 gives spare frames, then take 120.
- Audio is built separately by `synth_audio.py` from the timings, unaffected.
- Since every frame gets twice the time to render, this also **removes the simulator's hitches**.
- Verify with `mpdecimate`: the final 120 fps version must have 120 distinct frames per second in every segment.

Output files:
- Master: `render/promo/pumpkin-carve-demo-120.mp4` (120 fps).
- X version: X plays at most 60 fps, so also export a 60 fps version by taking every other frame from the master (no blending). Every 60 fps frame is a real frame, so it's still very smooth.
