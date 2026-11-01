# FX — ghi chú của agent FX

Sim riêng: "Pumpkin FX 17 Pro Max" (56130AAC-A641-4D99-843D-A1A6B78A9289), Metro 8093 chạy từ một **bản sao** app trong scratchpad
(không làm reload sim của agent chính khi đang sửa dở). File FX chỉ được chép sang dự án thật khi đã typecheck + lint + xem trên sim.

Feedback cần giải quyết: "mấy cái hạt khi quay các góc màn khác và các con bay ra đang xấu và giả quá".

## Cần agent chính gộp (3 dòng trong `PumpkinScene.tsx`)

`notes/fx/scene.diff` (hoặc chạy `python3 notes/fx/patch_scene.py app/src/scene/PumpkinScene.tsx`, vá theo chuỗi neo):

1. `<Particles … basis={basis} />` và **đưa ra NGOÀI** `<Group transform={pumpkinTransform}>` (đặt ngay sau nhóm đó, trước lớp mưa).
2. `<ImpactDust … basis={basis} />`
3. `<Match … basis={basis} />` (que diêm nằm trên thềm theo 3D, xem mục 4)

**Đã gộp (16:20).**

Chưa gộp thì vẫn chạy: không có `basis`, Particles / ImpactDust chiếu bằng camera gốc (Particles vẫn trong nhóm
`pumpkinTransform` như cũ) → vụn rơi đúng mặt thềm khi camera đứng yên, nhưng chưa có parallax khi nhìn quanh / nghiêng.
**Lưu ý:** nếu truyền `basis` mà vẫn để Particles trong nhóm `pumpkinTransform` thì bị biến đổi hai lần.

## 1. Vụn thịt bí, hạt bí, xơ, giọt nước bí — `app/src/fx/Particles.tsx`, `pfx_atlas.ts` (16:10)

Trước: vụn bay trong toạ độ ảnh 2D dính theo quả bí, "sàn" ảo nằm ngang mặt bí (vụn nảy giữa không trung), màu vàng chói không ăn ánh
sáng cảnh, quay góc nhìn thì trôi như sticker. Ảnh trước/sau: chụp trên sim FX (vụn trước nằm lơ lửng giữa mặt bí, sau nằm trên thềm
trước chân bí).

Giờ:
- Sống trong **không gian cảnh (mét)**: điểm sinh = mép lỗ khắc chiếu lên ellipsoid quả bí (`pumpkinWorld`), vận tốc theo pháp tuyến
  mặt bí + toả khỏi tâm lỗ + hất lên. Mỗi frame chiếu qua camera xem (`proj(basis, …)`) → nhìn quanh / nghiêng máy / zoom thì vụn nằm
  đúng chỗ trên thềm (parallax thật), to nhỏ theo độ sâu, bị quả bí che khi ở phía sau (`behindPumpkin`).
- Vật lý giải tích (`fall` trong `pfx_atlas.ts`): trọng lực 7,6 m/s², nảy trên mặt thềm z = 0 với hệ số nảy riêng (hạt bí 0,42, thịt bí
  ướt 0,2 dính sàn, xơ gần như không nảy), mất vận tốc ngang mỗi lần nảy, trượt có ma sát rồi nằm yên. Không có trạng thái.
- Cỡ thật: vụn 5–16 mm, hạt bí 13–17 mm, xơ 2–3 cm, giọt nước 2–3 mm.
- Hạt bí có hướng 3D (pháp tuyến + trục dài) quay quanh trục riêng; nằm trên thềm thì bẹp xuống → elip mỏng đúng phối cảnh mặt sàn.
- Vụn nằm lại 6 s rồi mới mờ (vụn thật không tự biến mất), **vệt ướt** sẫm dưới chỗ vụn / giọt nước đáp, khô dần; lấp lánh ướt.
- Ánh sáng: hướng đèn tính bằng cách chiếu nguồn sáng thật (đèn hiên `LANTERN_W` ≈ (−0,08; 1,35; 1,29) m trước khi thắp, ngọn nến
  `FLAME_W` sau khi thắp) lên màn hình; độ sáng tối hơn bản cũ cho khớp đêm.
- Tàn lửa sau khi thắp cũng chuyển sang 3D (bốc lên từ lỗ khắc theo mét).

**Cho `synth_audio.py`:** phần tiếng vụn rơi (port từ Particles cũ, dòng ~466) giờ lệch thời điểm chạm sàn. Muốn khớp thì port hàm
`fall` (thuần toán, không phụ thuộc gì) với cùng `hash`/tham số trong `Particles.tsx`.

## 2. Bụi + lá khi bí đáp — `app/src/fx/ImpactDust.tsx` (16:10)

