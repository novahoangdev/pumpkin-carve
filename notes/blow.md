# BLOW: blow into the mic to blow out the candle (BLOW agent)

Own sim "Pumpkin Blow 17 Pro Max" (0DCEAC26-…), Metro 8099 running from a sandbox in the scratchpad (app clone + expo-audio,
Debug build into its own DerivedData). **Have not touched** the real project's `package.json`, `app.json`, `ios/`, `PumpkinScene.tsx`, `pumpkin.ts`.

## Done (17:30)

While the candle is burning, blow into the mic:
- **Light / medium blow:** the flame leans hard and sways with the blow strength, ripples faster, shrinks a little. Candlelight through the carved holes
  (pumpkin interior, light streaks on the porch, fog) flickers and dims along with it (multiplied into `flick`, so every shader using `candle` flickers too).
- **Strong enough blow for about 0.3 s:** the candle goes out. The flame shrinks to the wick in 0.24 s, then a red ember on the wick casts red light into the pumpkin (the carved holes glow red then
  cool over about 1.5 s). Two thin wisps of smoke rise from the top edge of the two highest holes (usually the eyes): straight at first, then curling
  into an S, widening, fading, living about 3.4 s. Smoke lives in world coordinates (m), projected through `basis`, so it has correct parallax when
  tilting or looking around. Smoke is lit by the moon, warms when the porch lamp comes back on, flashes with lightning. Then the scene goes dark, only
  moonlight; 1.7 s later the porch lamp flickers and comes back on (`PORCH_BACK_MS`, set < 0 to stay dark). Medium haptic.
- **Relight:** the match reappears on the porch. Tap the match and it strikes itself, lifts, lowers into the pumpkin's mouth and lights it (calls
  `lightUp` again). Dragging the match like the first time works too. Bats only fly the first time.

Images (Debug build on the Blow sim, composited by app time):
- `notes/blow/sheet.png`: 29.8 (burning) · 30.6 (light blow, flame sways) · 31.6 (strong blow) · 32.6 (out, red ember, smoke) · 33.4 (porch lamp back
  on) · 34.2 (match on the porch) · 36.4 (relit).
- `notes/blow/smoke.png`: close-up of the smoke wisps 32.0 → 34.0.

### Files (BLOW's)

- `app/src/fx/blowOut.ts`: `useBlowOut` hook, reads the mic, signal analysis, demo script `BLOW_DEMO`, worklets `blowFlicker`,
  `blowLean`, `emberAt`.
- `app/src/fx/Smoke.tsx`: smoke wisps (Atlas, up to 144 sprites, uses `pfx_atlas.ts` and the smoke sprite in `pfx_match.png`, read-only).
- `notes/blow/patch.py`: patches `PumpkinScene.tsx` (13 spots) and `pumpkin.ts` (7 spots) by anchor string. Idempotent script; if any anchor fails to match
  it stops without writing.
- `notes/blow/test_detector.sh`: offline detector test.

## What the main agent needs to do

### Step 1: merge code (no dependency, no rebuild needed yet)

```sh
python3 notes/blow/patch.py app/src/scene/PumpkinScene.tsx app/src/shaders/pumpkin.ts
```

`pumpkin.ts` belongs to PERF: the patch only adds 2 uniforms (`gust`, `ember`) and a few lines in `flameCol` and the interior colour. PERF should be told.

Without expo-audio, `require("expo-audio")` sits in a try/catch. Metro treats it as an optional dependency so the bundle still builds
(tried `expo export:embed` on a clone of the real app without expo-audio: OK, tsc and lint clean). At runtime there's no mic, no
blowing out, everything else as before. Demo mode doesn't need the mic: the blow follows the script. Also tried the case where expo-audio JS is
present but native isn't built (the main agent's current `.app` running with a Metro that has expo-audio): no errors, the demo still blows out and relights correctly.

The patch does the following (see `notes/blow/patch.py`):
1. Import `Easing`, `Smoke` and `{ BLOW_DEMO, blowFlicker, blowLean, useBlowOut }`.
2. Call `const blow = useBlowOut({ time, candle, porch, litAt, demo: DEMO, onOut })` right after `matchFade`. `onOut` moves the match back to
   `MATCH_REST`, `burn = 0`, then shows it again (`matchFade` → 0 after 0.9 s).
3. `lightUp`: allow relighting when `blow.outAt >= 0` and call `blow.relit()`. Bats are only scheduled when `batsAt < 0`.
4. Add worklet `strikeMatch()` (placed before `useFrameCallback`): the match flies itself into the pumpkin's mouth along an arc in 0.82 s, then `lightUp()`.
5. Demo: at `BLOW_DEMO.relight`, the virtual finger taps the match, then calls `strikeMatch()`.
6. Gesture: panning the match is allowed once the candle is out; tapping the match once the candle is out calls `strikeMatch()`.
7. `resetAll`: `blow.relit()`.
8. `flick *= blowFlicker(t, gust)`; `pU.lean += blowLean(t, gust)`; `pU.gust`, `pU.ember`.
9. `<Smoke outAt={blow.outAt} time={time} basis={basis} holes={bursts} porch={porch} storm={storm} />` right after `<Gust layer="scene" …/>`
   (before rain).

### Step 2: add the mic (when ready to build native)

```sh
cd app
npx expo install expo-audio          # → "expo-audio": "~58.0.10"
```

In `app.json`, replace the `"expo-audio"` entry that `expo install` just added to `plugins` with:

```json
["expo-audio", {
  "microphonePermission": "Blow into the microphone to blow out the candle.",
  "enableBackgroundPlayback": false,
  "enableBackgroundRecording": false,
  "recordAudioAndroid": false
}]
```

