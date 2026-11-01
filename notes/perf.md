# PERF — ghi chú của agent hiệu năng

Sim riêng: "Pumpkin Perf 17 Pro Max" (A68809D4-8A46-45D1-BF2B-46973F605A83), Metro 8095. Thí nghiệm trên file của người khác
làm trong bản sao sandbox (scratchpad), không đụng file thật.

## (18:45) Dựng promo nhanh — POLISH-1815 mục 5

**Đo, không đụng v4b:** `sample` tiến trình v4b đang chạy (chỉ đọc) + bản sao `promo.py` chạy 10–40 khung trong scratchpad.
Mọi số dưới đây đo khi v4b vẫn đang chiếm GPU, nên số tuyệt đối chậm hơn khi máy rảnh.

- Trên luồng chính, 60 % thời gian khung nằm trong `eevee::ShadowModule::shadow_update_finished → MTLStorageBuf::read → usleep`.
  Đó là CPU ngồi chờ GPU, tức là nút cổ chai là GPU, không phải CPU. Thêm 16 % là nén PNG tuần tự (deflate), 15 % compositor.
- Thử từng thứ (s/khung, cùng đoạn): gốc 2,1 (đoạn dơi) · tắt bóng 1,3 · + TAA 8 thay 16: **0,79** · tắt DOF/compositor thì
  nhanh thêm 20 % nhưng đổi hình nên không dùng · motion blur gần như miễn phí · TAA 6/4 không nhanh hơn 8.
- **Chất lượng** (PSNR / SSIM so với gốc, 10 khung mỗi đoạn): TAA 8 so với 16 ở đoạn dơi lao sát ống kính 69 dB / 0,99993, đoạn
  cận cảnh khắc (DOF) 70 dB / 0,99991. Bóng tắt so với bật 68 dB / 0,99998: cảnh gần như toàn Emission (nền, màn hình, chữ,
  kính), bóng chỉ rơi trên khung titan, nút và dơi. Mắt không phân biệt được.
- **Song song** (40 khung): 1 tiến trình 40 s, 2 → 25 s, 3 → 22 s, 4 → 21 s. Dùng 3. Ghép các đoạn bằng concat copy giống hệt bản
  1 tiến trình (PSNR 94 dB, phần lớn khung trùng tuyệt đối). Nhiễu F-curve và rng đều xác định, không phụ thuộc thứ tự.
- **Đĩa: chỉ còn 11–12 GB trống.** PNG ~3 MB/khung, nên 120 fps (4140 khung) cần 12,4 GB, sẽ đầy đĩa. Bản mới ghi thẳng H.264
  lossless từ Blender (0,8 MB/khung, 3,3 GB cho 4140 khung), không có PNG. `render/promo/frames` cũ đang chiếm 5,5 GB, xoá được
  nếu không cần.
- "Render mockup một lần rồi ghép ffmpeg" không làm: màn hình nằm dưới DOF, bloom, motion blur và phối cảnh của máy, ghép ngoài
  sẽ mất chất lượng.

**Áp dụng:**
```bash
patch -p1 < notes/perf/promo-fast.patch      # promo.py: PROMO_FAST=1 (tắt bóng + TAA 8), --range a,b, --video out.mp4 (H.264 lossless)
cp notes/perf/promo_par.sh tools/ && chmod +x tools/promo_par.sh     # gốc: /private/tmp/claude-501/-Users-hoanghoa-Documents-git-personal-repo/24833126-771f-42d8-a7cf-f9519fea1710/scratchpad/promo_par.sh
BEATS=blender/scripts/beats/v4.json SCREEN=render/promo/v4b/screen-120.mp4 FILM0=<như promo.sh dò> FPS=120 \
  FINAL=render/promo/pumpkin-carve-demo-120.mp4 tools/promo_par.sh       # WORKERS=3 mặc định; PROMO_FAST=0 = chất lượng gốc
#   → master 120 fps có tiếng + …-x60.mp4 (khung chẵn, không trộn khung). Thử MAXF=90 → 36 s, đủ khung, có tiếng.
```
`promo_par.sh` thay bước 5–6 của `promo.sh` (bước dò FILM0 giữ nguyên). Patch không đổi gì khi không bật cờ, nên v4b và các lần dựng
cũ vẫn ra y như trước.

