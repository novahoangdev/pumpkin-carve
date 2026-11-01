# LIGHT: ghi chú của agent ánh sáng

Sim riêng: "Pumpkin Light 17 Pro Max" (57B21943-917B-4B2F-9DD3-21B422828EAF), Metro 8097, chạy từ bản sao sandbox trong scratchpad.
File LIGHT giữ: `app/src/shaders/candleLight.ts` (nhận từ ATMOS lúc 17:20), `faceShadow.ts`, `lightningThrough.ts`, `notes/light*`.

## MỚI NHẤT (00:28): vành vỏ rời / thân tàng hình khi bí bay (pumpkin-rim-cut). Sửa thẳng trong app thật

- **Nguyên nhân:** lúc bay, tia nhìn được bắn từ một "mắt lệch" `eye − jW`.
  - Bí bay cao nên nhìn thấy đáy quả bí, mà ảnh vỏ Blender bị sàn cắt phẳng ở đáy (trong suốt).
  - Kết quả: một dải thân tàng hình, phần vỏ ngoài mép hiện thành vành rời khi bí xoay hoặc lộn.
- **Đã sửa:**
  - `viewSksl.ts`: thêm `restScreen()` và `pumpkinRay()`. Bỏ phần xoay / nén / thu nhỏ trên màn hình, dời điểm về chỗ bí đứng yên, rồi bắn tia từ mắt thật. Bí bay như một khối cứng và trông y như lúc đứng yên, đủ cuống, viền mềm.
  - `pumpkin.ts`: dùng `eye` cho hướng nhìn và ngọn lửa; bỏ mẹo `keep` (mẹo này còn làm mất cuống khi bay).
  - `lightningThrough.ts`: dùng cùng tia `pumpkinRay`.
  - Lúc đứng yên không đổi gì.
- `rain.ts` (của ATMOS) còn dùng `eye − jW` để mưa bị quả bí che: lệch nhẹ lúc bay, không thấy rõ.
- Đã kiểm bằng ảnh chụp sim lúc bí lộn 90° khi rơi và lúc nghiêng khi nhảy: `notes/light/v9-flying-rim-after.jpg`.

## 00:02: bỏ viền sáng màu be ở giữa đáy bí (v7 screen-60, giây 8). ĐÃ CHÉP vào app thật

- **Nguyên nhân:** bản v6 bỏ hẳn bóng trên phần sàn bị chân bí che, nên phần gỗ sáng đó lộ ra qua mép đáy hơi trong suốt của vỏ.
- **Đã sửa:** phần sàn đó giờ tối đều (0,14), bằng mức tối của bóng tiếp xúc ở mép chân. Đáy bí tối dần vào bóng tiếp xúc, không viền sáng, không dải cắt.
- `app/src/shaders/candleLight.ts` = `notes/light/candleLight.v7.ts`, typecheck sạch.
- Đã kiểm bằng ảnh chụp lúc chưa thắp: `notes/light/v7-bottom-rim-after.jpg`.
- Sim Light cũ đã bị xoá; đã tạo lại sim cùng tên (UDID mới).

## 23:32: đáy quả bí không còn dải tối (pumpkin-bottom-seam). ĐÃ CHÉP vào app thật

- **Nguyên nhân:** bóng tiếp xúc và bóng đổ (v5) tô cả lên những điểm sàn nằm ngay sau chân bí. Mép đáy của vỏ bí trong ảnh Blender trong suốt một phần, nên dải tối lộ xuyên qua đáy bí như một đường cắt.
- **Đã sửa:** thêm `seenPast(P)` trong `PUMPKIN_SHADOW_SKSL`.
  - Điểm sàn nào bị chính quả bí che theo tia từ mắt (thử bằng ellipsoid, có dải chuyển mềm) thì không áp AO, bóng tiếp xúc, bóng đèn hiên, bóng trăng hay bóng sét.
  - Ngưỡng 0,92–0,98 bán kính, vì đường viền đáy trong ảnh nằm hơi lọt vào trong ellipsoid; nhờ vậy bóng tiếp xúc vẫn áp sát chân bí.
- `app/src/shaders/candleLight.ts` = `notes/light/candleLight.v6.ts`. Không cần vá file nào khác, typecheck sạch.
- Đã kiểm trên sim Light, chỉ bằng ảnh chụp, lúc chưa thắp và lúc đã thắp.
- Ảnh: `notes/light/v6-bottom-seam-before-after.jpg` (trái: ảnh feedback, phải: sau khi sửa).

