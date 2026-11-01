# Feedback from Hoa 23:00, after watching clip v5s: fix, then re-record the final version

Images are in this folder.

1. **The moon is warped** (`moon-warp.png`), assigned to ATMOS
   - When the camera looks up or around, the moon becomes a tilted ellipse, because it gets stretched when reprojecting from the background image and the panorama.
   - Fix: the moon must always be round. Draw the moon as its own sprite, at infinity, along a world direction, with correct perspective projection.
   - Remove the moon from the background image and panorama, or cover the original moon with sky colour. Keep the halo and the clouds passing over the moon.

2. **Pumpkin debris stuck on the pumpkin face** (`debris-on-face.png`), assigned to CAT (owns `Particles.tsx` / `pfx_atlas.ts`)
   - Lumps that look like brown pebbles float in front of or stick to the pumpkin face, and seeds stick around the eyes, nose, mouth.
   - Fix: debris must fall off the pumpkin face immediately (gravity) and lie on the floor, not float in front of the pumpkin.
   - Debris must be small, moist orange-yellow pumpkin flesh, not big brown stones. Fewer of them.

3. **Extra text on screen** (`extra-title.png`, `extra-buttons.png`), assigned to the main agent
   - Remove the PUMPKIN CARVE title with the subtitle "carve · tap · look around · light the match", and the Undo / Reset / Classic / Spooky / Cat button row.
   - Remove them in the recording and in demo mode. Add an `EXPO_PUBLIC_CLEAN=1` flag, or hide them entirely.

4. **Light glitch under the debris** (`light-under-debris.png`), assigned to LIGHT
   - Between the orange smiley-face light patches on the floor there are offset pale grey-white smiley shapes. Possibly leftover lightning-through-the-holes streaks, or an old light layer that wasn't turned off.
   - Fix: remove this white ghost entirely. The floor outside the orange light must be plain wood.
   - Check during lightning and outside of it.

5. **Bats flying out of the pumpkin look bad** (`bats-fire-burst.png`), assigned to CAT (owns `Bats.tsx`)
   - There's currently a burst of fire or smoke out of the pumpkin's mouth, with edges ragged like paper. Looks bad, must go entirely.
   - Hoa thinks it makes more sense for the bats to fly in **from outside**.
   - How: the swarm flies in from the dark yard or the distant sky, swoops across the porch (with some grazing the lens), then flies up into the sky to spell HAPPY HALLOWEEN as in the approved version.
   - Nothing comes out of the pumpkin at all.

## Order
- Each tab reports to the main agent when its fix is done.
- The main agent merges, builds Release, records with rec120, then edits the still-phone promo (`v5s.json`) at 60 fps.
- Only clean up the temp folders once editing is done.