**Số đo thật (18:32–18:38, lượt đầy đủ 4140 khung 120 fps, 3 tiến trình, GPU còn chia với 4 app sim khác):** mỗi tiến trình
1,18 khung/s, tức 3 tiến trình ≈ **212 khung/phút**. 120 fps (4140 khung) ≈ **19,5 phút**; 60 fps (2070 khung) ≈ **10 phút**.
Gốc là 37 khung/phút. Chạy dưới `tools/pauseall.sh` (dừng các sim khác) sẽ nhanh hơn. Lượt đo dừng giữa chừng vì agent chính bắt
đầu quay (`pauseall` đã STOP các tiến trình Blender của tôi), nên tôi huỷ để không tranh GPU; mọi file thử đã xoá.

Nếu cần dư thời gian cho 21:15: chạy `WORKERS=3 tools/pauseall.sh tools/promo_par.sh …`, đừng mở app trên các sim lúc dựng.

## (17:50) Quay 120 fps: quay chậm + nén thời gian — ĐÃ THỬ TRÊN SIM PERF, ĐẠT

**Script:** `/private/tmp/claude-501/-Users-hoanghoa-Documents-git-personal-repo/24833126-771f-42d8-a7cf-f9519fea1710/scratchpad/rec120.sh` (bản sao: `notes/perf/rec120.sh`) → agent chính đưa vào `tools/`.

```bash
# app phải được build/bundle với cùng EXPO_PUBLIC_TIMESCALE (Release: EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_TIMESCALE=0.25 npx expo run:ios --configuration Release …)
UDID=CA7F5A01-D288-47E0-9CED-0EFBED4178D1 TS=0.25 SECS=34 OUT=render/promo/v120 notes/perf/rec120.sh
#   → raw.mov (quay thật ~2,5 phút), screen-120.mp4 (setpts=PTS*TS, fps=120, CRF 12), screen-60.mp4 (khung chẵn của bản 120,
#     không trộn), check.txt (mpdecimate: số khung khác nhau mỗi giây demo)
TS=0.25 OUT=… RAW=có_sẵn.mov notes/perf/rec120.sh     # chỉ xử lý lại
```

**Kết quả thử** (debug + Metro sandbox = code thật 17:30 + patch dưới, TS=0.25, máy host đang quá tải — bản quay thời gian thật
đứng hình 53 %, 202 khoảng hở > 100 ms): master 33,9 s, **120 khung khác nhau ở mọi giây** (vài giây 119; cả clip chỉ 4 khung lặp
một ô 1/120 s), bản 60 fps **60/60 mọi giây**. Ảnh trích 2/6/12/18/24/30 s: `notes/perf/v120-test/strip.jpg`, số:
`notes/perf/v120-test/check.txt`. Tức là quay chậm xoá luôn khựng của simulator: mỗi khung có 4 lần thời gian để vẽ.

- TS = 0,5 vẫn được, nhưng bộ ghi simulator có jitter → vài ô 1/120 s trùng khung. 0,25 dư gấp đôi nên an toàn hơn.
- Đồng bộ âm thanh: `tools/sync.py` chạy trên `screen-120.mp4` (đã là giờ demo), nến bùng vẫn ở 20,107.
- `promo.sh`/`promo.py` hiện conform và dựng 60 fps → cần dựng ở 120 (`fps=120`, `-framerate 120`) cho master
  `render/promo/pumpkin-carve-demo-120.mp4`, rồi bản X lấy khung chẵn như `screen-60.mp4`.
- PerfHud: không bật `EXPO_PUBLIC_PERF` khi quay.

**Rà soát "mọi chuyển động đi qua đồng hồ demo"** (grep withTiming/withSpring/withDelay/withDecay/Date.now/setTimeout/
useFrameCallback/dt trong `app/src`):

