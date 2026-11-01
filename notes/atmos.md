# ATMOS: sương, khói, tia sáng, mưa, ánh nến

Agent phụ ATMOS. File giữ: `app/src/shaders/atmos.ts`, `rain.ts`, `candleLight.ts`, `app/src/fx/storm.ts`, `notes/atmos.md`.
Không đụng file của agent chính, không cần đổi uniform hay child shader nào trong `PumpkinScene.tsx` (atmos chỉ dùng tập con
uniform đang truyền; hình học cảnh được nhúng thành hằng số từ `layout.ts` và `build_scene.py`).

## 1. Sương, khói, tia sáng thành khối 3D thật (`atmos.ts`), đã xong

Feedback: "khói khi quay góc thì ảo và giả, không khớp ánh sáng và quả bí".

Nguyên nhân trong bản cũ:
- Sương là nhiễu 2D vẽ theo kinh/vĩ độ của hướng nhìn, giống một skybox bám theo mắt, nên khi nghiêng hay đi vòng quanh
  bí thì không có parallax: trông như một tấm phẳng dán lên màn hình.
- Tia sáng là radial blur của mask trong không gian màn hình, kéo từ ngọn lửa ra mọi hướng, nên vệt sáng hắt ngược lên tận
  cánh cửa phía sau, không phụ thuộc sương ở đâu.
- Ánh nến trong sương là một quầng màn hình `exp(-dist/120)`, nên sàn quanh bí "ấm" giả.

Bản mới dùng chung camera xem của cảnh (`viewRay`, `eye`, độ dịch khi bí nhảy `jW`) với nền và bí:
- **Sương sát đất**: mật độ `σ = 0,95·n·exp(−h/0,24 m) + haze`, trong đó h là độ cao trên mặt thềm (z = 0), bậc trước (−0,2)
  hoặc sân (−0,43). Phần exp được **tích phân giải tích** dọc tia nên không có hạt nhiễu và rất rẻ. Tia đi qua 2 đoạn: đoạn
  gần (bậc và thềm, nằm dưới mái nên trăng không rọi thẳng) và đoạn xa (sân sau lan can, có trăng rọi). Nhiễu theo gió được
  lấy ở các điểm tứ phân vị của khối sương trên tia, trong toạ độ thế giới, nên mảng sương đứng yên trong cảnh khi xoay hay
  nghiêng máy, sương xa và gần trượt khác nhau đúng parallax. Tia kết thúc ở mặt cảnh (thềm, sân, tường sau) hoặc ở quả bí
  (hình thật lấy từ alpha vỏ, độ sâu lấy từ ellipsoid), nên bí che sương đúng chỗ.
- **Ánh sáng trong sương**: trời đêm và trăng (hướng `MOON_DIR` của Blender, bị mái che), đèn hiên (điểm, 1/d²), sét (hướng
  tia sét, quả bí đổ bóng vào sương), vũng sáng mặt cười trên thềm hắt ngược lên lớp sương sát sàn. Pha tán xạ
  Henyey–Greenstein (xấp xỉ Schlick): sương sáng hơn khi nhìn về phía nguồn sáng.
- **Chùm sáng nến** (god rays): ray-march 6 mẫu trong đoạn tia nằm trong quả cầu 0,5 m quanh ngọn lửa, chỉ ở nửa không
  gian phía trước quả bí. Mỗi mẫu kiểm tra đoạn mẫu→lửa có ra được qua lỗ khắc hay không: cắt vỏ ngoài ở lỗ VÀ đi xuyên
  bề dày vỏ (1,7 cm) vẫn trong lỗ, nên vỏ dày chặn tia xiên. Ngọn lửa lấy mẫu như vật thể thật cỡ khoảng 2×3,5 cm, nên mép
  chùm sáng mềm. Kết quả là chùm sáng có đúng hình lỗ khắc, đúng hướng, nằm đúng trong sương và đúng parallax.
- **Khói nến**: sợi khói 3D bốc từ khe nắp quanh cuống (khí nóng thoát lên trên), lúc đầu thẳng (chảy tầng) rồi xoắn mạnh
  dần, nghiêng theo gió (+x, cùng chiều trôi của sương). Đường tâm khói nằm trong toạ độ thế giới (tấm cong quay về phía mắt),
  bị bí và cảnh che theo độ sâu, được khe nắp rọi ấm từ dưới, trăng và sét chiếu theo hướng.
