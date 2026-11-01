# BATS — FEEDBACK-2300 items 2 and 5 (23:xx)

Only edited `app/src/fx/Bats.tsx` and `app/src/fx/Particles.tsx`. Nothing to change in PumpkinScene.tsx or demo/script.ts (props, `batLook`, `BAT_SKY`, timings unchanged).
tsc and eslint clean.

## (5) Bats fly in from outside, no more "fire burst"
- The "fire or smoke" blob in `bats-fire-burst.png` was really 720 bats coming out of the pumpkin's mouth. They overlapped right next to the candle, and the additive layer (pass B, candlelight) made the whole swarm look like a flame with ragged edges.
- New phase 1: each bat flies a quadratic Bézier curve in from outside the porch, then the old spring (unchanged) brings it to its spot in the text.
  - Start points: about 75% fly out of the dark yard behind the railing (x −4.6…−0.6, y 3.6…6.4, z 0.7…2.2 m; most enter from the left edge of the frame), about 25% from the distant sky (y 8…14, z 3.4…5.8).
  - The swarm swoops across the porch toward the lens, always above the top of the pumpkin (z ≥ 0.45 m), loops up, then turns into the text.
  - About 25 bats (`skim`) graze 0.2–0.26 m from the lens, 7–13 cm off to the side.
  - Checked numerically: apart from the `skim` group, no bat gets closer than 0.44 m to the eye.
- Every bat is in the text by 2.0 s at the latest (delay 0–0.55 s + flight 1.0–1.45 s). So the text still forms by 3.0, holds until 4.2, then breaks up like the approved version. Forming, holding and breaking up are unchanged.
- No bat starts from the pumpkin any more. The `MOUTH` constant is deleted. Bats fade in over the first 0.3 s while still far away, instead of "growing" at the pumpkin's mouth.
- Performance: only a few extra arithmetic ops per bat, no allocations. The new array `__fxB1` (camera at bat release) is allocated once on the UI runtime.
- Audio: `BAT_TIMES.emergeEnd` (1.25) should now be read as "the swarm is swooping across the porch". Bats graze the lens at about 0.9–1.6 s after `bats`. If `synth_audio.py` has a "burst out of the pumpkin" sound at 24.9, change it to wing flaps growing louder from afar, with a whoosh at about 25.9–26.4.

## (2) Pumpkin debris
- Removed the debris stuck on the pumpkin face entirely (`stuck`, previously 22% of flesh bits stayed under the hole edges — those were the "brown pebbles" on the nose and mouth).
- Removed seeds and pulp fibres (the bits stuck around the eyes). Now only flesh bits and juice drops remain.
- `PER_BURST` lowered from 18 to 9. Flesh bits are smaller: 3.5–10 mm (previously up to 26 mm).
- Debris spawns 1 cm off the rind, shoots toward the camera at least 0.24 m/s to clear the bulging belly below, with almost no upward kick. So the debris drops straight to the floor and stays in front of the pumpkin.
- Colour: bright orange-yellow pumpkin flesh (multiplier about 1.15 / 0.86 / 0.42, raised floor brightness) instead of the neutral grey that used to turn the sprites brown. Wet glints unchanged.
- Own sim (8B860304): after carving, the pumpkin face is clean, only small orange dots on the floor in front of the pumpkin.

## Notes for the main agent
- Metro currently reports the SkSL error `symbol 'MOON_D' was already defined` in `shaders/candleLight.ts` (line 226, probably from the moon or LIGHT work in progress).
- On my sim the demo stops at the rest frame after the look-around: no jump, no candle lighting, never reaches the bats. So I haven't captured the bat scene on the sim yet. The flight paths were verified numerically.
- Once that error is fixed, re-check around 24.9–27 s.
