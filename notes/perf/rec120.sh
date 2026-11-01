#!/bin/bash
# rec120.sh — record the simulator while the app runs slowed down (EXPO_PUBLIC_TIMESCALE = TS), compress time → 120 fps CFR master,
# a 60 fps version for X (every other frame, no blending), then check with mpdecimate (distinct frames per demo second).
#
#   UDID=<sim> TS=0.25 SECS=32 OUT=render/promo/v120 rec120.sh            # terminate + launch app (Release build with the same TS)
#   UDID=<sim> TS=0.25 SECS=32 OUT=… NOLAUNCH=1 rec120.sh                  # record only (open / reload the app yourself after "Recording started")
#   TS=0.25 OUT=… RAW=raw.mov rec120.sh                                    # only process an existing recording
#
# TS: 0.5 → 120 frames/demo second in theory, but the simulator recorder jitters so some 1/120 s slots get duplicate frames;
#     0.25 (recommended) → 2× headroom (240/demo second), CFR 120 always has a new frame. Recording takes 1/TS as long (32 s demo ≈ 128 s).
# SECS: demo length to capture (demo seconds); PRE: extra real seconds recorded before the app reaches t=0 (app launch + image load + shader wait, default 8).
# Output: $OUT/raw.mov, $OUT/screen-120.mp4 (H.264 CRF 12, 120 fps CFR), $OUT/screen-60.mp4 (60 fps, even frames of the 120 version),
#     $OUT/check.txt (per demo second: distinct frames in the 120 and 60 versions).
# Audio is built separately (synth_audio.py from app timestamps), not taken from the recording.
set -euo pipefail
TS=${TS:?set TS = EXPO_PUBLIC_TIMESCALE of the app build being recorded}
OUT=${OUT:?set OUT}; SECS=${SECS:-32}; PRE=${PRE:-8}; APP=${APP:-dev.hoanghoa.pumpkincarve}
mkdir -p "$OUT"
RAW=${RAW:-}
if [[ -z "$RAW" ]]; then
  UDID=${UDID:?set UDID}
  RAW="$OUT/raw.mov"
  REAL=$(python3 -c "print(round($SECS / $TS + $PRE + 2, 1))")
  [[ -z "${NOLAUNCH:-}" ]] && { xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true; }
  rm -f "$RAW"
  # h264: hardware encoder, lighter than the default hevc
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$RAW" 2>"$OUT/rec.log" & REC=$!
  until grep -q "Recording started" "$OUT/rec.log" 2>/dev/null; do sleep 0.2; done
  [[ -z "${NOLAUNCH:-}" ]] && xcrun simctl launch "$UDID" "$APP" >/dev/null
  echo "recording $REAL real s (TS=$TS)…"
  sleep "$REAL"; kill -INT $REC; wait $REC 2>/dev/null || true
fi

# 1. compress time using the container pts (keeps the app's timing) → 120 fps CFR, nearest frame for each 1/120 s slot
ffmpeg -y -loglevel error -i "$RAW" -an -vf "setpts=PTS*$TS,fps=120" -r 120 \
  -c:v libx264 -preset slow -crf 12 -pix_fmt yuv420p -movflags +faststart "$OUT/screen-120.mp4"
# 2. 60 fps version for X: even frames of the 120 version (no frame blending)
ffmpeg -y -loglevel error -i "$OUT/screen-120.mp4" -vf "select='not(mod(n\,2))',setpts=N/(60*TB)" -r 60 \
  -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -movflags +faststart "$OUT/screen-60.mp4"

# 3. check: mpdecimate (drop duplicate frames, threshold near 0) → distinct frames in each demo second
count() {
  ffmpeg -hide_banner -i "$1" -vf "mpdecimate=hi=1:lo=1:frac=0,showinfo" -f null - 2>&1 \
    | grep -o "pts_time:[0-9.]*" | cut -d: -f2 \
    | python3 -c "
import sys
b={}
for x in sys.stdin.read().split(): b[int(float(x))]=b.get(int(float(x)),0)+1
print(' '.join(f'{k}:{b.get(k,0)}' for k in range(max(b)+1)))"
}
{
  echo "120 fps (target 120 per second): $(count "$OUT/screen-120.mp4")"
  echo "60 fps  (target 60 per second):  $(count "$OUT/screen-60.mp4")"
  echo "(the first seconds before app t=0 and the still screen at the end of the clip will be low — ignore)"
} | tee "$OUT/check.txt"
echo "→ $OUT/screen-120.mp4, $OUT/screen-60.mp4, $OUT/check.txt"