- Quầng đèn hiên và loé nến giờ tính theo góc giữa tia nhìn và nguồn sáng 3D, không dùng toạ độ màn hình nữa.

Hiệu năng (đo bằng CanvasKit WebGL trên GPU M5 Pro, 1320×2868, vẽ liền 40 khung rồi đồng bộ GPU một lần):

| | atmos | cả khung (nền + bí + mưa + atmos) |
|---|---|---|
| trước | 1,94 ms | 3,2–3,38 ms |
| sau | 1,77 ms | 3,17 ms |

Bản mới nhanh hơn bản cũ một chút: bỏ được 28 lần đọc mask mỗi pixel của radial blur và fbm 4 octave × 2. Đường đi đến
đây: bản ray-march đầu tiên tốn 2,6 ms và còn nhiễu hạt, nên mới đổi sang tích phân giải tích và giới hạn vùng tính chùm sáng.

## 2. Ánh nến trên cảnh (`candleLight.ts`), đã xong

- Trước: 5 điểm nguồn cố định (2 điểm trên nắp, 2 điểm thành sau, ngọn lửa), trọng số cộng vượt 1, nên trên thềm in ra 2
  bản sao mặt cười cứng.
- Sau: nguồn sáng đúng thực tế. Gồm ngọn lửa (điểm chói, cho tia hắt lên qua mắt), điểm nóng trên nắp ngay trên ngọn lửa
  (lửa toả lên mạnh nhất, giữ hình mặt cười rõ trên thềm), và 16 điểm trên nắp trong và thành sau được lửa rọi (nguồn diện
  tích, trọng số 1/d² tới lửa, chuẩn hoá). Bán ảnh trên thềm giờ mềm như nến thật, độ sáng giữ ngang bản cũ.
- Chỉ tính lại khi mask khắc đổi (offscreen), nên không ảnh hưởng FPS.

## 3. Mưa (`rain.ts`), đã xong

- Sửa vị trí đèn hiên: trước đặt sai ở (0, 1.3, 1.9), giờ là (−0.08, 1.42, 1.32) đúng như `build_scene.py`.
- Giọt mưa tán xạ mạnh về phía trước: nhìn ngược về phía trăng, tia sét, đèn hiên hay ngọn lửa thì vệt mưa sáng lấp lánh
  hơn (ngược sáng); nhìn xuôi thì tối hơn. Áp dụng cho cả vệt mưa, dòng nhỏ giọt mép mái và gợn nước.
- Phần hình học mưa (các lớp trụ quanh mắt, che theo độ sâu, không mưa dưới mái) vẫn giữ như cũ, vốn đã đúng phối cảnh.

## 4. Đợt 2 (16:15): hướng sét, grain

- Sương, khói và mưa giờ được chiếu sáng theo hướng của cú sét đang đánh. Mưa đọc thẳng uniform `bolt`; atmos ở chế độ demo chọn
  theo `STRIKES` và `time` (cùng đồng hồ với `storm.ts`), ở chế độ tương tác dùng hướng trung bình phía trời bên trái.
- Atmos giờ vẽ ở 1/3 mật độ (`ATMOS_DOWN`, bản vá của PERF) nên giảm biên độ grain từ 0,035 xuống 0,02. Dither của chùm sáng đã
  tính theo ô `floor(xy·3)` nên không bị to ra.
- FPS trên sim ATMOS (`EXPO_PUBLIC_PERF=1`, bản debug, host tải nặng): đoạn sau khi thắp và nghiêng `ui` 43–60 fps, phần lớn ~52–60.

## 5. Tia sét thật hơn (`fx/storm.ts`, `rain.ts`), 16:20 (feedback "sấm chớp giả")

