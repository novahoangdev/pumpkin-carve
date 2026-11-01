#!/usr/bin/env bash
# Record the app on a simulator, then build a 4:3 demo clip for X (copied and adapted from ../goku-vs-frieza/tools/promo.sh).
#   tools/promo.sh [--beats blender/scripts/beats/v3.json] [<udid>]
#       default udid: the project's own simulator "Pumpkin 17 Pro Max" (CA7F5A01-…, auto-boots if shut down)
#       Release build of the app with EXPO_PUBLIC_DEMO=1, installed on the simulator (bundle dev.hoanghoa.pumpkincarve)
#   tools/promo.sh --beats blender/scripts/beats/v2.json --screen render/promo/v2/screen.mp4 [--film-start 2.36] [--out x.mp4]
#       no recording: rebuild from an existing recording (already CFR 60fps; 17 Pro Max: 1320×2868, old 17 Pro: 1206×2622,
#       with the matching "view" in the beat sheet); no udid needed
#   tools/promo.sh --beats … --screen … --stills 2,8.8,12,15,20
#       render only a few frames (seconds in the promo clip) to render/promo/stills/ for a quick look
# Beat sheet (JSON, one file per recording) holds every cue: app_start/app_end/card, burst (sync cue), audio,
#   background colour, background text, camera, phone, punch/shake, bats, frames for sheet.sh. Default: blender/scripts/beats/v2.json
# Env vars: PCT=50 (render at half resolution for tests), LABEL=v2 (small label bottom left),
#   FRAMES=render/promo/frames (frame folder), AUDIO=… (override the beat sheet's audio), REC_SECS=… (recording length),
#   PAUSE_PATTERN="render_passes.py" (pause heavy processes while recording), BLENDER=...
#   TIMESCALE=0.5 FPS=120: app built with EXPO_PUBLIC_TIMESCALE=0.5 runs at half speed → record twice as long, compress pts ×0.5 into
#     120 fps CFR (every frame is a real frame), Blender renders at 120 fps; also exports <out>-x60.mp4 (every other frame) for X.
#   PAUSE_ALL=1: pause every app on other simulators + ffmpeg + Blender while recording (tools/pauseall.sh)
# Out: render/promo/pumpkin-carve-demo.mp4 (H.264 1920×1440 60fps [+ AAC if there is an audio file])
#     and render/promo/screen.mp4 (CFR screen recording, when recording fresh)
set -eo pipefail
cd "$(dirname "$0")/.."
APP=dev.hoanghoa.pumpkincarve
OUT=render/promo
FRAMES=${FRAMES:-$OUT/frames}   # PNG frame folder (change it when running two builds in parallel)
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
BEATS=blender/scripts/beats/v2.json
UDID="" SCREEN="" FILM0="" STILLS="" FINAL="$OUT/pumpkin-carve-demo.mp4"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --beats) BEATS=$2; shift 2 ;;
    --screen) SCREEN=$2; shift 2 ;;
    --film-start) FILM0=$2; shift 2 ;;
    --stills) STILLS=$2; shift 2 ;;
    --out) FINAL=$2; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) UDID=$1; shift ;;
  esac
done
[[ -f "$BEATS" ]] || { echo "beat sheet not found: $BEATS" >&2; exit 1; }
beat() { python3 -c "import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2], sys.argv[3]); print(v)" "$BEATS" "$1" "$2"; }
TIMESCALE=${TIMESCALE:-1}           # time scale the app was built with (EXPO_PUBLIC_TIMESCALE)
FPS=${FPS:-60}                      # fps of the normalised recording + fps of the exported clip
BURST_T=$(beat burst 9.89)          # app second of the candle burst (the strongest brightness jump in the whole recording) → sync cue
APP_START=$(beat app_start 1.1)     # app second matching the first frame of the clip
AUDIO=${AUDIO:-$(beat audio render/audio/mix.wav)}   # audio starts at app t=0
mkdir -p "$OUT"

if [[ -z "$SCREEN" ]]; then
  UDID=${UDID:-CA7F5A01-D288-47E0-9CED-0EFBED4178D1}      # "Pumpkin 17 Pro Max" (iOS 27.0), the project's own sim
  xcrun simctl bootstatus "$UDID" -b >/dev/null
  # 1. clean, ad-style status bar
  xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiBars 3 --dataNetwork wifi

  # 2. record: the demo app runs its script by itself; record ~6 s past app_end so the clip doesn't run short
  #    PAUSE_PATTERN: pause heavy processes (e.g. a Blender render) while recording so the simulator doesn't stutter
  PIDS=""
  if [[ -n "${PAUSE_PATTERN:-}" ]]; then PIDS=$(pgrep -f "$PAUSE_PATTERN" || true); fi
  if [[ -n "${PAUSE_ALL:-}" ]]; then
    PIDS="$PIDS $(ps ax -o pid=,command= | grep -E 'CoreSimulator/Devices/[^/]+/data/Containers/Bundle/Application/.*\.app/|(^|/| )ffmpeg |Blender' \
      | grep -v "$UDID" | grep -v grep | awk '{print $1}' | tr '\n' ' ')"
  fi
  PIDS=$(echo $PIDS)   # strip extra whitespace
  resume() { [[ -n "$PIDS" ]] && kill -CONT $PIDS 2>/dev/null || true; }
  trap 'resume; xcrun simctl status_bar "$UDID" clear 2>/dev/null || true' EXIT
  [[ -n "$PIDS" ]] && kill -STOP $PIDS && sleep 2
  xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true
  rm -f "$OUT/raw.mov"
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/raw.mov" >/dev/null 2>&1 &
  REC=$!
  sleep 1.5
  xcrun simctl launch "$UDID" "$APP" >/dev/null
  sleep "${REC_SECS:-$(python3 -c "print(round(($(beat app_end 18.4) + $(beat card 3.6) + 6) / $TIMESCALE + 2))")}"
  kill -INT "$REC"; wait "$REC" 2>/dev/null || true
  resume

  # 3. constant FPS from the container pts (the simulator records a variable frame rate); TIMESCALE < 1: compress pts back to 1.0x speed
  ffmpeg -y -loglevel error -i "$OUT/raw.mov" -vf "setpts=$TIMESCALE*PTS,fps=$FPS,scale=1320:2868:flags=lanczos" \
    -c:v libx264 -crf 14 -pix_fmt yuv420p -an "$OUT/screen.mp4"
  SCREEN="$OUT/screen.mp4"
