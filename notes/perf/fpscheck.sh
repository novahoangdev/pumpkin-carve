#!/bin/bash
# Đếm số frame KHÁC NHAU mỗi 0,5 s trong bản quay simulator (đúng thứ sẽ lên clip), cho bản Release hoặc debug.
#   UDID=<sim> notes/perf/fpscheck.sh [giây=34]            # terminate + launch app (Release: JS nhúng sẵn) rồi quay
#   UDID=<sim> NOLAUNCH=1 notes/perf/fpscheck.sh 34         # chỉ quay (tự mở app / reload trong lúc đó)
#   UDID=<sim> notes/perf/fpscheck.sh 0 file.mov            # chỉ phân tích một bản quay có sẵn
# In: dòng "giây:fps" (số ô 1/60 s có hình mới, ×2) theo thời gian quay + các đoạn < 55 fps. Simulator hiển thị 60 Hz → 60 là trần.
# Lưu ý: cảnh đứng yên thật (không có gì chuyển động) cũng bị đếm là rớt frame; cảnh này luôn có mưa/sương nên không sao.
set -e
UDID=${UDID:?đặt UDID}; SECS=${1:-34}; APP=${APP:-dev.hoanghoa.pumpkincarve}
D=${TMPDIR:-/tmp}/pumpkin-fpscheck-$UDID; mkdir -p "$D"
MOV=${2:-$D/raw.mov}
if [ "$SECS" != 0 ]; then
  [ -z "$NOLAUNCH" ] && xcrun simctl terminate "$UDID" "$APP" 2>/dev/null || true
  xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$MOV" >/dev/null 2>&1 & REC=$!
  sleep 1.5
  [ -z "$NOLAUNCH" ] && xcrun simctl launch "$UDID" "$APP" >/dev/null
  sleep "$SECS"; kill -INT $REC; wait $REC 2>/dev/null || true
fi
# thời điểm (pts) từng frame của bản quay. Simulator chỉ ghi khi màn hình đổi (VFR) → khoảng hở giữa 2 frame = khựng thật.
# Đo trên ffprobe (không giải mã). Đối chứng: trang hoạt hình nhẹ trong Safari cùng sim → ~2 chỗ hở > 50 ms / 12 s.
ffprobe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 "$MOV" | tr -d ',' | python3 -c '
import sys
ts=sorted(float(x) for x in sys.stdin.read().split() if x)
if len(ts) < 2: sys.exit("không đọc được frame")
gaps=[(a, (b-a)*1000) for a,b in zip(ts,ts[1:]) if (b-a) > 0.034]
miss=sum(g-16.7 for _,g in gaps)
print(f"{len(ts)} frame / {ts[-1]:.1f} s; khoảng hở > 34 ms: {len(gaps)}, > 50 ms: {sum(1 for _,g in gaps if g>50)}, > 100 ms: {sum(1 for _,g in gaps if g>100)}; tổng thời gian đứng hình {miss/1000:.2f} s")
row=[]
for k in range(int(ts[-1]*2)+1):
  gs=[g for t,g in gaps if k/2 <= t < k/2+0.5]
  if gs: row.append(f"{k/2:.1f}s:{len(gs)}×max{max(gs):.0f}ms")
print("chỗ hở theo giây quay: " + " ".join(row))
'