- Trước: đường gấp khúc 16 điểm ngẫu nhiên đều, nét đều, không nhánh, trông như vẽ tay.
- Sau: kênh chính 33 điểm dựng bằng midpoint displacement: khúc lớn gãy mạnh, khúc nhỏ lăn tăn, đúng kiểu fractal của sét thật.
  Có 3 nhánh phụ tách ra ở nửa trên, chĩa xuống chéo ra ngoài, mảnh và mờ dần về đầu nhánh. Lõi trắng mảnh, quầng xanh tím
  trong mưa và mây; nhánh mảnh hơn, tối hơn. Vẫn chỉ vẽ trên vùng trời (độ sâu > 60 m), nên mái, cây, nhà che đúng.
- Định dạng `bolt`: `[az, el, w]` × `BOLT_N` (= 62); 2 phần tử đầu là khung bao để shader bỏ qua pixel ở xa. `PumpkinScene` không
  cần đổi gì (vẫn `bolt.value.flat()` và `boltPoints(...)`).
- `STRIKES`, `flashCurve`, `currentStrike` giữ nguyên, nên `synth_audio.py` không bị ảnh hưởng.


## 6. Feedback 16:30 mục 1 + 2 (sương lỗi layer, nước giả), 16:50. CẦN AGENT CHÍNH GỘP PATCH

**Gộp (chỉ JS, không build native):**

```bash
python3 notes/atmos/patch_scene.py app/src/scene/PumpkinScene.tsx      # vá theo chuỗi neo, báo lỗi nếu không thấy neo
cd app && npx tsc --noEmit && npx eslint src/scene/PumpkinScene.tsx
```

Patch đổi 4 chỗ trong `PumpkinScene.tsx` (đã thử trên bản sao + sim ATMOS, tsc/eslint sạch):
1. `import { atmos }` → `import { atmosDepth }`
2. trong `aU`: `...viewU.value` → `...depthU.value` (thêm dK, dpSize, dRange, pFwd, pRight, pRange)
3. `<Shader source={atmosDepth} …>`: thêm 2 child `<ImageShader image={depthB} tx="clamp" ty="clamp" />`,
   `<ImageShader image={depthP} … />` sau `skinLit`
4. mưa: `<Fill blendMode="plus">` → `<Fill>` (srcOver). `rain.ts` trả alpha = 0 ở mọi chỗ trừ sàn ướt, nên ngoài sàn ướt kết quả
   y hệt plus; alpha > 0 ở sàn ướt làm gỗ ướt tối đi.

Chưa gộp thì vẫn chạy (file đã ở trong dự án): `atmos` cũ vẫn export với giao diện cũ (đã sửa ánh sáng), mưa với plus thì có
phản chiếu, gợn, giọt nhưng gỗ chưa tối đi. Lỗi "dải sương dán đè lên cột" chỉ hết hẳn sau khi gộp (cần độ sâu thật).

**Mục 1, sương** (`atmos.ts`, export mới `atmosDepth`):
- Nguyên nhân: sương cũ không biết độ sâu thật, nên tia nhìn ra sân xuyên qua cả lan can; mép cứng là chỗ tia đổi từ "chạm
  sàn thềm" sang "ra sân"; sương ngoài sân lại được trăng chiếu với tán xạ thuận gấp ~4,7 lần, nên thành dải xanh cháy sáng.
- Giờ: điểm cuối tia lấy từ `bg_depth` / `bg_depth_pano` (`reproject`, khoảng cách thật từ mắt). Mật độ là tích phân giải tích
  `exp(−h/H)` dọc tia: dưới mái H = 0,24 m tính từ mặt thềm; ngoài sân lớp dày hơn (H ≈ 0,4 m × nhiễu, tính từ mặt sân −0,43).
  Haze nền cũng giảm theo độ cao (1,5 m), nên bầu trời không bị phủ mờ. Cột gần gần như không có sương, xa ngoài sân sương dày,
  cửa sổ nhà bên mờ đi sau lớp sương. Đỉnh lớp sương nhấp nhô theo nhiễu neo trong toạ độ thế giới, không còn mép nào.
- Ánh sáng: sương không sáng hơn mặt đất được trăng rọi (trời + trăng ≈ 0,2–0,38, tán xạ thuận nhẹ); ấm lên quanh đèn hiên
  (1/d²) và quanh bí khi đã thắp; khi có sét thì sáng vừa phải.