## 23:10: bỏ bóng mặt xám lệch trên sàn (FEEDBACK-2300 mục 4). ĐÃ CHÉP vào app thật

- **Nguyên nhân:** vệt "mặt cười" của lớp sét xuyên lỗ (`lightningThrough.ts`).
  - Màu xám xanh, chiếu theo hướng chớp nên lệch so với mặt cam của nến.
  - Đường cong chớp có đuôi tắt dần ~1,2 s, nên nó còn hiện mờ sau cú sét.
- **Đã bỏ hẳn:**
  - overlay sét không còn vẽ gì lên sàn, chỉ còn ánh lạnh trong lòng bí lúc chớp (không đổi);
  - bake `lightningMap` trả 0 ngay, không tốn gì; PumpkinScene giữ nguyên child, không cần sửa gì.
- `app/src/shaders/lightningThrough.ts` = `notes/light/lightningThrough.v5.ts`. Typecheck app thật sạch.
- Đã kiểm trên sim Light, chỉ bằng ảnh chụp (không quay video), lúc sét 22,35 s và ngoài lúc sét: ngoài vùng cam là gỗ thường.
- Ảnh: `notes/light/v5-floor-ghost-before-after.jpg` (trái: ảnh feedback; giữa: lúc sét; phải: ngoài lúc sét).

## 19:31: v5, bóng quả bí lúc chưa thắp (review-1917). ĐÃ CHÉP vào app thật

`app/src/shaders/candleLight.ts` = `notes/light/candleLight.v5.ts`.
- Chỉ đổi file của LIGHT. Giao diện bake, uniform và các đoạn SkSL giữ nguyên, nên không cần vá PumpkinScene hay background.
- Typecheck app thật sạch.
- Metro của agent chính sẽ tự nạp. Ai đang quay thì quay lại đoạn 0–19 s.

Ảnh:
- `notes/light/v5-shadow-before-after.jpg`: trái là khung 2,6 s trong review-1917, phải là v5 trên sim Light lúc chưa thắp.
- `notes/light/v5-shadow-floor-only.jpg`: render offline chỉ có nền và bóng (đèn hiên sáng), trái là bản trước, phải là v5.

**Nguyên nhân "đĩa elip tối":** bóng do shader giải tích của LIGHT (từ v3), không phải từ pass Blender.
- Phép thử che sáng dùng một ellipsoid trơn.
- Nguồn đèn hiên 7 cm cho bán ảnh rất hẹp, nên mép rõ.
- Độ đậm 0,6 cộng AO rộng 0,6.

**Đã đổi:**
- **Bóng tiếp xúc:** rất tối (0,88) và rất hẹp, chỉ ngay chân bí. AO rộng nhẹ đi một nửa.
- **Bóng đèn hiên ra hình quả bí:** phép thử che sáng theo đường viền 10 múi cộng cái cuống (đoạn thẳng nghiêng ~5,5 cm, dày 1,5 cm).
- **Nguồn sáng thật** gồm lõi bóng đèn 5 cm (65 %) và kính mờ cộng ánh hắt tường 25 cm (35 %).
  - Bán ảnh = cỡ nguồn × (vật che → sàn) / (đèn → vật che): sắc ở chân, mềm dần ra xa.
  - Lõi nhỏ giữ được viền múi và mũi cuống ở chóp bóng.
- **Nhạt hơn nhiều:** bóng đèn hiên chỉ che 52 %, bóng trăng 42 %, vì ánh trăng và ánh trời hắt vẫn lấp vào.
- **Vệt ướt:** ván ướt có một vệt bóng loáng mảnh của đèn hiên (GGX, Fresnel ở góc xiên). Vệt này cũng bị quả bí che.
- Không đụng tới: ánh mặt trên sàn lúc nến sáng, bóng sét, `stormLight`.

## 18:50: v4, sửa lúc sét (anh Hoa duyệt v3: giữ nguyên ánh mặt trên sàn)

Chạy **một lệnh** ở gốc dự án:

```bash
python3 notes/light/apply_v4.py
```

Lệnh này làm:
- Chép `lightningThrough.v4.ts` và `candleLight.v4.ts` vào `app/src/shaders/`.
- Vá PumpkinScene 2 dòng: overlay sét có thêm child `inLit` (ảnh lòng bí) và uniform `imgS`.