Chuyển sang mét quanh chân bí (`PUMPKIN_FOOT_W`, độ lệch ngang của cú đáp đổi từ pt ra m): cụm bụi toả theo mặt thềm ra trước và
hai bên (phía sau bị bí che), sạn nảy bằng `fall`, lá rơi có cản gió rồi nằm bẹp — góc lật tính từ góc nhìn thật xuống mặt sàn, gân lá
chiếu đúng phối cảnh; vòng sóng là vòng tròn trên mặt thềm chiếu qua camera (elip đúng phối cảnh khi nhìn nghiêng).

## 3. Dơi — `app/src/fx/Bats.tsx`, `app/assets/fx/pfx_bat.png`, `blender/fx/bat_sheet.py` (16:10)

Trước: path vector phẳng một màu. Giờ là sprite **Blender headless** (`blender/fx/bat_sheet.py`, ~3 phút CPU, file `blender/fx/bat.blend`):
- Dơi dựng đúng hình học cánh của Bats.tsx: màng da mỏng có vân + mạch máu (translucent), xương ngón/cánh tay, thân lông (sheen), đầu,
  tai, mõm, mắt, chân, màng đuôi. Cánh vỗ bằng shape key cùng công thức `ang`/`fold` của app.
- 24 hướng nhìn (8 phương vị × 3 độ cao) × 8 pha vỗ, **motion blur thật của Cycles** (màn trập 1/12 chu kỳ).
- Pass A: trăng ngược sáng (viền lạnh) — dơi vẫn là bóng tối trên nền trời. Pass B (vẽ `plus`): **rim + màng cánh trong mờ đỏ cam**
  khi ngược ánh nến, app tô theo khoảng cách tới nến (sáng khi vừa chui ra, tắt dần khi bay xa).
- App chọn ô theo hướng mắt trong hệ thân dơi (đúng khi dơi bay lên, nghiêng cánh, hay người xem nhìn quanh), xoay sprite theo vector
  "lên" của ô chiếu ra màn hình; motion blur tịnh tiến (2–3 bóng mờ dọc quãng đường 1 frame); con sượt sát ống kính vẽ ở lớp blur 5.
- Quỹ đạo, `BAT_COUNT`, `BAT_DURATION`, công thức `delay` giữ nguyên → `synth_audio.py` không cần đổi.
- Sheet 2048×3072 (3,2 MB PNG, ~25 MB GPU). Nướng lại: `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup
  --python blender/fx/bat_sheet.py -- --cell 128 --samples 24`.

## 4. Que diêm nằm trên thềm — `app/src/fx/Match.tsx` (16:25)

Trước: nhìn quanh hiên thì que diêm đứng im ở góc màn hình như sticker. Giờ chỗ nằm yên (`MATCH_REST`) được chiếu từ ảnh gốc xuống
mặt thềm (m) rồi chiếu lại qua camera xem → nằm yên trên ván sàn, đúng vị trí / góc / cỡ khi nhìn quanh, nghiêng, zoom (cả bóng).
Cầm lên thì theo ngón tay như cũ (độ lệch so với chỗ nằm), xa chỗ nằm > 60 pt thì về cỡ/góc màn hình.
**Lưu ý cho PumpkinScene:** vùng chạm để nhặt que diêm vẫn tính quanh `MATCH_REST` (pt màn hình). Camera đứng yên thì trùng khớp; đang
nhìn lệch hẳn sang bên thì que diêm hiện ở chỗ khác vùng chạm. Demo không bị (nhặt que lúc camera đã về giữa).

## 5. Mảnh vỏ sụp — `app/src/carve/PoppedPiece.tsx` (16:30)

Miếng vỏ khựng một nhịp rồi **ngả ra sau quanh mép dưới bằng xoay 3D có phối cảnh** (`perspective` + `rotateX`), lộ mặt cắt thịt bí
vàng ướt ở mép trên (đúng bề dày vỏ), mặt vỏ tối dần vào bóng lòng bí, rồi tụt xuống và khuất sau mép dưới của lỗ (mọi lớp cắt theo
hình lỗ, không lòi ra ngoài). 560 ms (cũ 480 ms).

## Hiệu năng (đo 16:50)

`PerfHud` (UI thread fps, log `[perf]`) gắn tạm trên bản sao, sim FX, bản debug, cùng lúc máy đang render Blender. Đo xen kẽ FX bật /
tắt (tắt = bỏ Particles, ImpactDust, Bats):