| Chỗ | Trạng thái |
|---|---|
| Đồng hồ cảnh `time` (`PumpkinScene` frame callback × `TIMESCALE`) → shader (mưa, sương, lửa, sét), Particles, Bats, ImpactDust, Gust, Smoke, BlackCat, Match, IslandPill, jump.ts (vật lý theo dt của `time`), storm, demo script | ✓ (agent chính đã làm) |
| `lightUp` (porch/candle/flash/matchFade/burn/uiFade), `headerStyle`, `PoppedPiece` | ✓ đã bọc `ms()` / `spring()` |
| **`scene/clock.ts` `spring()`**: mặc định mass 1 / damping 10 / stiffness 100 (Reanimated 3) | ✗ **sai cả khi TIMESCALE = 1**: Reanimated 4.7 mặc định mass 4 / damping 120 / stiffness 900, nên `withSpring(1, {damping: 7, stiffness: 120})` cũ chạy với mass 4; giờ mass 1 → cú bùng nến dao động nhanh gấp 2, tắt chậm hơn. Sửa trong patch |
| **`fx/blowOut.ts` `extinguish`**: candle 240 ms, porch nhấp nháy 40/90/50/120/260 ms + `PORCH_BACK_MS` | ✗ chưa nhân hệ số (demo có thổi tắt theo kịch bản `demoBreath`) → bọc `ms()` trong patch |
| `fx/flameFollow.ts`: `dt = clamp(t − last, 1/240, 1/20)` | ✗ ở TS ≤ 0,25 trên 60 Hz dt thật = 1/240 → đúng biên; TS nhỏ hơn thì lò xo chạy nhanh hơn demo. Đổi cận dưới 1/2000 |
| `fx/Match.tsx`, `blowOut` gust: tích phân theo dt của `time` | ✓ (dt nhỏ hơn → mượt hơn, cùng hình) |
| Haptic `setTimeout` trong `onLit`, `batHaptics` | không ảnh hưởng hình (có thể bọc `ms()` cho đúng nhịp khi test tay) |
| Gesture (withDecay/withSpring khi kéo nhìn quanh, que diêm, reset) | chỉ chạy khi không DEMO — bỏ qua |
| Chờ `t0` (1600 ms trước t = 0) | thời gian thật, đúng ý (chờ shader) |

```bash
patch -p1 < notes/perf/timescale-fixes.patch     # scene/clock.ts (mặc định R4), fx/blowOut.ts (ms()), fx/flameFollow.ts (dt min)
```
(Đã thử trong sandbox ở trên; `tsc` sạch.)

## Release 17:01: đã hết log Atlas (0 dòng `non-invertible` cả demo). Đo video lúc 17:05 vô nghĩa vì 6 app PumpkinCarve chạy cùng lúc — xem "Quay simulator…" mục 2.

## (16:50) — Release khựng ở đảo → rơi → dơi: Atlas in cảnh báo mỗi sprite, mỗi frame

**Nguyên nhân.** `fx/pfx_atlas.ts` `useSpriteBuffers` (dùng bởi Particles, ImpactDust, Bats, Match) và `fx/Gust.tsx` "tắt" sprite
thừa bằng `RSXform(0, 0, 0, 0)`. Ma trận scale 0 không khả nghịch → Graphite `Device::drawAtlas` gọi
`SkLog("[skia] WARNING - Skipping draw with non-invertible/non-finite transform")` cho **từng sprite thừa, mỗi frame**, ghi ra stderr.

**Bằng chứng.**
- `xcrun simctl launch --console-pty` bản Release 16:13: **974 408 dòng cảnh báo trong 30 s** (~32 000/s). Bản debug code hiện tại
  (sandbox, có console): 1 589 590 dòng trong ~18 s demo. Sau khi sửa: **0**.
- `sample` Release, giờ app 13,5–18,5 (đảo/nhả/rơi): luồng render Skia 2696 mẫu trong `produce()`, **2457 mẫu (91 %) trong
  `SkLog → vfprintf → write`**. Tức là luồng render gần như chỉ để in log → bỏ frame. Đoạn dơi (Bats, 4 Atlas cỡ lớn) còn nặng hơn.
- Bản debug ít thấy vì stderr của nó được đệm (write = 0 mẫu), nên đo trên debug không lộ ra.

**Sửa (diff cho FX, 4 dòng logic):** sprite ẩn = scale 1e-3 (khả nghịch) đặt ngoài màn hình (−1e4); `put()` gặp scale ≈ 0/NaN thì
đẩy sprite ẩn alpha 0. Không đổi hình ảnh.

```bash
patch -p1 < notes/perf/atlas-hidden.patch      # app/src/fx/pfx_atlas.ts, app/src/fx/Gust.tsx
```

