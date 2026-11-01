#!/usr/bin/env bash
# Ảnh xem nhanh 6 khung (lưới 3×2, rộng 1800 px) từ clip promo đã xuất.
#   tools/sheet.sh [clip.mp4] [out.jpg] [beats.json]
#     mặc định: render/promo/pumpkin-carve-demo.mp4 → render/promo/pumpkin-carve-sheet.jpg, beat sheet v2
# Mốc lấy từ "sheet" (giây app) và "app_start" của beat sheet; ghi đè được bằng APP_TIMES="…" APP_START=…
set -eo pipefail
cd "$(dirname "$0")/.."
IN=${1:-render/promo/pumpkin-carve-demo.mp4}
OUT=${2:-render/promo/pumpkin-carve-sheet.jpg}
BEATS=${3:-blender/scripts/beats/v2.json}
APP_START=${APP_START:-$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['app_start'])" "$BEATS")}
APP_TIMES=${APP_TIMES:-$(python3 -c "import json,sys; print(' '.join(map(str, json.load(open(sys.argv[1]))['sheet'])))" "$BEATS")}
[[ -f "$IN" ]] || { echo "không thấy $IN" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
i=0
for t in $APP_TIMES; do
  c=$(python3 -c "print(max(0.0, round($t - $APP_START, 3)))")
  ffmpeg -v error -y -ss "$c" -i "$IN" -frames:v 1 -vf "scale=600:450:flags=lanczos" "$TMP/$i.png"
  i=$((i + 1))
done
[[ $i -eq 6 ]] || { echo "cần đúng 6 mốc (đang có $i)" >&2; exit 1; }
# viền tối 4 px giữa các ô cho dễ nhìn
ffmpeg -v error -y -framerate 1 -i "$TMP/%d.png" \
  -vf "tile=3x2:padding=4:margin=4:color=0x0b0d18,scale=1800:-2:flags=lanczos" -frames:v 1 -q:v 3 "$OUT"
ls -lh "$OUT"
