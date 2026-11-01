# Polish 18:15: reviewed from `render/preview/rec.png`, `stills.png`, `notes/light/v2-before-after.jpg`

## Locked schedule (post to X at 23:00)
- **21:00** feature freeze. After this point only bug fixes and small tweaks.
- **21:15 at the latest** start recording the final 120 fps version and editing the promo. The promo currently renders only about 37 frames/minute, taking about 55 minutes, so it must not start any later.
- **22:15** have the 60 fps X version, preview stills and caption.
- **22:30** hand over to Hoa.
- The v4b version being edited is the fallback: there must always be a postable clip.

## 1. Giant pumpkin face on the house wall: PHYSICALLY WRONG, remove or replace (LIGHT + main agent)
- The carved holes face the camera, while the wall is **behind** the pumpkin. Candlelight through the carved holes can't land on that wall.
- On top of that the face on the wall is brighter than the pumpkin itself, and is hard-clipped by the wall and door edges, so it looks like a sticker. A careful viewer will see it's fake right away.
- Replace with 2 physically correct things:
  - (a) **A very faint warm glow** on the wall and door behind, from light passing through the rind and bouncing off the floor. Soft, no face shape.
  - (b) **On each lightning strike**, the flash from outside (left) casts a **sharp black shadow** of the pumpkin (and the cat, if it's sitting on the railing) long across the wall and door on the right, then fades with the flash curve. A real shadow, so very "cinematic".
- The giant smiley face should only be on the **floor in front**, where the light actually goes.

## 2. Smiley-face light on the floor (LIGHT): v2 is better, needs more
- The eyes are two round blobs. They must be **triangles** with soft edges, sharp near, soft far.
- The mouth must have teeth.
- The core is a blown-out lemon yellow. Bring it down to amber orange, tone-mapped, and never brighter than the carved holes themselves.
- Wood grain and board gaps must show through in the lit area.

## 3. Bats spelling HAPPY HALLOWEEN are hard to read (CAT takes `Bats.tsx` since the FX tab is closed)
- The text is small, blends into the face on the wall and the dark background.
- Spell the text in the sky and moon area at the top-left, where the bright background makes the black bat silhouettes stand out. Text about 80% of the width, denser bats.
- Bat rims lit by moonlight and orange glow, hold about 1.2 s before breaking up toward the camera.

## 4. Pumpkin debris around the pumpkin's foot (CAT takes `Particles.tsx` / `pfx_atlas.ts`)
- The debris is scattered in an even ring around the pumpkin, looks like confetti.
- Needs fewer bits, concentrated in front (where the carved pieces fall out), varied sizes, some wet stuck bits, and less saturated colour.

## 5. Promo render speed (PERF)
- 37 frames/minute is too slow for the final round. Find a way to get under 20 minutes without losing quality, then write it in notes/perf.md for the main agent:
  - render the mockup once then composite the video with ffmpeg,
  - or run several processes in parallel,
  - or use Eevee,
  - or lower the sample count on frames that don't need it.
