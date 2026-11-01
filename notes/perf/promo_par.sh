#!/bin/bash
# promo_par.sh — render the promo with N parallel Blender processes (each one a contiguous frame segment, written straight to H.264 lossless),
# join without re-encoding (concat copy), mix audio, export master + the 60 fps X version. Replaces steps 5–6 of tools/promo.sh.
# Needs blender/scripts/promo.py with --range / --video / PROMO_FAST (notes/perf/promo-fast.patch).
#
#   BEATS=blender/scripts/beats/v4.json SCREEN=render/promo/v4b/screen-120.mp4 FILM0=0.776 FPS=120 \
#   FINAL=render/promo/pumpkin-carve-demo-120.mp4 [WORKERS=3] [AUDIO=…] [APP_START=…] [PCT=100] [LABEL=] tools/promo_par.sh
#
# Default PROMO_FAST=1 (shadows off + TAA 8; measured: indistinguishable by eye, see notes/perf.md). PROMO_FAST=0 = original quality.
# Disk: only ~0.8 MB/frame for the lossless segments (4140 frames ≈ 3.3 GB), no PNGs.
set -euo pipefail
cd "${ROOT:-$(dirname "$0")/..}"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
PROMO_PY=${PROMO_PY:-blender/scripts/promo.py}
BEATS=${BEATS:?}; SCREEN=${SCREEN:?}; FILM0=${FILM0:?}; FPS=${FPS:-120}; FINAL=${FINAL:?}
WORKERS=${WORKERS:-3}; PCT=${PCT:-100}; LABEL=${LABEL:-}
export PROMO_FAST=${PROMO_FAST:-1}
APP_START=${APP_START:-$(python3 -c "import json;print(json.load(open('$BEATS'))['app_start'])")}
AUDIO=${AUDIO:-$(python3 -c "import json;print(json.load(open('$BEATS')).get('audio','render/audio/mix.wav'))")}
# frame count = same as promo.py: round((app_end − app_start + card) · FPS)
NF=$(python3 -c "
import json; b = json.load(open('$BEATS'))
print(round((b['app_end'] - b['app_start'] + b.get('card', 3.6)) * $FPS))")
[[ -n "${MAXF:-}" ]] && NF=$MAXF                                   # quick test: only the first MAXF frames
TMP=${TMP_DIR:-$(dirname "$FINAL")/par_$(basename "$FINAL" .mp4)}
rm -rf "$TMP"; mkdir -p "$TMP"
echo "rendering $NF frames @ ${FPS} fps with $WORKERS processes (PROMO_FAST=$PROMO_FAST) → $TMP"
T0=$(date +%s)
PIDS=()
for ((i = 0; i < WORKERS; i++)); do
  a=$(( NF * i / WORKERS )); b=$(( NF * (i + 1) / WORKERS - 1 ))
  "$BLENDER" -b --factory-startup -P "$PROMO_PY" -- --beats "$BEATS" --screen "$SCREEN" --film-start "$FILM0" \
    --pct "$PCT" --label "$LABEL" --fps "$FPS" --out "$TMP/unused" --range "$a,$b" --video "$TMP/part$i.mp4" \
    > "$TMP/part$i.log" 2>&1 &
  PIDS+=($!)
done
fail=0
for p in "${PIDS[@]}"; do wait "$p" || fail=1; done
for ((i = 0; i < WORKERS; i++)); do
  grep -q Traceback "$TMP/part$i.log" && { echo "error in process $i:"; grep -A5 Traceback "$TMP/part$i.log"; fail=1; }
done
[[ $fail == 0 ]] || exit 1
echo "render done in $(( $(date +%s) - T0 )) s"

# join (no re-encode) and check the frame count
for ((i = 0; i < WORKERS; i++)); do echo "file '$(cd "$TMP" && pwd)/part$i.mp4'"; done > "$TMP/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" -c copy "$TMP/master_lossless.mp4"
GOT=$(ffprobe -v error -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$TMP/master_lossless.mp4")
[[ "$GOT" == "$NF" ]] || { echo "missing frames: $GOT / $NF" >&2; exit 1; }
DUR=$(python3 -c "print(round($NF / $FPS, 3))")

# export (like tools/promo.sh step 6): audio starts at app t=0 → trim the first APP_START seconds
VENC=(-c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p -r "$FPS" -movflags +faststart)
if [[ -f "$AUDIO" ]]; then
  AF=$(python3 -c "
s, d = $APP_START, $DUR
head = f'atrim=start={s},asetpts=PTS-STARTPTS' if s >= 0 else f'adelay={round(-s*1000)}:all=1'
print(f'{head},apad,atrim=end={d},afade=t=out:st={round(d - 0.5, 2)}:d=0.5')")
  ffmpeg -y -loglevel error -i "$TMP/master_lossless.mp4" -i "$AUDIO" -filter_complex "[1:a]$AF[a]" -map 0:v -map "[a]" -t "$DUR" \
    "${VENC[@]}" -c:a aac -b:a 192k -ar 48000 "$FINAL"
else
  echo "no $AUDIO yet → no audio"
  ffmpeg -y -loglevel error -i "$TMP/master_lossless.mp4" "${VENC[@]}" "$FINAL"
fi
ls -lh "$FINAL"
if [[ "$FPS" -gt 60 ]]; then                                       # X version: even frames of the master, no frame blending
  X60="${FINAL%.mp4}-x60.mp4"
  ffmpeg -y -loglevel error -i "$FINAL" -vf "select='not(mod(n\,2))',setpts=N/(60*TB)" -r 60 \
    -c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -c:a copy "$X60"
  ls -lh "$X60"
fi
echo "total $(( $(date +%s) - T0 )) s; delete $TMP once checked (lossless ~0.8 MB/frame)"