Kiểm sau khi build Release: `xcrun simctl launch --console-pty <udid> dev.hoanghoa.pumpkincarve | grep -c non-invertible` (Ctrl-C
sau ~20 s) phải ra 0. **Quy tắc cho mọi Atlas mới:** không bao giờ đặt RSXform (0,0,0,0); dùng `HIDDEN_XF`.

### Release 16:13 theo đoạn (trước khi sửa Atlas), đo bằng video quay

`% đứng hình` = tổng thời gian thiếu frame (khoảng hở − 16,7 ms) / độ dài đoạn. Đối chứng nền (Safari hoạt hình nhẹ cùng sim, cùng
lúc) ≈ 8 % — do máy host/bộ ghi.

| intro 0–3 | khắc | nhìn quanh | nhảy | đảo 13,8–16,6 | rơi 16,6–18,4 | que diêm | nến bùng | thắp | dơi |
|---|---|---|---|---|---|---|---|---|---|
| **32 %** (khựng 450 ms ngay t≈0) | 9 % | 8 % | 11 % | 11 % | **17 %** | 8 % | 17 % | 20 % | **36 %** |

**Intro (cho agent chính, `PumpkinScene.tsx`):** 2–3 lần khựng 400–450 ms trong ~0,8 s đầu sau t=0 = biên dịch pipeline shader lần
đầu (nền, bí, mưa, sương, Atlas…). Đề xuất: giữ đồng hồ đứng ở t=0 lâu hơn để các shader biên dịch xong trước khi intro chạy:

```diff
-    if (t0.value < 0) t0.set(timestamp + 120); // chờ thêm vài frame cho texture lên GPU
+    if (t0.value < 0) t0.set(timestamp + 700); // chờ shader biên dịch xong (Release khựng 400 ms ở 0,8 s đầu nếu chỉ chờ 120 ms)
```

Intro mới (màn gần đen 0–0,45 s rồi sét) che được phần còn lại; sẽ đo lại khi intro mới xong (FEEDBACK-1630 mục 3b).

## (17:20) Khựng lúc hiệu ứng xuất hiện lần đầu — bản quay 16:39 của agent chính

`notes/perf/fpscheck.sh 0 render/promo/raw.mov`, quy ra giờ app (nến bùng = 20,107): đứng hình intro 21 %, khắc 8 %, nhìn quanh 8 %,
nhảy 15 %, đảo 10 %, rơi 13 %, que diêm 9 %, **nến bùng 31 %**, thắp 15 %, dơi 18 % (nền nhiễu ≈ 8 %).

- Cặp khoảng hở ~80 ms đều đặn mỗi ~1,4 s suốt clip: có cả trong đối chứng Safari → do máy/bộ ghi, không phải app.
- Các cú 110–200 ms còn lại rơi đúng **lần đầu một hiệu ứng hiện ra**: 0,8–0,95 s và 1,6–1,7 s (sét mở màn, gió lá), 17,0 (bụi va
  chạm khi bí rơi), 20,8 (lửa/khói sau nến bùng), 22,6 (sét 2), 27,2 (dơi). Hai nguyên nhân thấy trong `sample` Release:
  1. **Ảnh sprite FX là raster** (`useImage` trong Bats, Particles, ImpactDust, Match, Smoke, Gust) → luồng render upload + dựng mipmap
     trên CPU ở frame đầu hiệu ứng hiện (sheet dơi 2048×3072 = 25 MB + mip). Sửa: `useGpuImage(SHEET, { mipmapped: true })`:
     ```bash
     patch -p1 < notes/perf/fx-gpu-sprites.patch     # 6 file FX, chỉ đổi dòng useImage + import; đã tsc + eslint
     ```
  2. **Biên dịch pipeline shader lần đầu** ngay trên luồng render (`PipelineManager::InlineCompile`, 121 ms trong 9 s đầu). Cách rẻ
     nếu còn thời gian: trong 1,6 s chờ trước t=0 (đã có trong DEMO), vẽ mỗi hiệu ứng một frame ở opacity 0,01 để Skia biên dịch sẵn.
     Chưa làm vì phải sửa nhiều file của FX; ưu tiên thấp hơn 1.