**Mục 2, nước** (`rain.ts`, toàn bộ là hàm của thời gian trong shader, không có hạt CPU):
- Bỏ: quầng xanh phát sáng (sương cũ + gợn mưa chiếu sáng như nguồn sáng); dòng nhỏ giọt có độ sáng nền 0,2 không đổi (các
  "gạch đứng yên" ở mép sàn).
- Sàn ướt: lấy giao tia với mặt phẳng sàn (z = 0, ngoài thềm là sân −0,43), đối chiếu ảnh độ sâu để không đè lên cột, lan can, bí.
  Vùng ướt bám mép ngoài theo phần mái che (lan can sau ~0,5 m, mép trái ~0,3 m, mép trước ~0,22 m); vũng không đều, kéo dài
  theo thớ ván; sân ngoài ướt hết. Gỗ ướt tối đi (alpha 0,38, cần patch 4).
- Phản chiếu Fresnel (Schlick, F0 nước 0,02, càng xiên càng mạnh): trời, đĩa trăng (hướng lấy từ panorama), đèn hiên, cửa sổ nhà
  mình, ô kính cửa, cửa sổ hai nhà bên (vị trí 3D dò từ `bg_dark_pano.jpg` + `bg_depth_pano.png`), ảnh quả bí khi thắp, chớp sét.
  Phản chiếu kéo dọc như mặt ướt thật, bị mái che khi điểm nằm dưới mái, độ nhám giảm ở chỗ đọng thành vũng.
- Gợn mưa: lưới ô 0,16 m trong toạ độ thế giới, mỗi ô một giọt với chu kỳ 0,8–1,7 s. Vòng loang ra rồi tắt (~0,5 s), khoảng
  20–30 vòng cùng lúc ở dải ướt. Normal của gợn làm méo phản chiếu; hạt bắn sống 0,12 s.
- Giọt nước nhỏ từ thanh trên lan can (z 0,84) và mép mái trái (z 2,8): từng giọt treo, lớn dần, rơi tự do (g = 9,8), nhoè theo
  vận tốc. Giọt từ lan can chạm thềm thì sinh gợn đúng chỗ, đúng thời điểm.
- Ghi chú: dải sáng xanh nhạt ở mép thềm ngoài lan can và các đốm vàng trên mép ướt nằm sẵn trong ảnh nền Blender (`bg_*.jpg`). Nếu
  anh Hoa vẫn thấy chúng chói thì phải giảm độ bóng hoặc sáng của vật liệu mép ướt trong pass Blender (việc của agent chính).

**Hiệu năng** (CanvasKit WebGL, GPU M5 Pro, 1320×2868, vẽ liền 40 khung):

| | trước | sau |
|---|---|---|
| mưa + nước (full-res) | 0,87 ms | 0,97 ms |
| atmos (tính ở full-res; trong app vẽ ở 1/3 mật độ nên ÷9) | 1,22 ms | 1,70 ms (~0,19 ms trong app) |

Cả khung trong app tăng khoảng 0,15 ms trên M5 Pro. Chưa đo được trên 17 Pro Max thật: cần agent chính hoặc PERF đo bản
Release sau khi gộp.

**Ảnh trước/sau** (`notes/atmos/`): `sim_yaw-0.66_truoc-sau.jpg` (sim, lúc sét), `sim_yaw+0.62_truoc-sau.jpg`,
`render_yaw-0.66_truoc-sau.jpg`, `render_yaw+0.62_truoc-sau.jpg` (renderer WebGL, cùng camera, không sét),
`chan-lan-can_truoc-sau.jpg` (cận chân lan can).

## Bàn giao `candleLight.ts` cho LIGHT (17:20)

Từ 17:20, `app/src/shaders/candleLight.ts` do agent LIGHT giữ; ATMOS không sửa file này nữa. Không có thay đổi dở. Bản hiện tại
trong dự án là bản cuối của ATMOS (mục 2 ở trên): ngọn lửa (điểm) + điểm nóng trên nắp ngay trên lửa + 16 điểm trên nắp trong và
thành sau (nguồn diện tích, trọng số 1/d² tới lửa, chuẩn hoá), đầu ra R = L/6 như cũ.

