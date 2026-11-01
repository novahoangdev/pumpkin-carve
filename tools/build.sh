#!/usr/bin/env bash
# Toàn bộ pipeline Blender → app/assets/scene: dựng cảnh → render các lớp 2.5D + data + layout.json
# (kèm nền toàn cảnh *_pano.jpg và bóng quả bí shadow_*.png), rồi kiểm tra pano → render/v3/.
#   tools/build.sh            bản final (100 %, 128 sample)
#   PREVIEW=1 tools/build.sh  bản xem nhanh (50 %, 24 sample, ~1 phút)
#   tools/build.sh --only bg_lit,skin_lit   chỉ render lại vài pass (hậu kỳ data/layout vẫn chạy)
set -eo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
if [[ "${PREVIEW:-0}" == 1 ]]; then RARGS=(--pct 50 --samples 24); else RARGS=(--pct 100 --samples 128); fi

"$BLENDER" -b --factory-startup -P blender/scripts/build_scene.py 2>&1 | grep -E "SAVED|WIDE|Error|Traceback" || true
"$BLENDER" -b blender/pumpkin.blend -P blender/scripts/render_passes.py -- "${RARGS[@]}" "$@" 2>&1 \
  | grep -E "── render|LAYOUT|SHADOW|DEPTH|Error|Traceback|line [0-9]+" || true
"$BLENDER" -b --factory-startup -P blender/scripts/check_pano.py 2>&1 | grep -E "PANO_CHECK|PANO_DEPTH|DEPTH_PROBE|Error|Traceback" || true
ls -lh app/assets/scene