fi
[[ -f "$SCREEN" ]] || { echo "not found: $SCREEN" >&2; exit 1; }

# 4. find the candle burst (tools/sync.py): mean brightness jumps and stays bright (unlike lightning, which flashes then dies)
#    → FILM0 = that frame's second − burst = the second in the recording matching app t=0.
#    Only search from second "burst" onwards (the candle can't burst earlier in the recording) → skips brightness jumps at app launch.
if [[ -z "$FILM0" ]]; then
  read -r BURST JUMP < <(ffmpeg -loglevel error -i "$SCREEN" \
      -vf "scale=64:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - \
    | awk '/pts_time/{split($0,a,"pts_time:"); t=a[2]+0} /YAVG/{split($0,b,"="); print t, b[2]+0}' \
    | python3 tools/sync.py "$BURST_T")
  FILM0=$(python3 -c "print(round($BURST - $BURST_T, 3))")
  echo "candle burst at ${BURST}s (YAVG +${JUMP}) → app t=0 at ${FILM0}s in the recording"
  python3 -c "import sys; sys.exit(0 if $FILM0 + $APP_START >= 0 else 1)" \
    || { echo "FILM0 negative: recording started too late or the cue was misdetected — pass --film-start by hand" >&2; exit 1; }
fi

# 5. build the 4:3 clip in Blender (every cue comes from the beat sheet)
PROMO_ARGS=(--beats "$BEATS" --screen "$SCREEN" --film-start "$FILM0" --pct "${PCT:-100}" --label "${LABEL:-}" --fps "$FPS")
if [[ -n "$STILLS" ]]; then
  rm -rf "$OUT/stills"
  "$BLENDER" -b --factory-startup -P blender/scripts/promo.py -- "${PROMO_ARGS[@]}" --out "$OUT/stills" --stills "$STILLS" \
    2>&1 | grep -E "PROMO|Error|Traceback" || true
  ls "$OUT/stills"
  exit 0
fi
rm -rf "$FRAMES"
T0=$(date +%s)
"$BLENDER" -b --factory-startup -P blender/scripts/promo.py -- "${PROMO_ARGS[@]}" --out "$FRAMES" \
  2>&1 | grep -E "PROMO|Error|Traceback" || true
NF=$(ls "$FRAMES" | grep -c '\.png$' || true)
[[ "$NF" -gt 0 ]] || { echo "Blender produced no frames" >&2; exit 1; }
DUR=$(python3 -c "print(round($NF / $FPS, 3))")
echo "rendered $NF frames (${DUR}s) in $(( $(date +%s) - T0 ))s"

# 6. export for X; audio starts at app t=0 → trim the first APP_START seconds to match the picture.
#    the audio fades out by itself at the end (the tail plays under the end card) → just add a 0.5 s fade right at the clip end to be safe
VENC=(-c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p -r "$FPS" -movflags +faststart)
if [[ -f "$AUDIO" ]]; then
  AF=$(python3 -c "
s, d = $APP_START, $DUR
head = f'atrim=start={s},asetpts=PTS-STARTPTS' if s >= 0 else f'adelay={round(-s*1000)}:all=1'
print(f'{head},apad,atrim=end={d},afade=t=out:st={round(d - 0.5, 2)}:d=0.5')")
  ffmpeg -y -loglevel error -stats -framerate "$FPS" -i "$FRAMES/%04d.png" -i "$AUDIO" \
    -filter_complex "[1:a]$AF[a]" -map 0:v -map "[a]" -t "$DUR" \
    "${VENC[@]}" -c:a aac -b:a 192k -ar 48000 "$FINAL"
else
  echo "no $AUDIO yet → exporting clip without audio"
  ffmpeg -y -loglevel error -stats -framerate "$FPS" -i "$FRAMES/%04d.png" "${VENC[@]}" "$FINAL"
fi
ls -lh "$FINAL"
# X upload: max 60 fps → take every other frame from the master (no blending), keep the audio as is
if [[ "$FPS" -gt 60 ]]; then
  X60="${FINAL%.mp4}-x60.mp4"
  ffmpeg -y -loglevel error -i "$FINAL" -vf "fps=60" -c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p \
    -movflags +faststart -c:a copy "$X60"
  ls -lh "$X60"
fi