## Ghi chú cho quay 120 fps (FEEDBACK-1720 mục 2)

Mọi chuyển động của ATMOS (sương trôi, khói xoắn, mưa rơi, gợn, giọt nhỏ, nhịp sét `flashCurve`/`currentStrike`, chọn hướng sét
theo `STRIKES` trong atmos) đều chỉ là hàm của uniform `time` / tham số `t` lấy từ đồng hồ cảnh (`time.value`). Chỉ cần đồng hồ
demo đã nhân `EXPO_PUBLIC_TIMESCALE` là ATMOS chậm theo đúng, không cần sửa gì thêm. `STRIKES[].t` là giây của đồng hồ demo.

## Đề xuất cho FX / agent chính (file không phải của ATMOS)

**A. Khói que diêm (`fx/Match.tsx`) nhiều khả năng chính là "cái khói ảo khi quay góc" mà chủ dự án nhắc.** Hiện các cụm khói là
sprite theo toạ độ màn hình (`S.x`, `S.y` = chỗ que tắt trên màn hình) và sống khoảng 3,5 s. Camera bắt đầu nghiêng 1,2 s sau khi
thắp, nên khói đứng yên trên màn hình trong khi quả bí trượt đi. Sửa: neo vào thế giới.

```ts
// lúc lửa tắt: điểm thế giới ngay trước mặt bí dưới đầu que (lùi 1,5 cm về phía mắt)
const bb = basis?.value ?? BASE_BASIS;
const sx = (X - VIEW.w / 2) / bb.f, sy = -(Y - VIEW.h / 2) / bb.f;
const d = [0, 1, 2].map((i) => bb.x[i] * sx + bb.y[i] * sy - bb.z[i]);
const p = pumpkinHit(bb.e, d), L = Math.hypot(d[0], d[1], d[2]);
smoke.set({ t, w: [0, 1, 2].map((i) => p[i] - (d[i] / L) * 0.015) });
// mỗi frame: cụm khói bay lên theo mét rồi chiếu qua camera xem (M ≈ D0 / F0 ≈ 0,0014 m/pt để giữ nhịp cũ)
const wz = S.w[2] + (4 + 16 * a + 6 * a * a) * M;
const wx = S.w[0] + (Math.sin(te * 6 + a * 2.4 + ph) * (0.6 + 4.5 * a) + a * a * 2.5 * drift) * M;
proj(basis?.value ?? BASE_BASIS, wx, S.w[1], wz, o);   // o[0], o[1] = màn hình; cỡ sprite nhân o[3] / k0
```

Nếu không kịp sửa thì cách rẻ nhất: giảm `SMOKE_LIFE` xuống khoảng 0,9 s để khói tan trước khi camera nghiêng. Sợi khói nến 3D
trong atmos sẽ lo phần khói còn lại.

**B. `fx/pfx_atlas.ts`: `CX0 = 201, CY0 = 437` là tâm của khung cũ 402×874.** Khung hiện là 440×956 (`layout.json` view, f = 672),
nên `proj`, `pumpkinWorld` và `baseToFloor` lệch khoảng 19 pt ngang, 41 pt dọc. Nên dùng `VIEW.w / 2`, `VIEW.h / 2`.

## Cách xem

- Sim riêng "Pumpkin Atmos 17 Pro Max" (EA6AE9EA-…), Metro port 8094, `EXPO_PUBLIC_DEMO=1`. Thấy rõ nhất ở đoạn sau khi
  thắp nến lúc camera nhìn quanh và nghiêng: sương ngoài sân, sợi khói trên cuống, hình mặt cười trên thềm.
- Ảnh so sánh và bộ render WebGL nằm trong scratchpad của phiên ATMOS (render cả cảnh ở mọi góc với các shader thật, có đo ms).

## Lưu ý cho agent chính

- Hằng số hình học trong `atmos.ts` lấy theo `build_scene.py`: thềm x −2,62…5,35, y −0,62…1,55; tường sau y = 1,55 từ
  x > −0,30; sân z = −0,43; đèn hiên (−0,08, 1,42, 1,32); `MOON_DIR`. Nếu đổi bố cục Blender thì sửa các hằng này
  (hoặc đưa vào `layout.json`).
