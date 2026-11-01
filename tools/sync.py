#!/usr/bin/env python3
"""Dò khung nến bùng trong bản quay: đọc "t y" (giây, độ sáng trung bình) từ stdin, in "t điểm".
Nến bùng = độ sáng tăng vọt rồi GIỮ sáng (đèn hiên đã tắt nhưng nến cháy tiếp); tia sét cũng loé mạnh
nhưng tắt trong < 1 s, nên chấm điểm CHỈ bằng mức tăng nhỏ nhất trong 0,6–1,4 s sau khung so với trung bình 0,3 s
trước nó (không cộng bước nhảy một khung: sét loé 1 khung +70 từng thắng nến bùng ở v4d)."""
import sys
t0 = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0
rows = [tuple(map(float, l.split())) for l in sys.stdin if l.strip()]
ts = [r[0] for r in rows]; ys = [r[1] for r in rows]
best, score = 0.0, -1e9
for i in range(1, len(rows)):
    if ts[i] < t0: continue
    later = [ys[j] for j in range(i, len(rows)) if 0.6 <= ts[j] - ts[i] <= 1.4]
    if not later: break
    before = [ys[j] for j in range(max(0, i - 40), i) if 0 < ts[i] - ts[j] <= 0.3] or [ys[i - 1]]
    s = min(later) - sum(before) / len(before)
    if s > score: best, score = ts[i], s
print(f"{best:.3f} {score:.1f}")
