#!/usr/bin/env bash
# Full Blender → app/assets/scene pipeline: build scene → render 2.5D layers + data + layout.json
# (plus *_pano.jpg panorama backgrounds and shadow_*.png pumpkin shadows), then check pano → render/v3/.
#   tools/build.sh            final (100 %, 128 samples)
#   PREVIEW=1 tools/build.sh  quick preview (50 %, 24 samples, ~1 min)
#   tools/build.sh --only bg_lit,skin_lit   re-render only some passes (data/layout post-processing still runs)
set -eo pipefail
cd "$(dirname "$0")/.."
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
if [[ "${PREVIEW:-0}" == 1 ]]; then RARGS=(--pct 50 --samples 24); else RARGS=(--pct 100 --samples 128); fi

"$BLENDER" -b --factory-startup -P blender/scripts/build_scene.py 2>&1 | grep -E "SAVED|WIDE|Error|Traceback" || true
"$BLENDER" -b blender/pumpkin.blend -P blender/scripts/render_passes.py -- "${RARGS[@]}" "$@" 2>&1 \
  | grep -E "── render|LAYOUT|SHADOW|DEPTH|Error|Traceback|line [0-9]+" || true
"$BLENDER" -b --factory-startup -P blender/scripts/check_pano.py 2>&1 | grep -E "PANO_CHECK|PANO_DEPTH|DEPTH_PROBE|Error|Traceback" || true
ls -lh app/assets/scene
