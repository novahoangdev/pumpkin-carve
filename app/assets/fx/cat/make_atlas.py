"""Black-cat sprite atlas for app/src/fx/BlackCat.tsx.

Input: raw/cat_{a,b,c}.png (Codex, black silhouette on white, 1024²).
Output: cat_atlas.png, grayscale (channel-order proof: iOS may hand the texture over as BGRA), 3 columns × 3 rows of CELL²:
  column = frame, row 0 = body alpha (without the tail), row 1 = tail alpha (bent in the shader), row 2 = eye glint mask.
Prints per-frame metadata (normalised 0..1 inside a cell) to paste into BlackCat.tsx.
Run: python make_atlas.py (needs pillow + numpy).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
CELL = 384


def segs(row):
    r = np.nonzero(row)[0]
    if not len(r):
        return []
    out, s, p = [], r[0], r[0]
    for x in r[1:]:
        if x - p > 3:
            out.append((s, p))
            s = x
        p = x
    out.append((s, p))
    return [o for o in out if o[1] - o[0] > 4]


def tail_region(body, kind):
    h, w = body.shape
    reg = np.zeros_like(body)
    if kind == "up":  # tail raised behind the back: right-most separate segment of each row above the rump
        ymax = {"a": 795, "c": 815}
        for y in range(h):
            if y > ymax[CUR]:
                break
            s = segs(body[y])
            if len(s) >= 2:
                for a, b in s[1:]:
                    if a > 600:
                        reg[y, a : b + 1] = True
    else:  # tail hanging below the sitting line
        reg[712:, :] = body[712:, :]
    img = Image.fromarray((reg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
    return np.asarray(img) > 127


FRAMES = [("a", "up"), ("b", "down"), ("c", "up")]
atlas = np.zeros((CELL * 3, CELL * len(FRAMES)), np.float32)
for i, (name, kind) in enumerate(FRAMES):
    CUR = name
    a = np.asarray(Image.open(os.path.join(HERE, "raw", f"cat_{name}.png")).convert("RGB")).astype(np.float32) / 255
    mn = a.min(-1)
    eye = np.clip(((a[..., 1] - a[..., 2]) - 0.25) / 0.2, 0, 1)
    alpha = np.maximum(np.clip((1 - mn - 0.04) / 0.9, 0, 1), eye)
    reg = tail_region(alpha > 0.5, kind)
    out = np.stack([alpha * (~reg), alpha * reg, eye], -1)
    small = Image.fromarray((out * 255).astype(np.uint8)).resize((CELL, CELL), Image.LANCZOS)
    sm = np.asarray(small).astype(np.float32) / 255
    for ch in range(3):
        atlas[ch * CELL : (ch + 1) * CELL, i * CELL : (i + 1) * CELL] = sm[..., ch]
    ey, ex = np.nonzero(eye > 0.5)
    print(name, "eye", ex.mean() / 1024, ey.mean() / 1024)
Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8), "L").save(os.path.join(HERE, "cat_atlas.png"), optimize=True)
print("saved", os.path.join(HERE, "cat_atlas.png"))
