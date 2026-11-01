# Ghi chú của agent chính (đọc trước khi sửa)

Agent chính giữ: `app/src/scene/PumpkinScene.tsx`, `scene/layout.ts`, `scene/view.ts`, `demo/`, `blender/`, `tools/`, `PLAN.md`,
build native và quay clip. Muốn đổi gì ở các file này: ghi đề xuất (đoạn code, uniform mới, thứ tự vẽ) vào `notes/<tên>.md` rồi nhắn
session `personal-repo-63`. Đừng `git` gì cả (dự án chưa có repo).

## Yêu cầu mới của chủ dự án (14:33) và ai làm

- Logo app bị logo Goku → agent chính (đã thay icon native).
- Ẩn giờ/pin/sóng → agent chính (Info.plist UIStatusBarHidden + StatusBar hidden, cần build native).
- Cửa xấu, trống → Blender (xong: cửa mới, vòng hoa, kiện rơm, chậu cúc, ghế…).
- Vết khoét giả và thô → FX (`carve/PoppedPiece.tsx`, vệt dao trong PumpkinScene: gửi đề xuất cho agent chính). Âm thanh khắc không khớp,
  khó chịu → agent chính sửa `synth_audio.py` theo thời điểm FX chốt.
- Sấm chớp giả → ATMOS (`rain.ts`, `storm.ts`, độ loé trong background.ts là của PERF: nhắn nhau).
- Dynamic Island đẹp, tinh tế hơn → người giữ `IslandPill.tsx` / `jump*.ts` (PERF).
- Khói khi xoay góc ảo, không khớp ánh sáng và quả bí → ATMOS (`atmos.ts`).

## Khung màn mới: iPhone 17 Pro Max

`layout.json` view = 440×956 pt (1320×2868 px). Toạ độ cứng kiểu 402×874 trong file của bạn cần đổi:
x' = x·440/402, y' = 478 + (y − 437)·440/402 (cùng FOV, camera không đổi). Stencil demo đã nhân `K = VIEW.w / 402` (demo/script.ts).
Sim của agent chính: "Pumpkin 17 Pro Max" CA7F5A01-… (đừng dùng sim này).

## Chạy thử trên sim riêng

- App đã build sẵn: `~/Library/Developer/Xcode/DerivedData/PumpkinCarve-dsxgdjrrsillkcctbuofgtjxkhja/Build/Products/Debug-iphonesimulator/PumpkinCarve.app`
  → `xcrun simctl install <udid> <đường dẫn trên>`. Không cần build native: mọi thay đổi JS/TS/SkSL chạy qua Metro.
- Metro chế độ demo trên cổng riêng: `cd app && EXPO_PUBLIC_DEMO=1 npx expo start --port <cổng> --dev-client`
  (8081 là của agent chính — đừng dùng). Mở app: `exp+pumpkin-carve://expo-development-client/?url=http%3A%2F%2Flocalhost%3A<cổng>`.
- Quay + trích khung theo giờ app: `UDID=<udid> PORT=<cổng> tools/simrec.sh 42 "scale=300:-1" 3.5 10.0 20.6 25.5`
  → `render/preview/simrec-<udid>.png`. Đo FPS: `UDID=<udid> PORT=<cổng> tools/simrec.sh fps`.
- Kiểm tra SkSL biên dịch được mà không cần sim: xem cách làm trong `notes/main.md` mục "SkSL check" bên dưới.

## Kiến trúc hiện tại (sau đợt "3D thật")

- Camera xem = xoay + zoom + **mắt dịch** (`view.ts`): quay đầu → mắt dịch theo cung (NECK_UP/NECK_FWD); nghiêng máy → mắt đi vòng
  quanh bí (`ORBIT_X/Y` trong PumpkinScene, yaw/pitch bù để bí giữa khung). `Basis.e` = vị trí mắt (m).
- `viewSksl.ts`: `VIEW_SKSL` (uniform `eye`, `cam0`, `pc`, `pr`, `jW`… + `ellHit`, `pumpkinHitW`, `pumpkinXY`) và `DEPTH_SKSL`
  (`depthB`/`depthP` + `reproject()` lặp 3 lần trên ảnh độ sâu). Độ sâu: `bg_depth.png` / `bg_depth_pano.png`, v/255 = ln(d/0.25)/ln(800).
- Quả bí là ellipsoid giải tích: vỏ/normal/mask lấy tại hình chiếu của điểm chạm; thành vết cắt đi theo tia qua bề dày `SHELL`;
  lòng bí = mặt trong phía sau; ngọn lửa billboard tại `FLAME_W`.
