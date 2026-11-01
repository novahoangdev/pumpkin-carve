#!/bin/bash
# Quick review sheet: run the current demo (debug app + main agent's demo Metro, port 8081) on the main sim, record,
# extract ~12 frames (left → right, top → bottom in time order; REUSE=1 reuses the previous recording) at the key times (app time) → render/preview/review-<HHMM>.png
#   TS=<Metro's EXPO_PUBLIC_TIMESCALE> (default 0.5) UDID=<sim> tools/review.sh [times…]
set -e
cd "$(dirname "$0")/.."
UDID=${UDID:-CA7F5A01-D288-47E0-9CED-0EFBED4178D1}; TS=${TS:-0.5}; PORT=${PORT:-8081}
D=/tmp/pumpkin-review; mkdir -p $D render/preview
TIMES=${*:-0.3 0.5 1.4 2.6 6.5 8.6 10.2 14 20.3 22.4 23.5 27}
LABELS="$TIMES"
URL="exp+pumpkin-carve://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$PORT&__expo_disable_onboarding=1&__expo_disable_fab=1"
if [ -z "$REUSE" ]; then
xcrun simctl terminate $UDID dev.hoanghoa.pumpkincarve 2>/dev/null || true; sleep 1
xcrun simctl io $UDID recordVideo --codec=h264 --force $D/raw.mov 2>$D/rec.log & REC=$!
until grep -q "Recording started" $D/rec.log 2>/dev/null; do sleep 0.2; done
xcrun simctl openurl $UDID "$URL"
sleep $(python3 -c "print(round(34 / $TS + 20))"); kill -INT $REC; wait $REC 2>/dev/null || true
ffmpeg -y -loglevel error -i $D/raw.mov -vf "setpts=$TS*PTS,fps=60,scale=440:-2" -an $D/s.mp4
fi
F0=$(ffmpeg -loglevel error -i $D/s.mp4 -vf "scale=64:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - \
  | awk '/pts_time/{split($0,a,"pts_time:"); t=a[2]+0} /YAVG/{split($0,b,"="); print t, b[2]+0}' | python3 tools/sync.py 20.107 | awk '{print $1-20.107}')
echo "app t=0 at second $F0 of the recording (compressed)"
rm -f $D/f_*.png; ins=(); i=0
for a in $TIMES; do
  ffmpeg -y -loglevel error -ss $(python3 -c "print(max(0,$F0+$a))") -i $D/s.mp4 -frames:v 1 \
    -vf "scale=300:-2" $D/f_$i.png
  ins+=(-i $D/f_$i.png); i=$((i + 1))
done
N=$i; H=$(( (N + 1) / 2 ))
OUTP=render/preview/review-$(date +%H%M).png
ffmpeg -y -loglevel error "${ins[@]}" -filter_complex "$(python3 -c "
n=$N; h=$H
a=''.join(f'[{i}]' for i in range(h)); b=''.join(f'[{i}]' for i in range(h, n))
pad='' if n%2==0 else f';color=c=black:s=300x652[pp]'
print(f'{a}hstack=inputs={h}[r1];' + (f'{b}hstack=inputs={n-h}[r2];[r1][r2]vstack' if n%2==0 else f'{b}[pp]hstack=inputs={n-h+1}[r2];[r1][r2]vstack'))")" $OUTP
echo "→ $OUTP"