## Đo cho đúng: dùng video quay, không dùng fps trong app

Đồng hồ frame callback trong app (`PerfHud`, `[perf] ui=`) chỉ đo luồng UI. Skia vẽ trên thread pool riêng và **bỏ frame** khi
GPU/luồng render trễ, nên app có thể báo 60 fps trong khi màn hình đứng hình. Thước đo đúng cho clip là khoảng hở giữa các frame
trong bản quay simulator (simulator chỉ ghi khi màn hình đổi):

```bash
UDID=<sim> notes/perf/fpscheck.sh 36            # terminate + launch app rồi quay 36 s, in khoảng hở > 34/50/100 ms theo giây quay
UDID=<sim> notes/perf/fpscheck.sh 0 raw.mov     # phân tích bản quay có sẵn
```

Bản v3b đã đăng (`render/promo/v3b/raw.mov`): 77 khoảng hở > 50 ms, dồn từ ngay sau lúc nến bùng tới hết dơi (giây quay 23–32).
Cách đếm "số frame khác nhau mỗi giây" cũ bị thổi phồng vì 3 canvas trình bày lệch nhau vài ms → 2–3 frame ghi trong 1 vsync.

**Bước 3 (canvas chính 2x) — ĐÃ RÚT LẠI.** A/B bằng video quay cho kết quả trái ngược giữa các lần (máy host lúc load 10, lúc 100+),
không kết luận được; agent chính đã gỡ (16:31). Không áp `patch_scene_main.py`.

---

## TL;DR — 2 việc cần agent chính gộp (lớn nhất, làm trước khi quay) — ĐÃ GỘP 16:07; thêm bước 3 ở dưới

| # | Sửa | Ở đâu | Tác dụng đo được |
|---|-----|-------|------------------|
| 1 | Ảnh cảnh → **ảnh GPU** (`useGpuImage`, `toGpu`) | `PumpkinScene.tsx` (5 dòng) + `perf/gpu.ts` (đã có) | Luồng render Skia: 3,9 s CPU / 7 s → 0,7 s / 5 s; hết upload lại texture mỗi frame |
| 2 | **Sương (atmos) vẽ ở canvas riêng 1/3 mật độ điểm ảnh** | `PumpkinScene.tsx` | Bản atmos volumetric (15:27): toàn clip ~15 fps, khựng 1,2 s lúc nến bùng → ~50–60 fps (cùng lúc đo) |

Áp dụng (từ thư mục `pumpkin-carve/`):

```bash
patch -p1 < notes/perf/scene.patch                       # nếu PumpkinScene.tsx chưa đổi từ 16:00
# hoặc, bền hơn khi file đã đổi (thay theo chuỗi neo, báo lỗi nếu không thấy neo):
python3 notes/perf/patch_scene.py app/src/scene/PumpkinScene.tsx app/src/scene/PumpkinScene.tsx
cd app && npx tsc --noEmit && npx eslint src/scene/PumpkinScene.tsx
```

Không cần build native (chỉ JS). Đã typecheck + lint trên bản sandbox = file thật lúc 16:00 + patch.

### 1. Vì sao: cache texture 128 MB bị "đập" (thrash)

`useImage` trả ảnh raster (CPU). Graphite chỉ vẽ ảnh GPU nên RN Skia tự upload qua một cache chung, **giới hạn 128 MB**
(`node_modules/react-native-skia/cpp/rnskia/RNImageProvider.h`, `kDefaultBudgetInBytes`). Cảnh đang bind cùng lúc ~220 MB ảnh đã
giải nén (RGBA 8888):

| ảnh | kích thước | MB |
|-----|-----------|----|
| `bg_lit/dark/glow_pano.jpg`, `bg_depth_pano.png` | 3200×2400 ×4 | 123 |
| `bg_lit/dark/glow.jpg`, `shadow_lit/dark.png`, `bg_depth.png` | 1206×2622 ×6 | 76 |
| `lightMap` (drawAsImage) | ~1206×2622 | 13 |
| skin/interior/data, flesh, mask, blur | | ~13 |

→ LRU đẩy ra rồi upload lại hàng chục MB **mỗi frame**. `sample` (macOS) lúc khắc: 3479/7000 mẫu của luồng `RNSkia Render 3` nằm trong
`DawnContext::upload → TextureFormatXferFn::run → memmove`. Sau khi sửa: 0 mẫu upload.