Rebuild native, one of two ways:
- **Prebuild:** `npx expo prebuild --platform ios --no-install && (cd ios && pod install)`, then build as usual
  (`npx expo run:ios` / xcodebuild). This overwrites `ios/` from `app.json`, so only use it if every native tweak already lives in `app.json`.
- **By hand (lighter, keeps the current ios/):** add to `ios/PumpkinCarve/Info.plist`
  `<key>NSMicrophoneUsageDescription</key><string>Blow into the microphone to blow out the candle.</string>`, then
  `cd ios && pod install` (autolinking adds the `ExpoAudio 58.0.10` pod) and rebuild.

The sandbox built Debug the prebuild way: **BUILD SUCCEEDED**. Info.plist has `NSMicrophoneUsageDescription`, no
`UIBackgroundModes` added.

## The blow in the demo (app time)

`BLOW_DEMO` in `blowOut.ts`. The main agent can move it to `demo/script.ts` to keep timings in one place.

| t (s) | What |
|---|---|
| 30.0–30.75 | light blow (0.42): flame sways, light through the carved holes flickers, candle stays lit |
| 31.25–31.95 | strong blow, candle out ≈ 31.6: flame shrinks to the wick, red ember, smoke starts ≈ 31.7 |
| ≈ 33.3 | porch lamp flickers then comes back on |
| 34.1–34.4 | virtual finger appears at the match; taps at 34.4 |
| ≈ 35.22 | match enters the pumpkin's mouth → `lightUp`: porch lamp off, dark for 0.39 s, candle flares ≈ 35.61 |

- To end the clip in darkness: `BLOW_DEMO.relight = null`.
- To drop the blow segment from the demo entirely: move `puff`/`blow` past the end of the clip.
- The demo tilt (`demoTilt`) runs again after relighting, because of the new `litAt`.
- Audio for `synth_audio.py`: soft breath at 30.0 · strong blow at 31.25 · flame snuffing "fft" at 31.6 · ember crackle ·
  porch lamp switch click at 33.3 · match strike at 34.45 · candle flare at 35.61.

## Blow detection

Uses `expo-audio` `useAudioStream`: raw 16 kHz mono PCM, 32 ms blocks. The native audio session uses `.record` / `.measurement`,
i.e. no AGC. The mic only runs while the candle is burning, and starts 2.5 s after lighting (`MIC_DELAY_MS`) so the first-time permission prompt doesn't cover
the candle flare moment. The mic stops when the candle goes out.

Features per block:
- **level** (dBFS) relative to the room noise floor (noise floor tracks down fast, up slow);
- **amplitude share < 300 Hz**: breath hitting the mic is a low-frequency rumble; "sss"/"shhh" sits in the high band;
- **steadiness**: amplitude variation over 160 ms;
- **voicing**: autocorrelation of the high band at 80–400 Hz lags. Vowels are periodic, blowing isn't. This value has about
  250 ms of memory so it also blocks the pauses between syllables.

From these, `gust`: any breath aimed at the device sways the flame, speech only sways it at 25 %. `force`: only counts loud,
low-frequency, steady, unvoiced blowing. `force > 0.55` accumulated for 0.3 s puts the candle out.

Offline test: `notes/blow/test_detector.sh` (runs the exact `analyse` function in Node, on synthetic audio mixed with room noise):

| sample | gust max | force max | held | result |
|---|---|---|---|---|
| strong blow 1.4 s (~ −19 dBFS) | 1.00 | 1.00 | 1.12 s | **out** |
| short blow 0.6 s | 1.00 | 0.97 | 0.35 s | **out** |
| medium breath (−33 dB) | 0.79 | 0.09 | 0 | sway only |
| light breath | 0.12 | 0 | 0 | almost nothing |
| normal speech | 0.43 | 0 | 0 | stays lit |
| loud speech close to the device (−12 LUFS) | 1.00 | 0.35 | 0 | stays lit (blew it out before "voicing" was added) |
| "shhh" (high band) | 0 | 0 | 0 | nothing |

**Not yet tested with a real mic.** This Mac mini has no built-in mic. The only input is the 8 kHz Bluetooth mic of a Tzumi speaker, and the sim
reports `!dev` (AVAudioEngine can't open the input device). Thresholds are currently tuned on synthetic audio. The first run on a real iPhone should enable
`EXPO_PUBLIC_BLOW_DEBUG=1` (logs `[blow] db … low … voice … force …` to Metro 4 times a second) to tune `BLOW_FORCE` and the
`smoothJS(...)` calls in `analyse` if needed. `EXPO_PUBLIC_BLOW_MIC=1` forces the real mic even in demo mode.

Note: while the mic runs, the audio session is in `.record` mode, so in-app playback (if any later) and other apps' music are muted until
the candle goes out. The app currently plays no audio (audio is composited in the promo), so no impact.

## Performance

- UI thread: one small frame callback, just a few operations when nobody is blowing. Smoke (144 sprites) uses `useSpriteBuffers` (hidden sprites
  use `HIDDEN_XF`, no Graphite log spam) and is only computed within 6 s after going out. The shader adds 2 uniforms and a few operations in
  `flameCol`, which only runs on pixels inside the carved holes.
- JS thread: mic analysis is about 0.5 million multiplies per second.
- Measured from sim recordings (Debug, machine load ~30–35): 100–400 ms hitches appear in both the unpatched and patched builds, including segments where
  nothing changed (the unpatched build has a 655 ms hitch at 27.5 s). The blow/out segment is within that noise. Accurate numbers need a
  Release build.