| | khắc 3–8 s | nhảy 11–17 s | dơi 24,9–30 s |
|---|---|---|---|
| FX bật (lần 1) | 57 fps, max 35 ms | 60 fps | 60 fps |
| FX tắt | 57 fps, max 47 ms | 60 fps | 60 fps |
| FX bật (lần 2) | 57 fps, max 40 ms | 60 fps | 59 fps, max 38 ms |

Đã tối ưu trước khi đo: điểm sinh vụn (giao tia–ellipsoid) cache theo burst thay vì tính mỗi frame; hướng đèn chiếu một lần mỗi frame;
dơi sát ống kính bỏ lớp blur offscreen (sprite 128 px phóng ~10× đã đủ nhoè). Dơi giờ là 4 Atlas, không dựng SkPath mỗi frame.
Không có shader mới.

## Cách xem

Bản dev hiện có + Metro: mọi thay đổi là JS + PNG, Metro tự nạp. Mốc demo: vụn 3,3–12 s (nằm trên thềm suốt đoạn nhìn quanh 7,5–11 s, que diêm cũng nằm theo thềm),
bụi/lá 11,4–13,7 s và 16,6 s, dơi 24,9–29 s.

## Agent chính sửa (16:30, chủ dự án đồng ý)

- `pfx_atlas.ts`: `CX0, CY0` = `VIEW.w / 2, VIEW.h / 2` (trước là 201/437 của khung 402×874 → lệch 19/41 pt trên Pro Max).

## 6. Gió cuốn lá phong ở intro — `app/src/fx/Gust.tsx`, `app/assets/fx/pfx_leaf_fg.png` (17:05, FEEDBACK-1630 mục 3b)

**Cách gắn (4 dòng, `notes/fx/scene-gust.diff`, hoặc `python3 notes/fx/patch_scene.py app/src/scene/PumpkinScene.tsx`):**

```tsx
import { Gust } from "../fx/Gust";
// canvas chính, ngay sau <Particles …/> (sau quả bí, trước mưa): lá trung cảnh + lá nằm trên sàn
<Gust layer="scene" time={time} basis={basis} />
// canvas trên sương (cùng chỗ <Bats>), vẽ trước <Bats>: lá tiền cảnh sát ống kính, đè lên sương
<Gust layer="fg" time={time} basis={basis} />
```

Props: `time` (đồng hồ cảnh), `basis` (camera xem), `at` = thời điểm cơn gió (mặc định **1,6 s**; `at={-1}` để tắt, ví dụ ngoài
DEMO nếu không muốn), `layer`.

- Tiền cảnh: 9 lá phong to (8,5–13,5 cm) bay ngang trái → phải cách mắt 0,25–0,6 m, lật + xoay, nhoè ngoài nét (sheet lá thu nhỏ ½ +
  blur sẵn, 32 px/ô phóng ~10× → rất mềm, không cần lớp blur), motion blur 2 bóng mờ dọc quãng đường 1/60 s. Toạ độ mét cố định trong
  cảnh quanh vị trí camera → camera cẩu xuống thì parallax rất mạnh. Cơn gió kéo dài ≈ 1 s từ `at`.
- Trung cảnh: 9 lá cuốn ngang qua hiên (0,8–2,5 m), sắc nét, bị quả bí che khi bay sau nó.
- Sàn: 6 lá nằm sẵn trên ván thềm quanh quả bí (luôn hiện, như lá rụng); gió tới thì trượt 12–42 cm theo hướng gió, nảy + vài lá lật
  mặt, có bóng tiếp xúc, rồi nằm lại.
- **Không tạo object / mảng nào mỗi frame**: mỗi sprite tính thẳng trong callback `useRSXformBuffer` / `useRectBuffer` /
  `useColorBuffer` (ghi tại chỗ), mảng nháp cấp phát một lần khi mount. Lớp không vẽ giữ 1 sprite và không đọc `time`. 2 draw call tổng.
- Đường bay đang canh theo intro hiện tại (camera ở khung nghỉ). Khi intro cẩu máy mới xong, muốn lá đi qua chỗ khác thì chỉnh trong
  `fgLeaf` (x/y/z theo mét quanh `CAM.pos`).

## 7. Việc còn mở từ `main.md` (17:05)

- (B) `CX0/CY0` lấy từ `VIEW`: agent chính đã sửa trong `pfx_atlas.ts`, tôi giữ nguyên.
- (A) **Khói que diêm neo 3D**: lúc lửa tắt, điểm đầu diêm trên màn hình được chiếu ngược lên mặt quả bí (m, `screenToPumpkinWorld`),
  khói bốc lên theo mét và chiếu qua `basis` mỗi frame → camera nghiêng sau lúc thắp thì khói đứng đúng chỗ trên miệng bí. Giữ nguyên
  thời lượng / dáng khói cũ.