Đã chạy thử trên bản sao file thật lúc 18:51: áp sạch, typecheck, eslint và SkSL đều sạch. Ánh mặt trên sàn **không đổi** so với v3.

Ảnh: `notes/light/v4-strike-before-after.jpg` (trái: v3, phải: v4, cùng khoảnh khắc sét 17,4 s trên sim Light).

1. **Lỗ khắc lúc sét không còn trắng đặc.**
   - Ánh chớp ngoài trời chỉ rọi nhẹ thành trong. Độ sáng theo chính ảnh lòng bí (thịt và xơ bí), màu xanh lạnh.
   - Thành phía phải trong lòng bí hứng nhiều hơn vì chớp đến từ bên trái. Mép thành vết cắt vẫn thấy.
   - Mức trần 0,6. Trước khi thắp rõ hơn sau khi thắp.
2. **Hết vệt trắng răng cưa dưới miệng.** Có hai nguyên nhân:
   - Vòng 12 lần đọc mẫu để vẽ tia đã bỏ hẳn.
   - Vệt sáng trên sàn lúc sét trước đây tra bằng P còn bậc của ảnh độ sâu 8-bit. Giờ tra trên mặt phẳng sàn, lấy 4 điểm, và dịu hơn.
3. **Bóng bí trên tường và cửa rõ hơn.**
   - Ánh chớp mạnh hơn (×1,45) và bóng tối hơn: che 97–98 %, nguồn 0,6°.
   - Tường lúc chớp giảm bão hoà (trắng xanh, không còn tím loè), nên bóng đen nổi hơn.

## 18:30: v3 theo POLISH-1815 mục 1–2 (đã gộp)

Chạy **một lệnh** ở gốc dự án:

```bash
python3 notes/light/apply_v3.py
```

Lệnh này làm:
- Chép `notes/light/candleLight.v3.ts` thành `app/src/shaders/candleLight.ts`. Giao diện bake giữ y như v2, PumpkinScene không đổi.
- Thêm **một dòng** vào `background.ts` (file PERF), ngay sau dòng loé sét: `col += stormLight(P, dark);`.

Đã chạy thử trên bản sao file thật: kết quả trùng với bản đã xem trên sim, typecheck, eslint và SkSL đều sạch.

Ảnh (trái là trước, phải là sau, chụp trên sim Light):
- `notes/light/v3-wall-before-after.jpg`: nến sáng, khung nghỉ.
- `notes/light/v3-floor-before-after.jpg`: mặt trên sàn.
- `notes/light/v3-strike-before-after.jpg`: lúc sét.

**1. Bỏ mặt bí trên tường.**
- Kênh G của bake đã bỏ (rẻ hơn v2).
- Tường và cửa phía sau chỉ còn một quầng ấm rất nhẹ, không có hình: giả lập ánh xuyên vỏ và ánh hắt từ sàn, giảm theo 1/d², tối hơn quả bí nhiều.
- **Bóng sét:** mỗi cú sét, ánh chớp lạnh vào thấp từ phía trước-trái.
  - Lý do góc thấp: mái hiên chặn hết ánh sáng dốc từ trời, chỉ ánh thấp qua chỗ hở của hiên mới tới được tường.
  - Tường và cửa (đứng, quay về phía chớp) sáng lên. Quả bí đổ **bóng đen sắc** (nguồn 0,7°) dài qua sàn lên chân tường và khung cửa ngay sau-phải nó.
  - Bóng tắt theo đúng `storm` = flashCurve. Bóng cũng được gộp vào phần loé sét có sẵn của nền.
  - Code: `stormLight()` và `pumpkinShade()` trong `PUMPKIN_SHADOW_SKSL`, hướng chớp ở `LS_DIR`.
- **Không có bóng mèo.** Mèo ngồi trên lan can ở x = −0,66 m, bên trái chỗ tường bắt đầu (x = −0,30). Ánh chớp từ trái nên bóng mèo rơi vào khoảng hở của lan can: không có mặt nào hứng đúng vật lý.
- Nếu muốn có bóng mèo trên tường, phải dời mèo sang phải cột góc (x > −0,2) trong `BlackCat.tsx` (file của CAT). Khi đó cần thêm uniform vị trí mèo, khoảng 15 phút.

