#!/bin/bash
# rec120.sh — quay simulator khi app chạy chậm (EXPO_PUBLIC_TIMESCALE = TS), nén thời gian → master 120 fps CFR,
# bản 60 fps cho X (lấy cách khung, không blend), rồi kiểm mpdecimate (số khung khác nhau mỗi giây demo).
#
#   UDID=<sim> TS=0.25 SECS=32 OUT=render/promo/v120 rec120.sh            # terminate + launch app (Release build với cùng TS)
#   UDID=<sim> TS=0.25 SECS=32 OUT=… NOLAUNCH=1 rec120.sh                  # chỉ quay (tự mở / reload app sau khi "Recording started")
#   TS=0.25 OUT=… RAW=raw.mov rec120.sh                                    # chỉ xử lý một bản quay có sẵn
#
# TS: 0.5 → 120 khung/giây demo trên lý thuyết, nhưng bộ ghi simulator có jitter nên vài ô 1/120 s sẽ trùng khung;
#     0.25 (khuyên dùng) → dư gấp đôi (240/giây demo), CFR 120 luôn có khung mới. Quay lâu gấp 1/TS (32 s demo ≈ 128 s).
# SECS: độ dài demo cần lấy (giây demo); PRE: giây thật quay dư trước khi app vào t=0 (mở app + nạp ảnh + chờ shader, mặc định 8).
# Ra: $OUT/raw.mov, $OUT/screen-120.mp4 (H.264 CRF 12, 120 fps CFR), $OUT/screen-60.mp4 (60 fps, khung chẵn của bản 120),
#     $OUT/check.txt (mỗi giây demo: số khung khác nhau của bản 120 và 60).
# Âm thanh dựng riêng (synth_audio.py theo mốc giờ app), không lấy từ bản quay.
set -euo pipefail
TS=${TS:?đặt TS = EXPO_PUBLIC_TIMESCALE của bản app đang quay}
OUT=${OUT:?đặt OUT}; SECS=${SECS:-32}; PRE=${PRE:-8}; APP=${APP:-dev.hoanghoa.pumpkincarve}
mkdir -p "$OUT"
RAW=${RAW:-}
if [[ -z "$RAW" ]]; then
  UDID=${UDID:?đặt UDID}
  RAW="$OUT/raw.mov"
  REAL=$(python3 -c "print(round($SECS / $TS + $PRE + 2, 1))")
  [[ -z "${NOLAUNCH:-}" ]] && { xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true; }
  rm -f "$RAW"
  # h264: encoder phần cứng, nhẹ hơn hevc mặc định
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$RAW" 2>"$OUT/rec.log" & REC=$!
  until grep -q "Recording started" "$OUT/rec.log" 2>/dev/null; do sleep 0.2; done
  [[ -z "${NOLAUNCH:-}" ]] && xcrun simctl launch "$UDID" "$APP" >/dev/null
  echo "quay $REAL s thật (TS=$TS)…"
  sleep "$REAL"; kill -INT $REC; wait $REC 2>/dev/null || true
fi

# 1. nén thời gian theo pts của container (giữ đúng nhịp app) → 120 fps CFR, khung gần nhất cho mỗi ô 1/120 s
ffmpeg -y -loglevel error -i "$RAW" -an -vf "setpts=PTS*$TS,fps=120" -r 120 \
  -c:v libx264 -preset slow -crf 12 -pix_fmt yuv420p -movflags +faststart "$OUT/screen-120.mp4"
# 2. bản 60 fps cho X: lấy khung chẵn của bản 120 (không trộn khung)
ffmpeg -y -loglevel error -i "$OUT/screen-120.mp4" -vf "select='not(mod(n\,2))',setpts=N/(60*TB)" -r 60 \
  -c:v libx264 -preset slow -crf 14 -pix_fmt yuv420p -movflags +faststart "$OUT/screen-60.mp4"

# 3. kiểm: mpdecimate (bỏ khung trùng, ngưỡng gần 0) → số khung khác nhau trong từng giây demo
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
  echo "120 fps (mục tiêu 120 mỗi giây): $(count "$OUT/screen-120.mp4")"
  echo "60 fps  (mục tiêu 60 mỗi giây):  $(count "$OUT/screen-60.mp4")"
  echo "(các giây đầu trước t=0 của app và màn đứng yên cuối clip sẽ thấp — bỏ qua)"
} | tee "$OUT/check.txt"
echo "→ $OUT/screen-120.mp4, $OUT/screen-60.mp4, $OUT/check.txt"
