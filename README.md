# Pumpkin Carve: khắc bí ngô Halloween

Demo iPhone: lấy ngón tay khắc mặt quả bí ngô, kéo que diêm vào miệng bí để thắp nến. Ánh nến hắt qua đúng những
nét vừa khắc, thành tia sáng trong sương và in vệt sáng hình miệng cười lên thềm gỗ (tính đúng đường tia từ lòng bí qua
lỗ khắc); nghiêng máy là mắt đi vòng quanh quả bí, thấy vỏ dày, ngọn nến nằm giữa lòng bí và nền lệch theo chiều sâu;
kéo nền để nhìn quanh hiên nhà, chụm hai ngón để zoom; chạm vào bí cho nó nhảy, chạm dồn thì bí bay lên chui vào
Dynamic Island rồi bị nhả ra; trời mưa, sét loé sáng cả sân và chiếu xuyên lỗ khắc, mèo đen hiện trên lan can theo tia
chớp, mặt bí in bóng khổng lồ lên tường nhà; cuối cùng 390 con dơi ùa ra từ miệng bí xếp thành chữ HAPPY HALLOWEEN.
Mở app bằng một tia sét, camera cẩu từ trăng xuống, đèn hiên chập chờn, gió cuốn lá. Blender render sẵn các lớp 2.5D (nền, vỏ, lòng bí, normal) từ cùng một góc máy; app
React Native ghép chúng real-time bằng shader Skia v3, lỗ khắc là mask vẽ theo ngón tay, Reanimated giữ đồng hồ
120Hz, gyro và haptic. Thiết kế chi tiết: [PLAN.md](PLAN.md).

## Cấu trúc

```
blender/scripts/build_scene.py     dựng cảnh bằng code: quả bí (vỏ, thành trong, cuống, hạt, xơ), nến tealight, thềm,
                                   tường, cửa, đèn hiên, lan can, phông trời, camera dọc 1320×2868 (17 Pro Max)
blender/scripts/extras/porch_wide.py  cảnh mở rộng cho "nhìn quanh": trần, mái, máng xối, cột, tường + cửa sổ, lan can
                                   trái + bậc, sân, hàng rào, cây, nhà xa, một bầu trời toàn cảnh (world) có trăng
blender/scripts/render_passes.py   render các lớp → app/assets/scene/ (bg sáng/tối/ánh nến, bản toàn cảnh *_pano.jpg,
                                   bóng quả bí shadow_lit/dark.png, vỏ sáng/tối, lòng bí sáng/tắt, data = normal + vùng
                                   khắc được, thớ thịt bí, độ sâu bg_depth*.png, layout.json)
blender/scripts/check_pano.py      chiếu pano về khung gốc để so sai số + ảnh xem thử nhìn quanh → render/v3/
blender/scripts/synth_audio.py     tổng hợp tiếng (dao, vụn bí, que diêm, nến bùng, dơi, đêm) bằng numpy → render/audio/mix.wav
blender/scripts/promo.py           dựng clip 4:3 kiểu phone mockup để đăng X
blender/textures/                  bầu trời, vỏ bí, thịt bí, gỗ thềm, ván tường vẽ tay (sinh bằng Codex image gen)
tools/build.sh                     dựng cảnh + render lớp (PREVIEW=1: 50 %, ít sample)
tools/promo.sh                     quay simulator → render/promo/pumpkin-carve-demo.mp4
tools/sheet.sh                     ảnh xem nhanh 6 khung từ clip
app/                               Expo SDK 58 · react-native-skia 3.8 · Reanimated 4.7 · gesture-handler 3.3
```

Trong app:

```
src/scene/PumpkinScene.tsx   Canvas, các lớp, gesture (khắc, que diêm, nhìn quanh, zoom, chạm), thắp nến, chế độ demo
src/scene/view.ts            camera xem: xoay, zoom, mắt dịch theo đầu/nghiêng máy; quả bí là ellipsoid để chạm/chiếu
src/shaders/viewSksl.ts      SkSL chung: tia nhìn → ảnh camera gốc, dựng lại theo độ sâu, giao tia với quả bí
src/shaders/background.ts    nền sáng/tối, ánh nến lọt qua lỗ khắc lên thềm (vỏ dày chặn tia xiên), loé sét
src/shaders/pumpkin.ts       vỏ, thành vết cắt có độ dày, lòng bí và ngọn lửa đặt đúng vị trí 3D
src/shaders/rain.ts          mưa 3D (lớp trụ quanh mắt, che theo độ sâu, không mưa dưới mái), dòng nhỏ giọt mép mái,
                             gợn nước ngoài sân, tia sét trên trời
src/fx/storm.ts              lịch sét (demo: STRIKES), nhịp loé, hình tia sét
src/shaders/candleLight.ts   bake ánh nến qua lỗ khắc lên sàn + tường (nguồn diện tích trong lòng bí, bán ảnh thật)
src/shaders/lightningThrough.ts  sét chiếu xuyên lỗ khắc
src/fx/Gust.tsx, BlackCat.tsx  gió cuốn lá lúc mở app, mèo đen trên lan can
src/scene/clock.ts           hệ số thời gian (EXPO_PUBLIC_TIMESCALE) để quay chậm → clip 120 fps
src/perf/                    ảnh GPU (useGpuImage), overlay đo FPS (EXPO_PUBLIC_PERF=1)
src/shaders/atmos.ts         sương, tia sáng xuyên lỗ khắc, quầng đèn hiên, vignette, hạt film
src/carve/                   nét dao → lỗ khắc, mask offscreen + blur, mảnh vỏ sụp
src/fx/                      que diêm, dơi, vụn và hạt bí, tàn lửa, haptic
src/fx/jump.ts               bí nhảy (squash & stretch, combo), bay vào Dynamic Island (IslandPill), bụi va chạm (ImpactDust)
src/demo/script.ts           stencil (Classic, Spooky, Cat) và kịch bản demo
```

## Chạy

```bash
PREVIEW=1 tools/build.sh      # bản xem nhanh (~1 phút)
tools/build.sh                # bản final: 100 %, 128 sample (~6 phút)

cd app
npm install
npx expo run:ios --device     # dev build (Skia v3 không chạy trên Expo Go)
```

App mở bằng cú zoom từ xa vào quả bí. Vẽ một hình kín trên quả bí (đầu và cuối nét gần nhau) để đục lỗ, nét hở thành
rãnh mảnh. Kéo ở ngoài quả bí để nhìn quanh hiên (thả tay thì tự quay về), chụm hai ngón để zoom. Chạm vào bí để nó nhảy;
chạm liên tục cho nó nhảy cao dần rồi bay vào Dynamic Island. Nút Undo, Reset, và stencil để khắc
tự động. Kéo que diêm ở góc dưới phải vào miệng bí để thắp; vài giây sau dơi bay ra. Máy thật: nghiêng máy để thấy
thành vết cắt và lòng bí lệch theo góc nhìn.

Mỗi pixel: tia từ mắt (đã dịch vài cm so với camera Blender) → lặp 3 lần trên ảnh độ sâu để tìm điểm bề mặt → chiếu
về ảnh camera gốc, ngoài khung thì lấy panorama equirect (`bg_*_pano.jpg`) render cùng vị trí. Quả bí dùng ellipsoid
giải tích: chạm mặt ngoài → vỏ; đi tiếp qua bề dày vỏ → thành vết cắt; tới mặt trong phía sau → lòng bí; ngọn lửa là
billboard ở đúng toạ độ 3D. Không dịch mắt thì kết quả trùng homography cũ.

## Chỉnh nhanh

- Biên độ đi vòng quanh bí khi nghiêng máy: `ORBIT_X`, `ORBIT_Y` đầu `PumpkinScene.tsx`; độ lệch mắt khi quay đầu:
  `NECK_UP`, `NECK_FWD` trong `view.ts`.
- Nguồn sáng trong lòng bí hắt ra thềm: hàm `main` trong `src/shaders/background.ts`. Mật độ / độ sáng mưa: `rain.ts`.
- Thời điểm sét trong demo: `STRIKES` trong `src/fx/storm.ts` (tiếng sấm tự trễ theo khoảng cách).
- Màu thành vết cắt, lửa, độ ửng vỏ: `src/shaders/pumpkin.ts`. Sương, tia sáng: `src/shaders/atmos.ts`.
- Nét stencil và thời điểm trong demo: `src/demo/script.ts`.
- Bố cục cảnh, ánh sáng, vật liệu: `build_scene.py`, chạy lại `tools/build.sh` là app nhận ảnh và `layout.json` mới.

## Video trong repo

Repo chỉ giữ bản đăng và ảnh xem nhanh, còn lại trong `render/` (bản quay, segment, pass Blender) bị `.gitignore` bỏ qua vì dựng lại được:

