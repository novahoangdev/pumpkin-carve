#!/usr/bin/env bash
# Quay app trên simulator rồi dựng clip demo 4:3 để đăng X (chép và chỉnh từ ../goku-vs-frieza/tools/promo.sh).
#   tools/promo.sh [--beats blender/scripts/beats/v3.json] [<udid>]
#       udid mặc định: simulator riêng của dự án "Pumpkin 17 Pro Max" (CA7F5A01-…, tự boot nếu đang tắt)
#       app bản Release build với EXPO_PUBLIC_DEMO=1, đã cài trên simulator (bundle dev.hoanghoa.pumpkincarve)
#   tools/promo.sh --beats blender/scripts/beats/v2.json --screen render/promo/v2/screen.mp4 [--film-start 2.36] [--out x.mp4]
#       không quay: dựng lại từ một bản quay có sẵn (đã CFR 60fps; 17 Pro Max: 1320×2868, bản cũ 17 Pro: 1206×2622,
#       beat sheet ghi "view" tương ứng); không cần udid
#   tools/promo.sh --beats … --screen … --stills 2,8.8,12,15,20
#       chỉ render vài khung (giây trong clip promo) ra render/promo/stills/ để xem nhanh
# Beat sheet (JSON, một file cho mỗi bản quay) chứa mọi mốc: app_start/app_end/card, burst (mốc đồng bộ), audio,
#   màu nền, chữ nền, camera, máy, punch/shake, dơi, các khung cho sheet.sh. Mặc định: blender/scripts/beats/v2.json
# Biến môi trường: PCT=50 (render nửa độ phân giải để thử), LABEL=v2 (nhãn nhỏ góc dưới trái),
#   FRAMES=render/promo/frames (thư mục frame), AUDIO=… (ghi đè audio của beat sheet), REC_SECS=… (thời gian quay),
#   PAUSE_PATTERN="render_passes.py" (tạm dừng process nặng lúc quay), BLENDER=...
#   TIMESCALE=0.5 FPS=120: app build với EXPO_PUBLIC_TIMESCALE=0.5 chạy chậm một nửa → quay lâu gấp đôi, nén pts ×0.5 thành
#     120 fps CFR (mỗi khung là một khung thật), Blender dựng 120 fps; xuất thêm <out>-x60.mp4 (lấy cách khung) để đăng X.
#   PAUSE_ALL=1: tạm dừng mọi app trên simulator khác + ffmpeg + Blender trong lúc quay (tools/pauseall.sh)
# Ra: render/promo/pumpkin-carve-demo.mp4 (H.264 1920×1440 60fps [+ AAC nếu có file audio])
#     và render/promo/screen.mp4 (bản quay màn hình đã CFR, khi quay mới)
set -eo pipefail
cd "$(dirname "$0")/.."
APP=dev.hoanghoa.pumpkincarve
OUT=render/promo
FRAMES=${FRAMES:-$OUT/frames}   # thư mục frame PNG (đổi khi chạy song song hai bản)
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
[[ -f "$BEATS" ]] || { echo "không thấy beat sheet $BEATS" >&2; exit 1; }
beat() { python3 -c "import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2], sys.argv[3]); print(v)" "$BEATS" "$1" "$2"; }
TIMESCALE=${TIMESCALE:-1}           # hệ số thời gian app đã build (EXPO_PUBLIC_TIMESCALE)
FPS=${FPS:-60}                      # fps bản quay đã chuẩn hoá + fps clip xuất
BURST_T=$(beat burst 9.89)          # giây app lúc nến bùng (khung sáng vọt lên mạnh nhất cả bản quay) → mốc đồng bộ
APP_START=$(beat app_start 1.1)     # giây app ứng với frame đầu clip
AUDIO=${AUDIO:-$(beat audio render/audio/mix.wav)}   # audio bắt đầu ở app t=0
mkdir -p "$OUT"

