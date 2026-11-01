#!/bin/bash
# Quay app demo trên simulator (bản debug, Metro demo) và trích khung theo GIỜ APP, hoặc đo FPS.
#   UDID=<sim> PORT=8081 tools/simrec.sh <giây quay|0 = dùng lại bản quay trước> "<filter ffmpeg, vd crop=..,scale=..>" t1 t2 ...
#     → render/preview/simrec-$UDID.png (các khung ghép ngang)
#   UDID=<sim> PORT=8081 tools/simrec.sh fps   → số khung khác nhau mỗi 0,5 s (giây quay 4–34)
# Mốc: app t=0 dò bằng tools/sync.py (nến bùng ở app t=20.107). Bản debug có thể khựng — đo mượt thật bằng Release.
set -e
cd "$(dirname "$0")/.."
UDID=${UDID:?đặt UDID của simulator}; PORT=${PORT:-8081}
D=/tmp/pumpkin-simrec-$UDID; mkdir -p $D render/preview
URL="exp+pumpkin-carve://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$PORT&__expo_disable_onboarding=1&__expo_disable_fab=1"
record() {
  xcrun simctl terminate $UDID dev.hoanghoa.pumpkincarve 2>/dev/null || true; sleep 1
  xcrun simctl io $UDID recordVideo --codec=h264 --force $D/raw.mov >/dev/null 2>&1 & REC=$!
  sleep 1; xcrun simctl openurl $UDID "$URL"
  sleep $1; kill -INT $REC; wait $REC 2>/dev/null || true
}
if [ "$1" = fps ]; then
  record 35
  for s in $(seq 4 0.5 34); do
    n=$(ffmpeg -hide_banner -ss $s -t 0.5 -i $D/raw.mov -vf "mpdecimate=hi=1:lo=1:frac=0,showinfo" -f null - 2>&1 | grep -c "Parsed_showinfo.*n:" || true)
    printf "%s:%s " $s $((n * 2))
  done; echo; exit 0
fi
SECS=$1; shift; FILTER=$1; shift
if [ "$SECS" != 0 ]; then
  record $SECS
  ffmpeg -y -loglevel error -i $D/raw.mov -vf "fps=60,scale=804:1748" -c:v libx264 -crf 16 -pix_fmt yuv420p -an $D/s.mp4
  ffmpeg -loglevel error -i $D/s.mp4 -vf "scale=64:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - \
    | awk '/pts_time/{split($0,a,"pts_time:"); t=a[2]+0} /YAVG/{split($0,b,"="); print t, b[2]+0}' \
    | python3 tools/sync.py 20.107 | awk '{print $1-20.107}' > $D/f0.txt
fi
F0=$(cat $D/f0.txt); echo "app t=0 ở giây $F0 của bản quay ($D/s.mp4)"
rm -f $D/f_*.png; i=0; ins=()
for a in "$@"; do
  ffmpeg -y -loglevel error -ss $(python3 -c "print(max(0,$F0+$a))") -i $D/s.mp4 -frames:v 1 -vf "${FILTER:-scale=402:-1}" $D/f_$i.png
  ins+=(-i $D/f_$i.png); i=$((i + 1))
done
[ $i -gt 0 ] && ffmpeg -y -loglevel error "${ins[@]}" -filter_complex "hstack=inputs=$i" render/preview/simrec-$UDID.png && echo "→ render/preview/simrec-$UDID.png"
