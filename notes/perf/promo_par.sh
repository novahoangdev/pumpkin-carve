#!/bin/bash
# promo_par.sh — dựng promo bằng N tiến trình Blender song song (mỗi tiến trình một đoạn khung liền, ghi thẳng H.264 lossless),
# ghép lại không nén lại (concat copy), trộn tiếng, xuất master + bản X 60 fps. Thay bước 5–6 của tools/promo.sh.
# Cần blender/scripts/promo.py đã có --range / --video / PROMO_FAST (notes/perf/promo-fast.patch).
#
#   BEATS=blender/scripts/beats/v4.json SCREEN=render/promo/v4b/screen-120.mp4 FILM0=0.776 FPS=120 \
#   FINAL=render/promo/pumpkin-carve-demo-120.mp4 [WORKERS=3] [AUDIO=…] [APP_START=…] [PCT=100] [LABEL=] tools/promo_par.sh
#
# Mặc định PROMO_FAST=1 (tắt bóng + TAA 8; đo: không phân biệt được bằng mắt, xem notes/perf.md). PROMO_FAST=0 = chất lượng gốc.
# Đĩa: chỉ cần ~0,8 MB/khung cho các đoạn lossless (4140 khung ≈ 3,3 GB), không có PNG.
set -euo pipefail
cd "${ROOT:-$(dirname "$0")/..}"
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
PROMO_PY=${PROMO_PY:-blender/scripts/promo.py}
BEATS=${BEATS:?}; SCREEN=${SCREEN:?}; FILM0=${FILM0:?}; FPS=${FPS:-120}; FINAL=${FINAL:?}
WORKERS=${WORKERS:-3}; PCT=${PCT:-100}; LABEL=${LABEL:-}
export PROMO_FAST=${PROMO_FAST:-1}
APP_START=${APP_START:-$(python3 -c "import json;print(json.load(open('$BEATS'))['app_start'])")}
AUDIO=${AUDIO:-$(python3 -c "import json;print(json.load(open('$BEATS')).get('audio','render/audio/mix.wav'))")}
# số khung = như promo.py: round((app_end − app_start + card) · FPS)
NF=$(python3 -c "
import json; b = json.load(open('$BEATS'))
print(round((b['app_end'] - b['app_start'] + b.get('card', 3.6)) * $FPS))")
[[ -n "${MAXF:-}" ]] && NF=$MAXF                                   # thử nhanh: chỉ MAXF khung đầu
TMP=${TMP_DIR:-$(dirname "$FINAL")/par_$(basename "$FINAL" .mp4)}
rm -rf "$TMP"; mkdir -p "$TMP"
echo "dựng $NF khung @ ${FPS} fps bằng $WORKERS tiến trình (PROMO_FAST=$PROMO_FAST) → $TMP"
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
  grep -q Traceback "$TMP/part$i.log" && { echo "lỗi ở tiến trình $i:"; grep -A5 Traceback "$TMP/part$i.log"; fail=1; }
done
[[ $fail == 0 ]] || exit 1
echo "render xong trong $(( $(date +%s) - T0 )) s"

# ghép (không nén lại) và kiểm số khung
for ((i = 0; i < WORKERS; i++)); do echo "file '$(cd "$TMP" && pwd)/part$i.mp4'"; done > "$TMP/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$TMP/list.txt" -c copy "$TMP/master_lossless.mp4"
GOT=$(ffprobe -v error -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$TMP/master_lossless.mp4")
[[ "$GOT" == "$NF" ]] || { echo "thiếu khung: $GOT / $NF" >&2; exit 1; }
DUR=$(python3 -c "print(round($NF / $FPS, 3))")

# xuất (như tools/promo.sh bước 6): audio bắt đầu ở app t=0 → cắt APP_START giây đầu
VENC=(-c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p -r "$FPS" -movflags +faststart)
if [[ -f "$AUDIO" ]]; then
  AF=$(python3 -c "
s, d = $APP_START, $DUR
head = f'atrim=start={s},asetpts=PTS-STARTPTS' if s >= 0 else f'adelay={round(-s*1000)}:all=1'
print(f'{head},apad,atrim=end={d},afade=t=out:st={round(d - 0.5, 2)}:d=0.5')")
  ffmpeg -y -loglevel error -i "$TMP/master_lossless.mp4" -i "$AUDIO" -filter_complex "[1:a]$AF[a]" -map 0:v -map "[a]" -t "$DUR" \
    "${VENC[@]}" -c:a aac -b:a 192k -ar 48000 "$FINAL"
else
  echo "chưa có $AUDIO → không tiếng"
  ffmpeg -y -loglevel error -i "$TMP/master_lossless.mp4" "${VENC[@]}" "$FINAL"
fi
ls -lh "$FINAL"
if [[ "$FPS" -gt 60 ]]; then                                       # bản X: khung chẵn của master, không trộn khung
  X60="${FINAL%.mp4}-x60.mp4"
  ffmpeg -y -loglevel error -i "$FINAL" -vf "select='not(mod(n\,2))',setpts=N/(60*TB)" -r 60 \
    -c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart -c:a copy "$X60"
  ls -lh "$X60"
fi
echo "tổng $(( $(date +%s) - T0 )) s; xoá $TMP khi đã kiểm xong (lossless ~0,8 MB/khung)"
