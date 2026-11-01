# MOON — round moon (FEEDBACK-2300 item 1), 31/10

**No changes needed in PumpkinScene.tsx**: no new uniforms, no new draw layers. Metro hot-reloads.

## Cause
The moon sits on a flat sky backdrop (sky.jpg) → it is round in the source image, but in world directions it is an ellipse; re-rendered from
a different view angle (looking up, looking around, intro) the ellipse shows and tilts.

## Fix
- New file `app/src/shaders/moon.ts` → `MOON_SKSL` with `moonSprite(xy, w)`: projects the moon direction (world, derived from the moon centre measured
  on bg_dark.jpg (63.33, 106.67) pt, R = 44 pt, through CAM) through the view basis `vX/vY/vZ/vf` (rotation only; at infinity so eye offset has no
  effect) → sprite centre on screen; radius `tanR·vf/z` (matches the source image at rest); rotated to the world "up" direction at the moon.
- The sprite is **round on screen**, texture = moon disc + halo + nearby clouds read from the source image (where the moon is round), radius 1.45 R, edge
  blend 1.2–1.45 R → fully covers the distorted original moon (no erase pass needed). Only replaces pixels whose depth is sky (`w` 60→140 m), so roof,
  pillars, trees still occlude the moon correctly.
- `background.ts`: includes `MOON_SKSL`, after the `wb` block mixes `bgDark`/`bgLit` at the sprite coordinates (only reads the layer needed, only inside
  the sprite area: ≤ 2 extra texture reads for a few thousand pixels). Rain, fog (atmos), lightning still draw on top as before.
- `atmos.ts` unchanged (MOON there is the Blender light direction, not the visible moon disc).
- Checked: SkSL canvaskit OK; sim EA6AE9EA (Debug, Metro 8094) captured intro + look left + rest: round moon, no elliptical rim left
  (`notes/feedback/moon-fixed.png`: left = same angle as moon-warp.png).

## Optional (needs PumpkinScene): clouds drifting across the moon
Currently the clouds around the moon stay fixed to the moon (correct perspective). For drifting clouds: add `uniform float mT;` to moon.ts, add
`mT: time.value` to `bgU`, then offset the cloud texture coordinates (`o.x += mT * 1.5` outside the disc). Not done because it touches PumpkinScene.