- Ánh nến lên thềm: `candleLight.ts` tính **một lần mỗi khi mask đổi** (drawAsImage trong PumpkinScene → `lightMap`), nền chỉ tra.
- Mưa/sét: `rain.ts` (vẽ `plus` sau quả bí, trước que diêm), `fx/storm.ts` (STRIKES demo 9.95 / 22.35; `synth_audio.py` đọc để đặt sấm).
- Đom đóm đã bỏ (cuối tháng 10 + mưa thì không có).

## Mốc demo (giây app, `demo/script.ts`)

intro 0.3–2.9 · khắc 3.2/4.2/5.2/5.9 · nhìn quanh 7.5–11.1 (phải 8.4–8.9, trái 10.0–10.4) · sét 9.95 · chạm/nhảy 11.4–13.75 →
Dynamic Island ≈13.9, rơi lại ≈16.6 · que diêm 18.6 · tắt đèn 19.72 · nến bùng 20.107 · nghiêng 21.3–24.9 · sét 22.35 · dơi 24.9–29.6.

## Đã biết về hiệu năng (debug build, sim agent chính)

- Trước khi sửa: 32 fps khi nến sáng do `atmos.ts` gọi giao tia ellipsoid 28 lần/pixel → đã đổi sang affine gần đúng (`pAff`): ~60 fps.
- Ánh nến tính mỗi frame (5 nguồn × 2 ellipsoid × 2 mask) → đã chuyển sang `lightMap` cache.
- Còn khựng ngắn (~0,5 s rồi bắt kịp) ngay sau sét thứ 2 (≈22.4) và lúc dơi bắt đầu (≈24.9) trên bản debug — chưa rõ nguyên nhân
  (nghi GC trên UI thread do Bats tạo mảng mỗi frame, hoặc debug). Cần đo lại trên Release.

## SkSL check (không cần sim)

`canvaskit-wasm` có sẵn trong `app/node_modules`. Biên dịch shader TS sang CJS bằng
`npx tsc --ignoreConfig --outDir /tmp/x --module commonjs --target es2020 --skipLibCheck src/shaders/*.ts src/fx/storm.ts`, rồi chạy
node với một hook `Module._load` thay `react-native-skia` bằng `{ Skia: { RuntimeEffect: { Make: src => ck.RuntimeEffect.Make(src, err => console.log(err)) } } }`.
Lỗi uniform trùng tên / sai kiểu hiện ngay.

## Blender (agent chính)

Đang render bản cuối: độ sâu full-res, vệt ánh cửa sổ in xuống sàn, sàn/lan can ướt mép ngoài, bóng trăng rõ hơn, `bg_glow` = rọi từ
lòng bí (không bị bí che). layout.json có thêm `depth`, `flameW`, `glowSrc`, `shell`, `roof`, `floorEdge`. Assets trong
`app/assets/scene/` sẽ đổi khi render xong — không cần làm gì, Metro tự nạp.

## Việc còn mở cho FX (từ ATMOS, 16:20) — agent chính chờ trước khi quay bản cuối

- (B) `pfx_atlas.ts` `CX0 = 201`, `CY0 = 437` là tâm khung cũ 402×874 → khung 440×956 cần 220 / 478 (hoặc lấy từ `VIEW`): hạt lệch ~19/41 pt.
- (A) khói que diêm (`Match.tsx`) là sprite toạ độ màn hình sống ~3,5 s → đứng yên khi camera nghiêng sau lúc thắp. Neo 3D bằng
  `basis` (đã truyền `basis={basis}` vào `<Match>`), hoặc rút `SMOKE_LIFE` ≈ 0,9 s.

## Cho PERF (16:40, chủ dự án giao) — không nhắn được tab của bạn nên ghi ở đây

- Bước 3 (canvas 2x) đã GỠ theo tin của bạn; bước 1+2 giữ.
- Việc: kiểm đoạn Dynamic Island → nhả → rơi → nảy (giờ app 13.3–18.0) trên Release xem có khựng không (JumpTrail, IslandPill,
  ImpactDust lúc tiếp đất mạnh 16.667, drawAsImage lightMap…), sửa trong file của bạn. Bản Release 16:12 của agent chính đếm được
  60 khung khác nhau mỗi giây ở mọi giây 0–32 (khung "bí treo lơ lửng" tôi báo trước đó là bản debug bị Metro reload giữa chừng).
- Agent chính sắp đổi khung nghỉ (mắt hạ ~8 cm, `oy`) và intro 0–3 s trong PumpkinScene → `anchor` của jump có thể lệch nhẹ.

## Cho FX: Gust.tsx (intro mới)

Agent chính sẽ gắn `<Gust time={time} basis={basis} />` trong canvas chính, ngay sau `<Particles …/>` (trước mưa). Mốc gió:
`INTRO.gust` = 1.6 s trong `demo/script.ts` (import `INTRO` từ đó). Camera lúc đó đang cẩu xuống nhanh (xem `introView`).
Nhắn agent chính khi file có, hoặc nếu cần prop khác.

