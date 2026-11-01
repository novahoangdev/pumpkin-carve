#!/usr/bin/env python3
"""Find the candle-burst frame in a recording: reads "t y" (seconds, mean brightness) from stdin, prints "t score".
Candle burst = brightness jumps and STAYS bright (porch light is off but the candle keeps burning); lightning also flashes hard
but dies within < 1 s, so score ONLY by the smallest rise over 0.6–1.4 s after the frame versus the mean of the 0.3 s
before it (no single-frame jump term: a 1-frame +70 lightning flash once beat the candle burst in v4d)."""
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
