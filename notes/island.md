# ISLAND — Dynamic Island "goo" (2026-10-31)

Files: `app/src/fx/IslandPill.tsx` (rewritten draw), `app/src/shaders/islandGoo.ts` (new). `jump.ts` untouched, `ISLAND_TIMING`
unchanged — only the drawing changed.

## What it does (tau = seconds since `islandT`)

| tau | phase |
|---|---|
| 0.24 → 0.58 (arrive) | black island swells slightly and **reaches down a liquid drop** (smooth-min metaball, wobbling); in the last 0.09 s the drop snaps up around the incoming pumpkin (pill canvas is on top, so the pumpkin "disappears into" the goo) |
| 0.58 → 2.18 | **gulp**: blob is absorbed, pill springs open to `ISLAND_OPEN` with separate w/h springs + volume-preserving jelly wobble; then breathes. Orange rim inside the edge + outer halo **breathe** (~0.54 Hz) |
| | Live Activity: mini pumpkin fades in from the black at center (swallowed) → springs to left slot; carved eyes/mouth glow with multi-frequency candle flicker, **blinks** at ta 0.78 / 1.32 / 1.46; **BOO!** pops in (spring 0→1 with overshoot + hop) and pulses |
| 2.18 → 2.56 shake | pill **swells** (+7 % w, +10 % h), light tremble, rim brightens; content fades |
| 2.56 → 2.69 squeeze | contracts to base size, a bulge forms at the bottom |
| 2.69 → 3.39 spit | **SPIT**: a goo strand from the pill bottom sticks to the top of the falling (real) pumpkin, thins, **snaps at +0.22 s**; upper remnant springs back into the island, lower part becomes a teardrop that falls with the pumpkin, its tail retracts, it shrinks away. Pill recoils (h +20 % bump) and settles **exactly** to `ISLAND` by +0.68 s; glow 0 by +0.38 s. Pure black pill, no text/blur left |

## Implementation

- `islandGoo.ts`: one SkSL runtime effect = stadium SDF smin'd with blob A, capsule C1 (strand), capsule C2 + blob B (detached
  drop). AA = fixed 0.7 pt edge (runtime effects have no `fwidth`). Rim/halo/core computed from the SDF distance, so no
  BlurMask on the pill any more (the old stroke+blur layers are gone). Drawn on one `Rect` (≈274×253 pt) only while active.
- Per frame: one derived `Frame` + small uniform arrays; no Path building per frame any more (mini face, eyes, mouth, bat are
  static paths moved by transforms). Clip for content is an RRect.
- Falling pumpkin top is recomputed with the same formula as `M_FALL` in `jump.ts` (`JUMP.gravity`, `JUMP.dropV0`,
  `PUMPKIN_ASPECT`, `MINI_BODY`). Without `anchor` it assumes rest anchor `{y: VIEW.h·0.78, w: 240}`.
- Checked: `tsc --noEmit` clean, eslint clean, SkSL compiles in canvaskit (7 uniforms).

## Requested diff for the main agent (PumpkinScene.tsx) — optional but recommended

So the goo strand sticks exactly to the falling pumpkin's top:

```diff
-          {ready && <IslandPill islandT={jump.islandT} time={time} skin={skinLit} lit={candle} />}
+          {ready && <IslandPill islandT={jump.islandT} time={time} skin={skinLit} lit={candle} anchor={anchor} />}
```

Nothing needed in `jump.ts`.

## Tuning knobs (IslandPill.tsx)

`SNAP` (strand break time), blink times (`eye = …`), breathing rate `3.4` rad/s, glow colours in `islandGoo.ts`.