**2. Mặt trên sàn.**
- Nguồn đĩa nhỏ lại (bán kính 0,4 cm) và bớt quầng mềm: mắt ra tam giác, mũi tam giác, miệng có răng, sắc ở gần.
- Tone-map vô hướng (`4,2·L/(2,6+L)`) nên vân gỗ và khe ván giữ nguyên độ tương phản.
- Màu hổ phách, phần nóng nhất ngả cam đậm thay vì vàng chanh, không sáng hơn lỗ khắc.

**Cho ATMOS:** vị trí mặt trên sàn không đổi so với v2.
**Mốc sét đề xuất 17,4 s** vẫn đáng thêm: lúc 17,4 s đèn hiên sáng, bóng sét in lên cửa rõ nhất (xem ảnh sét). Lúc 22,35 s camera đang nghiêng, bóng nằm sát mép phải.

`faceShadow.ts`: không còn ai import (mặt trên tường đã bỏ). Có thể xoá sau khi quay xong.

## 18:45 (cũ): v2, bóng mặt trên tường dùng chung cách lấy mẫu nguồn sáng với sàn (đã bị v3 thay)

Agent chính đã gộp `patch_background.py` và `patch_scene.py` (18:10). Bản v2 cần **một lệnh** ở gốc dự án:

```bash
python3 notes/light/apply_v2.py
```

Lệnh này làm:
- Chép `notes/light/candleLight.v2.ts` thành `app/src/shaders/candleLight.ts`.
- Thêm child mask nét vào lần bake candleLight trong PumpkinScene, kèm dependency.
- **Gỡ pass overlay faceShadow**: bớt 1 lớp phủ toàn màn hình.

Đã chạy thử trên bản sao của file thật lúc 18:45: áp sạch, typecheck sạch.

**Không chép riêng file v2 mà không chạy script.** Bake mới cần child thứ 3, thiếu là hỏng.

Thay đổi của v2:
- Mặt trên tường giờ nằm trong chính lần bake ánh nến, ở kênh G của lightMap.
  - Lấy mẫu nguồn đĩa giống sàn (32 điểm, bán kính 6 mm), nên có bán ảnh thật tăng theo khoảng cách.
  - Tính một lần mỗi khi mask đổi. Mỗi frame chỉ tra 1 lần trong `candleShade` của background.
  - Lửa lay ×4 trên tường, mép mềm theo khoảng cách.
- Mép lỗ lấy từ mask nét, nên răng miệng hiện rõ cả trên sàn lẫn trên tường.
- Ánh sàn hạ còn khoảng 40 % so với bản 18:10 (với mask nét, bản 18:10 bị cháy vàng).

Ảnh: `notes/light/v2-before-after.jpg` (trái: trước mọi thay đổi của LIGHT; phải: v2 trên sim Light lúc nến sáng), `notes/light/v2-lit-rest.jpg`.

`faceShadow.ts` vẫn giữ (đoạn `FACE_SHADOW_SKSL`, `faceFlame`) nhưng sau v2 không còn ai import.

## 18:10: ánh mặt cười trên sàn + bóng bí (FEEDBACK-1720 mục 1)

Ảnh: `notes/light/floor-before-after.jpg` (trái là trước, phải là sau, chụp trên sim Light lúc nến sáng), `notes/light/shadow-before-after-jump.jpg`
(chưa thắp, đèn hiên sáng: bóng Blender cũ | bóng mới | bí đang nhảy 25 cm), `notes/light/lit-rest.jpg` (cả khung).

**Nguyên nhân 3–4 dải ngang:**
1. Ảnh độ sâu 8-bit dạng log có bước khoảng 2 cm ở tầm sàn. Điểm sàn P vì thế nhảy bậc, và vệt sáng bị cắt thành từng dải.
2. Nguồn sáng là 3 vòng cố định cộng 2 điểm, nên ra 4–5 bản sao hình miệng lệch nhau.

Ngoài ra ngọn lửa nằm ngang mép dưới miệng (z ≈ 6 cm), nên tia đi thẳng từ lửa chỉ lọt qua một khe ở đáy miệng. Mắt và mũi không thể in xuống sàn từ đó.