if [[ -z "$SCREEN" ]]; then
  UDID=${UDID:-CA7F5A01-D288-47E0-9CED-0EFBED4178D1}      # "Pumpkin 17 Pro Max" (iOS 27.0), sim riêng của dự án
  xcrun simctl bootstatus "$UDID" -b >/dev/null
  # 1. status bar sạch kiểu ảnh quảng cáo
  xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 \
    --cellularMode active --cellularBars 4 --wifiBars 3 --dataNetwork wifi

  # 2. quay: app demo tự chạy theo kịch bản; quay dư ~6 s sau app_end để clip không hụt hình
  #    PAUSE_PATTERN: tạm dừng process nặng (vd render Blender) trong lúc quay để simulator không bị giật
  PIDS=""
  if [[ -n "${PAUSE_PATTERN:-}" ]]; then PIDS=$(pgrep -f "$PAUSE_PATTERN" || true); fi
  if [[ -n "${PAUSE_ALL:-}" ]]; then
    PIDS="$PIDS $(ps ax -o pid=,command= | grep -E 'CoreSimulator/Devices/[^/]+/data/Containers/Bundle/Application/.*\.app/|(^|/| )ffmpeg |Blender' \
      | grep -v "$UDID" | grep -v grep | awk '{print $1}' | tr '\n' ' ')"
  fi
  PIDS=$(echo $PIDS)   # bỏ khoảng trắng thừa
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

  # 3. về FPS đều theo pts của container (simulator ghi frame rate thay đổi); TIMESCALE < 1: nén pts về tốc độ 1.0x
  ffmpeg -y -loglevel error -i "$OUT/raw.mov" -vf "setpts=$TIMESCALE*PTS,fps=$FPS,scale=1320:2868:flags=lanczos" \
    -c:v libx264 -crf 14 -pix_fmt yuv420p -an "$OUT/screen.mp4"
  SCREEN="$OUT/screen.mp4"
fi
[[ -f "$SCREEN" ]] || { echo "không thấy $SCREEN" >&2; exit 1; }

# 4. dò lúc nến bùng (tools/sync.py): độ sáng trung bình tăng vọt và giữ sáng (khác tia sét loé rồi tắt)
#    → FILM0 = giây của frame đó − burst = giây trong bản quay ứng với app t=0.
#    Chỉ xét từ giây "burst" trở đi (nến không thể bùng sớm hơn trong bản quay) → bỏ các cú nhảy sáng lúc mở app.
if [[ -z "$FILM0" ]]; then
  read -r BURST JUMP < <(ffmpeg -loglevel error -i "$SCREEN" \
      -vf "scale=64:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - \
    | awk '/pts_time/{split($0,a,"pts_time:"); t=a[2]+0} /YAVG/{split($0,b,"="); print t, b[2]+0}' \
    | python3 tools/sync.py "$BURST_T")
  FILM0=$(python3 -c "print(round($BURST - $BURST_T, 3))")
  echo "nến bùng ở ${BURST}s (YAVG +${JUMP}) → app t=0 ở ${FILM0}s trong bản quay"
  python3 -c "import sys; sys.exit(0 if $FILM0 + $APP_START >= 0 else 1)" \
    || { echo "FILM0 âm: bản quay bắt đầu quá trễ hoặc dò sai mốc — truyền --film-start tay" >&2; exit 1; }
fi

# 5. dựng clip 4:3 trong Blender (mọi mốc lấy từ beat sheet)
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
[[ "$NF" -gt 0 ]] || { echo "Blender không ra frame nào" >&2; exit 1; }
DUR=$(python3 -c "print(round($NF / $FPS, 3))")
echo "render $NF frame (${DUR}s) trong $(( $(date +%s) - T0 ))s"

# 6. xuất cho X; audio bắt đầu ở app t=0 → cắt bỏ APP_START giây đầu cho khớp hình.
#    audio tự fade ở cuối (đuôi phát dưới end card) → chỉ thêm fade 0.5 s sát cuối clip cho chắc
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
  echo "chưa có $AUDIO → xuất clip không tiếng"
  ffmpeg -y -loglevel error -stats -framerate "$FPS" -i "$FRAMES/%04d.png" "${VENC[@]}" "$FINAL"
fi
ls -lh "$FINAL"
# bản đăng X: tối đa 60 fps → lấy cách khung từ master (không blend), giữ nguyên tiếng
if [[ "$FPS" -gt 60 ]]; then
  X60="${FINAL%.mp4}-x60.mp4"
  ffmpeg -y -loglevel error -i "$FINAL" -vf "fps=60" -c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p \
    -movflags +faststart -c:a copy "$X60"
  ls -lh "$X60"
fi