`toGpu(img)` = `img.makeTextureImage()` (upload một lần trên JS thread lúc tải, ngoài cache, mọi canvas dùng chung không copy).
`useCarveMask.ts` đã dùng sẵn cho mask/blur (file của tôi). Patch đổi 16 `useImage` → `useGpuImage` và `setLightMap(toGpu(img))`.

### 2. Sương 1/3 mật độ

`atmos.ts` mới là ray-march thể tích: 11 mẫu/pixel × `lightAt` (khi nến sáng: 2× `through()` = 2 ellipsoid + 4 lần đọc mask), khói 3
vòng lặp, chạy trên **toàn màn hình 1320×2868 = 3,8 MP**. Sương và chùm sáng vốn mềm, nên vẽ nó ở canvas riêng nhỏ hơn 3 lần (440×956
px), phóng lại bằng transform của View (Core Animation, bilinear) → GPU làm ít hơn 9 lần cho lớp nặng nhất. Thứ tự lớp giữ nguyên bằng
3 canvas chồng nhau:

1. canvas chính (có GestureDetector): nền → bí → bụi → vỏ sụp/vụn/vệt dao → mưa → que diêm
2. canvas sương (View `width/3 × height/3`, `transformOrigin: "0 0"`, `scale: 3`, `pointerEvents="none"`), Group `fitTransform / 3`
3. canvas trên (pointerEvents none): dơi, màn đen, ngón tay ảo, IslandPill

Rung màn hình (`fitTransform`) chạy chung shared value nên 3 lớp rung khớp nhau. Đổi `ATMOS_DOWN` (1 = như cũ, 2, 3) để so.
Ảnh so sánh trái = full, phải = 1/3: `notes/perf/cmp-9.9.jpg` (sét), `cmp-21.5.jpg` (vừa thắp), `cmp-26.jpg` (dơi), cắt 1:1
`crop-21.5.jpg` (hai ảnh chụp lệch nhau vài frame nên khói/nghiêng hơi khác). Sương/chùm sáng nhìn như nhau; khác duy nhất: hạt film
(grain trong atmos) thô hơn 3 lần.

**Cho agent atmos (nếu còn sửa `atmos.ts`):** shader giờ chạy ở 1/3 mật độ, nên `fract(52.98…)` dither theo pixel sẽ to gấp 3 —
nếu thấy vân, đổi sang dither theo `xy * 3.0` hoặc bỏ. Hạt film (`grain`) cũng thô gấp 3 → nên chuyển grain sang lớp
full-res (vd. một `Fill` nhỏ trong canvas trên cùng) hoặc giảm biên độ. Đừng thêm mẫu ray-march vì lớp này rẻ rồi; ưu tiên giữ ≤ 11 mẫu.

## Bước 3 (ĐÃ RÚT LẠI, xem trên): canvas chính ở mật độ 2x

Bước 1+2 đã gộp (16:07). Bước 3 vẽ canvas chính (nền, bí, mưa, que diêm…) ở mật độ 1/1,5 = 2x thay vì 3x, phóng lại bằng transform
của View; canvas sương (1/3) và canvas trên cùng (dơi, IslandPill, ngón tay ảo — full res) giữ nguyên. Gesture chuyển sang một View
trong suốt phủ màn hình nằm trên các canvas, dưới UI → toạ độ vẫn là pt màn hình, logic gesture không đổi.

```bash
python3 notes/perf/patch_scene_main.py app/src/scene/PumpkinScene.tsx app/src/scene/PumpkinScene.tsx   # hoặc patch -p1 < notes/perf/scene_main.patch
```

- A/B liền nhau (cùng tải máy): `MAIN_DOWN = 1` → 33–44 fps; `1.5` → 43–58 fps (debug, sim 60 Hz).
- Ảnh 1:1 trên màn 3x (trái 3x, phải 2x): `notes/perf/main2x-crop-6.5.jpg`, `main2x-crop-21.5.jpg` — mềm hơn rất ít. Clip X đặt máy
  cao ~1300 px trong khung 1920×1440, tức ~45 % độ phân giải gốc → 2x (1912 px cao) vẫn dư, không nhìn ra khác biệt.