**Đã đổi trong `candleLight.ts` (đã chép vào app thật, an toàn khi chưa vá gì thêm):** shader bake giữ nguyên tên uniform và thứ tự child, nên PumpkinScene không phải đổi gì.
- Điểm trên sàn là giao tia với mặt phẳng z = 0. Hết dải.
- Còn **một nguồn duy nhất**: một đĩa bán kính 2 cm ngay trên nắp, 48 mẫu xoắn hướng dương (Fibonacci), xoay theo từng pixel.
  - Cho ra một khuôn mặt đúng phối cảnh: miệng gần bí (y ≈ −0,2 m), mũi ở y ≈ −0,3, hai mắt ở y ≈ −0,4…−0,5 và x ≈ ±0,25.
  - Mép sắc ở gần, bán ảnh rộng dần theo khoảng cách (mắt mềm hơn miệng).
- Ánh dội từ thành trong là bản mask blur rộng dọc tia trung tâm: chỉ thành một quầng mềm, không sinh bản sao.
- Pixel ở xa mọi tia sáng thoát sau 1 lần đọc mask.
- Mép lỗ cắt sắc lại bằng ngưỡng trên mask blur, vì bake chỉ nhận `maskBlur`.

**Cần PERF / agent chính vá `background.ts`** (thêm 2 đoạn SkSL từ `candleLight.ts`):

```bash
python3 notes/light/patch_background.py app/src/shaders/background.ts    # chạy bằng chuỗi neo, chạy lại an toàn
```

Bản vá làm:
- `floorSnap(P)`: P trên sàn bám mặt phẳng.
- `candleL(lb)`: tra lightMap kèm chập chờn (dịch ±1 pt và co giãn ±1,5 % quanh chân bí, cùng nhịp với `faceFlame`).
- `candleShade(...)`: ánh nến nhân với ảnh glow Blender, nên ăn vân gỗ và khe ván tối hơn.
  - Có vệt bóng loáng của sàn ướt (GGX + Fresnel ở góc xiên), ấm, sáng hơn khi nhìn nghiêng.
  - Có AO của quả bí: ảnh glow được render khi ẩn bí, nên trước đây sàn ngay chân bí sáng cam và bí trông như lơ lửng.
  - Có một vòng ấm mảnh xuyên vỏ ngay ngoài chân bí.
- `pumpkinShade(P)` (đoạn `PUMPKIN_SHADOW_SKSL`) thay hẳn `shadow_lit/dark.png` (child vẫn khai báo nhưng không đọc nữa):
  - Bóng tiếp xúc rất tối và hẹp ở chân bí, cộng AO.
  - Bóng mềm của đèn hiên (đèn cầu 9 cm) và của trăng sau mây (nón ~4,5°). Bán ảnh rộng dần theo khoảng cách. Vùng tối nhất ~0,4, không đen kịt.
  - Áp sau khi đã trộn panorama và ảnh gốc, nên quay góc nhìn không bị cắt ở mép khung.
  - Khi bí nhảy, bóng theo `jW` (nhạt và loang theo độ cao). Bóng tiếp xúc tắt khi bí nhấc lên.

**Cần agent chính vá `PumpkinScene.tsx`:**

```bash
python3 notes/light/patch_scene.py app/src/scene/PumpkinScene.tsx
```

Bản vá làm:
- `LIGHT_K = 2` (vệt sáng mỏng vì camera thấp; bake chỉ chạy lại khi mask đổi).
- Thêm `...candleFloorUniforms(time.value, PUMPKIN_FOOT)` vào `bgU`.
- Gắn luôn bóng mặt trên tường và sét xuyên lỗ (2 mục dưới).

Áp cả 2 bản vá cùng lúc: `candleFloorUniforms` thêm uniform mà background cũ không khai báo.

**Cho ATMOS:** hình mặt trên sàn giờ nằm ở y ≈ −0,2…−0,5 m, x ±0,25 (trước là một dải quanh y ≈ −0,3).
- Vũng sáng hắt lên sương quanh (0; −0,42) trong `atmos.ts` vẫn khớp, nhưng có thể kéo dài theo y.
- Phản chiếu bí trên sàn ướt trong `rain.ts`: không đổi.

## Bóng mặt bí khổng lồ trên tường (A): `faceShadow.ts`

Đã chạy trên sim Light (xem `lit-rest.jpg`): sau khi thắp, một khuôn mặt cười to ~0,7 m in lên tường gỗ, cột và cửa ngay trên quả bí.
- Đổi đúng khi xoay góc nhìn và nghiêng máy (tính theo điểm thế giới lấy từ độ sâu).
- Lay động theo lửa: tâm chiếu dao động theo `lean` và nhiễu, nhân ×4 lên tường.
- Mép mềm dần theo khoảng cách (mask nét đổi dần sang mask blur).
- Lỗ cắt dày làm hẹp chùm tia xiên.
- Albedo lấy từ ảnh đèn hiên đã nén lại, nhân 1/d².