- Không cần build native. Không đổi file nào ngoài các file ATMOS giữ.

## 7. Sương ở khung nghỉ mới (REST oy −0.08, mắt thấp ~0,28 m)

- Lỗi: ở khung nghỉ mới, mắt ở sát sàn nên tia nhìn đi qua lớp sương dưới mái ngay từ ống kính, tạo một màn xám phủ nửa dưới màn hình (rõ nhất khi bí đã thắp).
- Sửa trong `atmos.ts`:
  - `tA` 0.06 → 0.45: bỏ 45 cm sương đầu tiên trước ống kính (sương thật không bám vào ống kính).
  - `SIG` dưới mái 0.95 → 0.6: mái che mưa và gió nên dưới hiên ít sương hơn ngoài sân.
  - Hệ số tia nến 0.12 → 0.18: bù cho mật độ thấp hơn để tia sáng qua mắt và miệng vẫn thấy rõ.
- Sương ngoài sân và sau lan can không đổi.
- Hiệu năng: không thêm mẫu nào, chi phí như cũ.
- Ảnh:
  - `atmos/render_khung-nghi_truoc-sau.jpg` (cũ | mới, thắp | nghiêng).
  - `atmos/sim_khung-nghi_suong-gan.jpg` (sim: chưa thắp | thắp).

## 8. Polish trước 20:45 (đăng X 23:00)

Kiểm bản hiện tại của agent chính (18:15):
- Đã gộp đủ: `atmosDepth` + depthB/depthP, mưa `<Fill>` srcOver, canvas sương 1/3 mật độ, `fOff` (flameFollow) trong atmos.ts.
- Không còn mép cứng của lớp sương.
- Không còn quầng xanh trên sàn.

Lỗi còn lại tìm thấy:
1. **Sân nhìn như mặt hồ (yaw −0,66, nhất là lúc sét).**
   - Nguyên nhân: tia gần nằm ngang đi qua lớp sương sát đất rất dài, nên sương sân gần như đục và phẳng.
   - Mỗi điểm ảnh lấy 1 mẫu nhiễu ở điểm nhảy xa theo hàng màn hình, nên ra vệt ngang như gợn nước.
   - Tách lớp đã xác nhận: nền sạch, chỉ lớp sương tạo ra mặt hồ này.
2. **Phản chiếu cửa sổ nhà mình / kính cửa ở chân lan can sau là đốm cam tròn**, trông như phát sáng.
3. **Gợn mưa và giọt từ mái / lan can gần như không thấy**: gợn bị dẹt còn ~3 pt ở góc sát; giọt ~1 pt.
4. **Ở khung nghỉ, sàn gần ống kính khô hoàn toàn**, không có vẻ "tối và bóng".

Sửa trong atmos.ts:
- Sương sân lấy trung bình nhiễu ở 2 điểm tứ phân vị (hết vệt ngang).
- Thêm đốm lớn ~3 m trôi chậm, để sân tối và chân nhà hàng xóm lộ ra giữa các dải sương.
- Bão hoà mềm độ dày: `tau2 = 1.3·(1 − e^(−tau2/1.3))`, sương sân che tối đa ~73 %.
- Ánh sương sân ×0,8, để sương không sáng hơn mặt sân được trăng rọi.

Sửa trong rain.ts:
- **Gỗ ẩm loang lổ dưới mái** (`damp` tối đa 0,26, nhiễu thưa ~1 × 2,5 m):
  - Sàn tối đi tối đa ~10 %.
  - Phản chiếu Fresnel mờ (nhám 0,08) của đèn hiên, quả bí thắp và trăng (bị mái che).
  - Không đọng vũng nên không có gợn.
- **Gợn mưa:**
  - Tỉ lệ ô có giọt 0,45 → 0,75 trên thềm, 0,6 → 0,8 ngoài sân; mỗi vòng sống 0,65 s (cũ 0,5 s).
  - Vòng bắt sáng ×1,8; hạt bắn ×1,8, thấy được cả khi vòng bị dẹt.