- Muốn quay nét tuyệt đối thì để `MAIN_DOWN = 1` (vẫn giữ được bước 1+2).

## Đo

- Overlay: `EXPO_PUBLIC_PERF=1` → `src/perf/PerfHud.tsx` (gắn trong `IslandPill.tsx`, ngoài Group của pill): đồ thị 120 frame
  (vạch 8,3 / 16,7 / 33 ms), `ui` fps = nhịp frame callback Reanimated (luồng Skia lấy shared value), `drop` = frame > 1,5× khoảng
  ngắn nhất, `js` = requestAnimationFrame trên JS thread. Mỗi 0,5 s in `[perf] t=<giờ app> ui=… uiMax=… drop=… js=… jsMax=…` ra
  console Metro → dễ map theo kịch bản demo.
- `EXPO_PUBLIC_PERF_RELOAD=http://localhost:8096/reload.txt`: app tự `DevSettings.reload()` khi nội dung URL đổi (để chạy lại demo
  từ đầu mà không cần bấm hộp "Open in…"). Chỉ khi PERF=1.
- Tắt hết khi không đặt biến (không ảnh hưởng bản quay).

### Kết quả (bản debug, sim 60 Hz, máy đang chạy 5–6 sim + render khác, load avg ~500 → số tuyệt đối nhiễu, xem tương đối)

fps trung bình theo đoạn kịch bản (min, frame dài nhất):

| bản | intro | khắc | nhìn quanh+sét | nhảy | đảo | que diêm | nến bùng | thắp+nghiêng | dơi |
|-----|-------|------|----------------|------|-----|----------|----------|--------------|-----|
| base1 (atmos cũ 28 tap, 14:50) | 46 | 42 | 52 | 51 | 54 | 50 | 42 (205 ms) | **16** | **15** |
| atmos cũ, tắt god rays | 40 | 44 | 58 | 54 | 37 | 35 | 29 | 46 | 37 |
| base2 (atmos volumetric 15:27) | 23 | **15** | **16** | **15** | 18 | 22 | **5 (1174 ms)** | 14 | 9 |
| + sương 1/3 | 57 | 35 | 48 | 42 | 44 | 52 | 56 | 51 | 54 |
| + sương 1/3 + ảnh GPU | 51 | 40 | 47 | 56 | 59 | 59 | 59 | 60 | 55 |

(3 dòng cuối đo cách nhau vài phút; sau đó máy tải nặng hơn nữa nên các lần A/B sau chỉ còn ~30 fps cả hai bản — dùng profiler thay fps.)

Chỗ khựng còn lại (debug): 0,1–0,5 s ngay khi một lỗ khắc xong (JS thread: vẽ mask CPU + `drawAsImage` ánh nến có readback +
React commit) và rải rác do máy host. Trên Release + máy rảnh cần đo lại (mục cuối).

## Thủ phạm đã xét

- **Shader nặng:** atmos (ở trên) ≫ mưa (8 lớp trụ + độ sâu) ≈ nền (`reproject` 4 lần đọc độ sâu + ~10 ảnh) > bí (chỉ ~15 % màn hình).
- **Vẽ lại mask:** chỉ khi danh sách lỗ đổi (useMemo) — ổn. Mask/blur giờ là ảnh GPU.
- **JS thread / re-render:** demo không re-render React mỗi frame (mọi thứ qua shared value). Re-render chỉ khi khắc xong / thắp.
  Worklet chiếm ~8 % main thread (ổn).
- **Ảnh lớn / decode:** decode ở `useImage` lúc mở app (trước t=0 vì đồng hồ chờ `ready`). Vấn đề thật là upload lại (mục 1).
- **Haptic / âm thanh:** `expo-haptics` gọi async qua `scheduleOnRN`, không thấy trong profile. Không có âm thanh trong app.
- **GC:** Hermes `hades` chạy song song, không thấy pause dài trong `sample`.
- **Main thread** giờ chủ yếu chờ GPU (`waitUntilScheduled` trong `presentRecordings`) → giới hạn còn lại là GPU của host.

## Quay simulator ít tốn tài nguyên nhất (cho agent chính)

