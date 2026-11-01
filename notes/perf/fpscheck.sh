#!/bin/bash
# Counts DISTINCT frames per 0.5 s in a simulator recording (exactly what ends up in the clip), for Release or debug builds.
#   UDID=<sim> notes/perf/fpscheck.sh [secs=34]            # terminate + launch app (Release: JS bundled) then record
#   UDID=<sim> NOLAUNCH=1 notes/perf/fpscheck.sh 34         # record only (open / reload the app yourself meanwhile)
#   UDID=<sim> notes/perf/fpscheck.sh 0 file.mov            # only analyse an existing recording
# Prints: "sec:fps" lines (number of 1/60 s slots with a new image, ×2) over recording time + the stretches < 55 fps. Simulator displays 60 Hz → 60 is the ceiling.
# Note: a truly still scene (nothing moving) also counts as dropped frames; this scene always has rain/fog so it's fine.
set -e
UDID=${UDID:?set UDID}; SECS=${1:-34}; APP=${APP:-dev.hoanghoa.pumpkincarve}
D=${TMPDIR:-/tmp}/pumpkin-fpscheck-$UDID; mkdir -p "$D"
MOV=${2:-$D/raw.mov}
if [ "$SECS" != 0 ]; then
  [ -z "$NOLAUNCH" ] && xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$MOV" >/dev/null 2>&1 & REC=$!
  sleep 1.5
  [ -z "$NOLAUNCH" ] && xcrun simctl launch "$UDID" "$APP" >/dev/null
  sleep "$SECS"; kill -INT $REC; wait $REC 2>/dev/null || true
fi
# timestamp (pts) of each frame of the recording. Simulator only writes when the screen changes (VFR) → gap between 2 frames = real stutter.
# Measured with ffprobe (no decoding). Control: a light animation page in Safari on the same sim → ~2 gaps > 50 ms / 12 s.
ffprobe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 "$MOV" | tr -d ',' | python3 -c '
import sys
ts=sorted(float(x) for x in sys.stdin.read().split() if x)
if len(ts) < 2: sys.exit("could not read frames")
gaps=[(a, (b-a)*1000) for a,b in zip(ts,ts[1:]) if (b-a) > 0.034]
miss=sum(g-16.7 for _,g in gaps)
print(f"{len(ts)} frame / {ts[-1]:.1f} s; gaps > 34 ms: {len(gaps)}, > 50 ms: {sum(1 for _,g in gaps if g>50)}, > 100 ms: {sum(1 for _,g in gaps if g>100)}; total frozen time {miss/1000:.2f} s")
row=[]
for k in range(int(ts[-1]*2)+1):
  gs=[g for t,g in gaps if k/2 <= t < k/2+0.5]
  if gs: row.append(f"{k/2:.1f}s:{len(gs)}×max{max(gs):.0f}ms")
print("gaps per recording second: " + " ".join(row))
'