- `render/promo/pumpkin-carve-final-v2.mp4`: bản final (60 fps, 4:3, máy đứng yên, Dynamic Island bí mini + BOO!, end card "Happy Halloween!").
- `render/promo/pumpkin-carve-final.mp4`: bản trước, dự phòng.
- `render/promo/pumpkin-carve-sheet-final*.jpg`: ảnh lưới khung hình để xem nhanh.
- `render/audio/mix_final.wav`: tiếng đã master (−14 LUFS).

Muốn lưu thêm video thì thêm một dòng `!render/promo/<tên>.mp4` vào `.gitignore` (file dưới 100 MB).

## Quay clip 120 fps

Màn Mac 60 Hz nên quay chậm rồi nén thời gian: build Release với `EXPO_PUBLIC_DEMO=1 EXPO_PUBLIC_TIMESCALE=0.25`, rồi

```bash
tools/pauseall.sh env UDID=<udid> TS=0.25 SECS=35 OUT=render/promo/v5 tools/rec120.sh   # → screen-120.mp4, screen-60.mp4, check.txt
BEATS=blender/scripts/beats/v5.json SCREEN=render/promo/v5/screen-120.mp4 FILM0=<t0> FPS=120 \
  FINAL=render/promo/pumpkin-carve-demo-120.mp4 tools/pauseall.sh tools/promo_par.sh   # → master 120 fps + bản X …-120-x60.mp4
```

`tools/pauseall.sh` tạm dừng mọi app trên simulator khác, ffmpeg và Blender trong lúc quay. `check.txt` phải đủ 120 / 60 khung khác
nhau mỗi giây. Mọi chuyển động trong app lấy từ đồng hồ `time` (đã nhân hệ số) hoặc `ms()` / `spring()` trong `scene/clock.ts`.

`promo_par.sh` dựng bằng 3 tiến trình Blender song song, ghi thẳng H.264 lossless (không PNG, ~0,8 MB/khung), khoảng 20 phút cho
bản 120 fps; xong thì xoá thư mục `render/promo/par_*`. `<t0>` = giây trong bản quay ứng với app t = 0: lấy khung đầu loé sáng của
sét (app 0.45 / 9.95 / 22.35) trừ đi mốc đó, hoặc `tools/sync.py` (nến bùng ở app 20.107).

## Quay clip demo (đăng X)

```bash
tools/build.sh
SYNTH_DUR=32.5 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/scripts/synth_audio.py
# simulator riêng của dự án: "Pumpkin 17 Pro Max" (iOS 27.0, 1320×2868 = 440×956 pt), UDID CA7F5A01-D288-47E0-9CED-0EFBED4178D1
cd app && EXPO_PUBLIC_DEMO=1 npx expo run:ios --configuration Release --device CA7F5A01-D288-47E0-9CED-0EFBED4178D1 --no-bundler && cd ..
tools/promo.sh --beats blender/scripts/beats/v3.json     # quay (mặc định trên sim trên) + dựng → render/promo/pumpkin-carve-demo.mp4
tools/sheet.sh render/promo/pumpkin-carve-demo.mp4 render/promo/pumpkin-carve-sheet.jpg blender/scripts/beats/v3.json
```

Dựng lại từ một bản quay có sẵn: `tools/promo.sh --beats blender/scripts/beats/v3.json --screen render/promo/v3b/screen.mp4`
(tự dò mốc nến bùng; thêm `PCT=50` để render nửa độ phân giải, `--stills 13.9,16.6,20.1` để xem nhanh vài khung).
Mọi mốc camera, chữ nền, màu nền, punch/shake, dơi 3D nằm trong beat sheet `blender/scripts/beats/v*.json`.
`synth_audio.py` đọc thời gian thẳng từ code app (`script.ts`, `jump.ts`, `Bats.tsx`…), `SYNTH_DUR` = độ dài tiếng.

`EXPO_PUBLIC_DEMO=1` cho app tự chạy đúng storyboard: zoom từ xa vào; ngón tay ảo khắc mắt, mũi, miệng; nhìn quanh hiên;
sét đánh khi đang nhìn ra sân; chạm cho bí nhảy rồi bay vào Dynamic Island; kéo que diêm; đèn hiên tắt, nến bùng;
nghiêng máy giả lập (đi vòng quanh bí), sét thứ hai; dơi ùa ra.
`EXPO_PUBLIC_STENCIL=spooky|cat` đổi mặt khắc trong demo.

`promo.sh` đặt status bar 9:41, quay simulator, đưa về 60fps đều theo pts,
dò khung nến bùng để đồng bộ (`tools/sync.py`: tăng sáng và giữ sáng, không nhầm với tia sét), rồi `promo.py` dựng clip 4:3 có iPhone khung titan, chữ lớn phía sau máy và end card.