1. Bản **Release** (JS bytecode Hermes, không dev-client/HMR/LogBox, worklet không kiểm tra debug):
   `cd app && EXPO_PUBLIC_DEMO=1 npx expo run:ios --configuration Release --device CA7F5A01-D288-47E0-9CED-0EFBED4178D1 --no-bundler`
   (KHÔNG đặt `EXPO_PUBLIC_PERF` — overlay sẽ lọt vào clip).
2. **Quan trọng nhất.** 17:05 có 7 sim Pumpkin bật và 6 tiến trình PumpkinCarve cùng vẽ cảnh nặng trên MỘT GPU + Blender
   `promo.py` → Release 17:01 quay trên sim Perf đứng hình ~70 % mọi đoạn (khoảng hở 400–800 ms), dù code đã sửa. Lúc quay, tạm dừng
   tất cả (kill -STOP, tự `-CONT` khi xong — `promo.sh` đã có sẵn `PAUSE_PATTERN`):
   ```bash
   PAUSE_PATTERN='Devices/(EA6AE9EA|0DCEAC26|8B860304|56130AAC|57B21943|A68809D4)[^ ]*/PumpkinCarve\.app/PumpkinCarve$|Blender|ffmpeg' \
     tools/promo.sh --beats blender/scripts/beats/v3.json
   ```
   (UDID = Atmos, Blow, Cat, FX, Light, Perf — mọi sim trừ "Pumpkin 17 Pro Max" CA7F5A01. Kiểm trước: `pgrep -fl "$PAUSE_PATTERN"`.)
   Quay xong chạy `UDID=CA7F5A01-D288-47E0-9CED-0EFBED4178D1 notes/perf/fpscheck.sh 0 render/promo/<bản>/raw.mov` — mục tiêu
   khoảng hở > 50 ms gần như 0 sau t=0.
3. `recordVideo --codec=h264` (đã dùng): encoder phần cứng, nhẹ hơn mặc định `hevc`. Không có tuỳ chọn fps/độ phân giải — simulator
   ghi theo frame thực (VFR); `promo.sh` đã conform `fps=60` theo pts. Đừng chạy ffmpeg chuyển mã song song lúc đang quay.
4. Có thể đóng/thu nhỏ cửa sổ Simulator.app: `simctl io recordVideo` đọc framebuffer của sim, không cần cửa sổ (đỡ WindowServer).
5. Kiểm tra trước khi dựng: `UDID=… tools/simrec.sh fps` hoặc `ffmpeg -i raw.mov -vf mpdecimate,showinfo -f null -` đếm frame khác
   nhau mỗi 0,5 s — mục tiêu ≥ 55 ở mọi đoạn.

## File tôi đã sửa / thêm

- `app/src/perf/PerfHud.tsx` (mới): overlay + log + reload từ xa, chỉ khi `EXPO_PUBLIC_PERF=1`.
- `app/src/perf/gpu.ts` (mới): `toGpu`, `useGpuImage`.
- `app/src/fx/IslandPill.tsx`: gắn `<PerfHud>` (khi PERF=1).
- `app/src/carve/useCarveMask.ts`: mask/blur → ảnh GPU.
- `notes/perf/patch_scene.py`, `notes/perf/scene.patch`: đề xuất cho `PumpkinScene.tsx` (bước 1+2, đã gộp).
- `notes/perf/patch_scene_main.py`, `notes/perf/scene_main.patch`: bước 3 (ĐÃ RÚT LẠI).
- `notes/perf/atlas-hidden.patch`: sửa log Atlas (FX: `pfx_atlas.ts`, `Gust.tsx`).
- `notes/perf/fpscheck.sh`: đo khoảng hở trong bản quay.
- `notes/perf/rec120.sh` (gốc ở scratchpad), `notes/perf/timescale-fixes.patch`, `notes/perf/v120-test/`: quay 120 fps.
- `notes/perf/fx-gpu-sprites.patch`: sprite FX → ảnh GPU có mipmap (`perf/gpu.ts` có thêm tham số `mipmapped`).
- `app/src/shaders/background.ts`, `pumpkin.ts`: bỏ đọc ảnh "lit" khi đèn hiên tắt hẳn, bỏ ảnh "dark" khi sáng hẳn và không sét (đã kiểm SkSL + ảnh chụp).