**Lưu ý trung thực về vật lý:** mặt khắc quay về phía camera, nên ánh nến thật đi qua lỗ không thể tới tường phía sau.
- Bản này chiếu qua ảnh đối xứng của mask sang nửa sau quả bí (như thể lỗ khắc xuyên qua quả bí).
- Tâm chiếu đẩy ra trước 22 cm để mặt phóng ~5× (dùng lửa thật thì phóng ~10×: miệng tràn hết bề ngang, mắt ra ngoài khung).
- Hằng số: `FS_PUSH`, `FS_DROP` trong `faceShadow.ts`.

Đã có lớp `<Fill blendMode="plus">` riêng, vẽ ngay sau nền và trước quả bí, trong `patch_scene.py`.
- Chi phí khi chưa thắp: thoát ngay theo uniform.
- Khi đã thắp: 2 lần đọc độ sâu, 2 phép giao ellipsoid, tối đa 4 lần đọc mask, chỉ ở các pixel phía sau quả bí.
- Đề xuất cho PERF nếu cần bớt một pass: gộp `FACE_SHADOW_SKSL` (`faceWall(P)`) vào `background.ts`. Ở đó đã có P và ảnh glow, nên chỉ tốn thêm phần giao ellipsoid và đọc mask.

## Sét chiếu xuyên lỗ khắc (B): `lightningThrough.ts`

Mỗi lần sét đánh (đi theo `storm` = flashCurve), ánh trắng xanh từ phía sau quả bí lọt ra:
- Lỗ khắc loé trắng, lõi sáng nhất ở giữa lỗ, viền lạnh tràn ra vỏ.
- Có tia sáng ngắn trong mưa, chạy từ các lỗ xuống phía vệt sáng trên sàn.
- Vệt sáng hình mặt in lên sàn trước bí: bake một lần mỗi khi mask đổi (`lightningMap`), giao đúng mặt phẳng sàn, vỏ dày cắt tia xiên.
- Chỉ bật khi đã khắc. Trước khi thắp sáng gấp đôi.
- Overlay `plus` vẽ sau quả bí: thoát ngay khi không có chớp. Khi chớp chỉ tính quanh quả bí (12 lần đọc mask cho tia).

**Đề xuất cho ATMOS (`storm.ts`):** hai cú sét hiện có rơi lúc camera nhìn sang trái (9,95 s, không thấy bí) và lúc đã thắp (22,35 s, không rõ bằng).
- Thêm một cú lúc bí đã khắc xong, chưa thắp, camera ở khung nghỉ: `{ t: 17.4, az: -0.3, el: 0.5, dist: 900 }` (sau cú rơi lại 16,6, trước que diêm 18,6).
- `synth_audio.py` tự đặt tiếng sấm theo mốc này.
- Đã thử trong sandbox: quả bí "trợn mắt" rất rõ.

## Hiệu năng

- Sim lúc đo bị bỏ đói (load avg host 26–50 vì nhiều agent cùng chạy): ra 0–30 khung/s cả khi tắt lớp mới. Số FPS trên sim lúc đó không dùng được.
- Đo chi phí tương đối của shader bằng canvaskit (CPU raster, uniform thật, 440×956, nến sáng, khung nghỉ). Lúc đo faceShadow vẫn còn 3 vòng reproject; sau đó đã giảm còn 1 vòng.

| Pass | Thời gian |
|---|---|
| background | 4,6 s |
| faceShadow, đã thắp | 3,2 s |
| faceShadow, chưa thắp | 1,2 s (chỉ là chi phí lấp pass trên CPU) |
| lightning, đang chớp | 4,75 s, chỉ ~1 s mỗi cú sét |

- Bake candleLight mới chạy 48 mẫu trên vùng có tia: CPU 16 s so với 6 s của bản cũ. Trên GPU vẫn chỉ cỡ vài chục ms và chỉ chạy khi mask đổi.
- **PERF nên đo lại trên Release.** Nếu gắt: gộp faceShadow vào background (xem trên), hoặc trả `LIGHT_K` về 1.