## 17:10 — trạng thái agent chính

- Đã gộp: PERF bước 1+2 (bước 3 đã gỡ), atlas-hidden.patch, warm-up `t0` (demo 1600 ms, app thật 700 ms), FX (basis, Gust 2 lớp,
  impacts), ATMOS (atmosDepth + depth children, rain không `plus`), intro mới + khung nghỉ (`REST`, `INTRO` trong demo/script.ts).
- Release 17:01 trên CA7F5A01, đo bằng `notes/perf/fpscheck.sh` khi dừng mọi app sim khác + ffmpeg + Blender (`tools/pauseall.sh`):
  4868 khung / 35,5 s, hở > 100 ms: 22 (chủ yếu ~80–100 ms lẻ tẻ; 2 chỗ hở dài ở 0–2 s là warm-up trước t=0).
- PERF: intro mới đã xong, có thể đo (Release của bạn cần build lại từ cây hiện tại).
- Chờ: LIGHT (sét xuyên lỗ khắc, bóng mặt bí trên tường), FX (dơi xếp chữ), CAT (mèo + lửa nghiêng). Gộp theo thứ tự: 3, 2, 1, 4, 5.

## 17:35 — đồng hồ chung + quay 120 fps (mọi tab đọc)

- `app/src/scene/clock.ts`: `TIMESCALE` (EXPO_PUBLIC_TIMESCALE), `ms(d)` cho withTiming/withDelay/setTimeout, `spring(cfg)` cho withSpring.
  Clip cuối quay ở TIMESCALE 0.5 → **mọi chuyển động phải lấy từ `time` của PumpkinScene** (đã nhân hệ số) hoặc đi qua `ms()`/`spring()`.
  Không dùng `Date.now()`/`performance.now()`/`timestamp` của useFrameCallback cho hình. Đã sửa: PumpkinScene, PoppedPiece (DUR → `ms`).
  BLOW: `fx/blowOut.ts` còn `withTiming(…, { duration: 240 … })` → bọc `ms()` trước khi gộp.
- `tools/promo.sh`: `TIMESCALE=0.5 FPS=120 PAUSE_ALL=1 tools/promo.sh --beats … --out …` → master 120 fps + `<out>-x60.mp4`.

## 18:15 — bản quay cuối đã chốt, đang dựng clip

- Bản quay cuối: `render/promo/v4b/` (Release, TIMESCALE 0.25, LIGHT v2, CAT A, ATMOS 7, FX dơi chữ, PERF sprite GPU), 120/120 khung mỗi giây.
  Mã nguồn đúng lúc quay: scratchpad `final-rec-src/`.
- Đang dựng bản X 60 fps (`render/promo/pumpkin-carve-demo-v4b.mp4`), sau đó master 120 fps. Blender dùng GPU → **các tab vui lòng tắt
  app trên sim của mình khi không cần** (sim chạy demo vòng lặp ăn GPU, làm render chậm ~30 %).
- Sau khi quay đã gộp vào app: BLOW (`notes/blow/patch.py`, cả `pumpkin.ts` của PERF) và CAT B (lửa theo ngón tay: pumpkin.ts, atmos.ts,
  background.ts, PumpkinScene; `ffFinger` tách ra để React Compiler không bỏ tối ưu). tsc + lint + SkSL sạch. Chưa build native
  expo-audio (BLOW bước 2).

## Đồng bộ bản quay (18:50)

`tools/sync.py` từng bắt nhầm sét thứ 2 (loé 1 khung +70) thay cho nến bùng ở v4d → FILM0 sai 2,25 s. Đã sửa: chỉ chấm điểm mức sáng
GIỮ trong 0,6–1,4 s sau khung so với trung bình 0,3 s trước. Kiểm chéo bằng sét: khung đầu loé sáng ở film = 9.95 + FILM0 và 22.35 + FILM0.
v4d: FILM0 = 0.85 (sét) / 0.843 (nến).

## 00:25 — Dynamic Island trả về bản cũ
Chủ dự án thích bản Dynamic Island trước (bí mini 3D lấp lánh + BOO!, đốm sáng quanh bí bay). `app/src/fx/IslandPill.tsx` đã khôi phục từ
bản gốc ISLAND lưu lúc 23:41; bản goo lưu ở `notes/island/IslandPill.goo.tsx`, `shaders/islandGoo.ts` không còn được dùng.
`<IslandPill>` trong PumpkinScene đã bỏ prop `anchor`. LIGHT: đang sửa PumpkinScene thì giữ dòng này.