## 8. Vụn nằm lại + nảy khi bí đáp — `Particles.tsx` (17:05)

- Vụn không mờ đi sau 6 s nữa: nằm lại trên thềm tới ~73 s (vụn thật không tự biến mất) → lúc nến sáng vẫn còn đống vụn trước chân
  bí, ửng ánh nến. Vệt ướt vẫn khô dần trong ~10 s.
- Thêm prop `impacts={jump.impacts}` (đã có trong diff ở mục 6): mỗi lần bí đáp, vụn đang nằm gần chân bí nảy lên vài mm–1,6 cm
  (gần + mạnh thì cao hơn, hạt bí nảy cao hơn vụn thịt) và văng ra ngoài một chút. Chưa gắn thì vụn chỉ không nảy.

## 9. Dơi xếp chữ HAPPY HALLOWEEN cuối clip — `app/src/fx/Bats.tsx` (17:10)

Không cần đổi gì ở PumpkinScene (cùng props `t0`, `time`, `basis`). Đã chép vào app.

**Mốc đề xuất** (giây từ lúc dơi ra = `batsAt`; demo hiện tại `SCRIPT.bats` = 24,9 → giờ app trong ngoặc):

| pha | từ lúc dơi ra | giờ app (demo) | hình |
|---|---|---|---|
| ùa ra | 0 → 1,25 s | 24,9 → 26,15 | 390 con chui ra từ miệng bí thành dòng (trái → phải theo vị trí trong chữ), vọt lên |
| rẽ về chữ | ~0,45 → 3,0 s | 25,35 → 27,9 | mỗi con lái về điểm của nó (lò xo tắt dần tới hạn + lượn lờ nhẹ), co lại cỡ "điểm chữ" |
| **giữ chữ** | **3,0 → 4,2 s (1,2 s)** | **27,9 → 29,1** | vỗ cánh chậm/nhẹ, chao nhẹ; viền trăng lạnh + ánh cam hắt từ bí |
| tan ra | 4,2 → 4,4 s bắt đầu (giữa chữ đi trước) | 29,1 → 29,3 | lao thẳng về phía ống kính, phóng to |
| lướt qua ống kính | ~4,6 → 5,6 s | 29,5 → 30,5 | qua mặt phẳng ống kính, hết dơi ở 5,8 s (30,7) |

`BAT_TIMES` export sẵn các mốc này; `BAT_COUNT` = 390, `BAT_DURATION` = 5,8 (synth_audio.py vẫn đọc được bằng regex). **Âm thanh:**
quỹ đạo cũ đã bỏ nên phần port dơi trong `synth_audio.py` không còn khớp. Gợi ý: tiếng vỗ cánh dày lên 24,9–26,2, lắng xuống thành
tiếng rì rào nhỏ khi giữ chữ 27,9–29,1, rồi một loạt "vút" lướt qua tai 29,4–30,5 (to nhất ~29,9).

- Chữ: `Skia.Path.MakeFromText` (Helvetica Neue Light 88 / 76 / 48 pt, 3 dòng "HAPPY", "HALLOWEEN", "@novahoangdev"), lấy mẫu vùng tô
  của font mảnh (≈ đường tâm nét) trên lưới mịn + jitter, chọn đều bằng farthest-point sampling (92 / 163 / 135 con). Chạy một lần
  lúc mount. Chữ dựng theo **camera đúng lúc dơi ra** (luôn giữa khung), nằm cố định trong cảnh cách mắt 2,1 m (có parallax nếu
  camera nhúc nhích lúc giữ chữ).
- Đọc rõ "HAPPY" / "HALLOWEEN"; dòng "@novahoangdev" (chữ thường mảnh) đọc được khi nhìn kỹ — nếu cần rõ hơn cho clip, có thể
  thêm một lớp chữ mờ cùng vị trí (pt khung: tâm dòng y = 0,395 × VIEW.h, cỡ 48, Helvetica Neue Light) hiện cùng lúc giữ chữ.
- Hiệu năng: 1 mapper tính 390 con mỗi frame, ghi vào `Float64Array` sống trên UI runtime (`globalThis.__fxBats`), 2 Atlas đọc lại
  tại chỗ; hằng số ngẫu nhiên tính trước lúc mount. Không tạo object / mảng mỗi frame. Sprite ẩn dùng `HIDDEN_XF` (không RSXform 0).
  Đo trên sim FX (bản debug, máy đang rất tải): đoạn dơi FX bật ~25 fps / FX tắt ~28–31 fps cùng lúc — tức dơi tốn ~15 % so với cảnh;
  cần đo lại trên Release / máy thật.