- **Giọt từ mép mái trái và thanh trên lan can:** bán kính 1,7 → 2,4 mm, tối thiểu 0,55 pt, sáng ×1,5 (giọt loé như thấu kính).
- **Phản chiếu:**
  - Cửa sổ nhà mình và kính cửa giảm ~37 % (hết đốm cam phát sáng).
  - Đèn hiên ×1,4 (trên gỗ ẩm vẫn ra một vệt ấm mờ).
- **Hiệu năng:**
  - Ở gỗ chỉ ẩm (không vũng) bỏ qua `ripples()` và 4 phản chiếu cửa sổ nhà bên.
  - Đo trên WebGL, 1320×2868, máy đang tải: pass mưa 3,6 ms sau so với 3,9 ms trước (trung bình 4 lần, sai số ±0,5 ms), nên không chậm hơn.
  - Sương thêm 2 lần nhiễu ở 1/3 mật độ: không đáng kể.

Ảnh:
- `atmos/sim_polish-2045_truoc-sau.jpg`: sim, hàng trên trước / hàng dưới sau. Thứ tự cột: yaw +0,62 · yaw −0,66 lúc sét loé · −0,66 ngay sau sét · khung nghỉ đã thắp (đang nghiêng máy).
- `atmos/render_san-yaw-0.66_truoc-sau.jpg`: sân sau lan can: trước | sau, thường | lúc sét.
- `atmos/render_san-khung-nghi_truoc-sau.jpg`: sàn ở khung nghỉ: chưa thắp trước | sau, đã thắp trước | sau.

Ghi chú công cụ:
- `dump.cjs` của tôi đã thêm uniform mới của LIGHT / FX (`candleFloorUniforms`, `fOff`, `fStretch`, `fGust`, `fTip`, `gust`, `ember`).
- Child `mask` của candleLight đã được thêm, để render offline khớp bản hiện tại.

## 9. Lá gió intro (`app/src/fx/Gust.tsx`, ATMOS giữ từ 18:45)

Lỗi: `render/preview/review-1828.png`, khung 2,6 s (khung nghỉ) có một lá tiền cảnh mờ tối, ngoài nét, đè ngang mặt bí như vết bẩn.
- Gió bắt đầu 1,6 s.
- Lá tiền cảnh sống tới ~3,5 s, lá trung cảnh tới ~4,2 s, nên vẫn còn trong khung khi camera đã dừng (2,3 s).
- Lá tiền cảnh đặt theo toạ độ thế giới nên có thể bay qua giữa khung.

Sửa:
- **Lá tiền cảnh:**
  - Bắt đầu trong 0,01–0,175 s, mỗi lá chỉ ~0,5 s trong khung, nên lá cuối ra khỏi khung lúc u = 0,68 (2,28 s), trước khi camera dừng.
  - Đặt theo hệ camera, độ sâu 0,32–0,62 m.
  - X quét ngang từ −1,3 đến +1,3 nửa bề ngang (vào và ra hẳn hai mép).
  - Y trong dải mép trên (lá chẵn) / mép dưới (lá lẻ), 72–94 % nửa chiều cao. Tức là chỉ trong 6–28 % sát mép khung, kể cả lúc camera đang cẩu.
  - Lá nhỏ hơn (5,5–9 cm, cũ 8,5–13,5 cm), xoay / lật nhanh hơn.
  - Độ đục thân 0,9 → 0,55, bóng mờ chuyển động 0,4 → 0,22.
- **Lá trung cảnh:** bắt đầu ≤ 0,12 s, sống 0,55 s, bay 3,6–5,8 m/s (cũ 1,7–3), hết trước u = 0,67.
- **Lá sàn:** gió tới sớm hơn (0,04–0,22 s), trượt e^(−7τ), nảy 0,22–0,34 s, nằm yên trước ~0,6 s sau cơn gió.
- Lint và tsc sạch.

Kiểm tra trên sim của tôi:
- Không quay video được (máy đang có agent khác quay sim, quay là độc quyền cả máy).
- Thay vào đó build sandbox với TIMESCALE 0,15 rồi chụp liên tiếp.
- Ảnh `atmos/gust_truoc-sau.jpg`: trước (2,6 s, review-1828) | sau: 4 khung cuối cơn gió (lá ở mép trên trái, mép dưới) | khung nghỉ sạch.
