# Pumpkin Carve: khắc bí ngô Halloween

> **Trạng thái (1/11, 00:40):** bản final: `render/promo/pumpkin-carve-final-v2.mp4` (60 fps, máy đứng yên, tiếng `mix_final.wav`; quay `render/promo/v10` TS 0.5 60/60, FILM0 1.467, beats `v5s.json`). Island bí mini + BOO! bản cũ, bí bay cứng (đã sửa vành), bỏ mảnh vụn, end card "Happy Halloween!". Bản trước: `pumpkin-carve-final.mp4`. Video final lưu trong repo (xem `.gitignore`). M0–M5 ✅, tính năng xem `notes/*.md`.

Demo iPhone khoảng 18 giây để đăng X: lấy ngón tay khắc mặt quả bí ngô, mảnh vỏ rơi vào trong, rồi thắp nến. Ánh nến hắt qua đúng những nét vừa khắc, tạo tia sáng trong sương và in bóng khuôn mặt lên bậc thềm. Cuối clip, một đàn dơi bay ra từ miệng bí.

Plan viết ngày 31/10/2026, là ngày Halloween. Mục tiêu là có clip đăng được trong tối nay (giờ Việt Nam), nên làm theo thứ tự ưu tiên ở mục 8: mỗi mốc phải ra được thứ quay được rồi mới làm tiếp.

---

## 0. Tóm tắt

**Câu chuyện clip.** Bậc thềm gỗ ban đêm, trăng tròn, sương là là mặt đất, một quả bí ngô chưa khắc, có đèn hiên vàng ấm. Một ngón tay khắc lần lượt mắt, mũi, miệng, và mỗi mảnh vỏ khắc xong sụp vào trong kèm vụn bí bắn ra. Một que diêm được kéo vào miệng bí, đèn hiên tắt, tối hẳn 0,3 giây, rồi nến bùng lên. Khuôn mặt sáng rực, tia sáng xuyên sương, bóng mặt cười in trên bậc thềm. Nghiêng máy thì nhìn được thành vết cắt và lòng bí lệch theo góc nhìn, ngọn lửa nghiêng theo. Cuối cùng một đàn dơi ùa ra từ miệng bí bay về phía camera, rồi hiện end card.

**Kiến trúc chọn: Blender render sẵn các lớp 2.5D, Skia ghép real-time.**

- Camera cố định nhìn thẳng. Blender render quả bí, lòng bí, nền và các pass dữ liệu (normal, vùng khắc được) từ cùng một góc máy, đều căn theo một `layout.json`.
- Nét khắc là mask được vẽ real-time. Shader SkSL dùng mask đó để "đục" lớp vỏ: thấy thành vết cắt có độ dày (thịt bí), thấy lòng bí và ngọn nến bên trong, sáng tràn ra ngoài.
- Cái "wow" nằm ở parallax hole. Mép trong của lỗ khắc chính là mask dịch đi một đoạn theo góc nghiêng (gyro) nhân với độ dày vỏ. Pixel nằm trong lỗ ngoài nhưng ngoài lỗ trong là thành vết cắt, còn nằm trong cả hai là nhìn xuyên vào trong. Nghiêng máy thấy rõ vỏ dày thật, như 3D.
- Reanimated làm gyro, các phase (khắc, thắp, sáng, dơi), spring cho mảnh vỏ rơi, đồng hồ frame cho hạt và dơi. Thêm haptic khi khắc.

**Vì sao chọn cách này.** Render 3D real-time một quả bí bị khắc tự do (boolean mesh) rất khó và dễ xấu. Blender cho ánh sáng và chất liệu đẹp, còn shader 2.5D cho cảm giác 3D khi nghiêng mà vẫn chạy 120Hz. Cách này cũng dùng lại được kinh nghiệm và pipeline của `goku-vs-frieza`.

### Stack

Giữ y như `../goku-vs-frieza/app/package.json`: Expo SDK 58, RN 0.88.1, `react-native-skia` 3.8.x, Reanimated 4.7.1 + worklets 0.13, gesture-handler 3.3, expo-haptics, expo-dev-client. Không cần `react-native-webgpu` (dự án này không có video). Phải chạy dev build, không dùng Expo Go. Blender 5.2.2 ở `/Applications/Blender.app`, chạy headless bằng `-b -P`; dùng MCP for Blender để soi khi đang kết nối. FFmpeg dùng cho promo.

**Asset 2D: được tự sinh bằng Codex, không cần hỏi.** Dùng cho bầu trời và trăng, texture vỏ bí, thớ thịt bí (`flesh.png`), gỗ thềm, tường, sprite vụn và hạt bí, logo hoặc chữ cho end card, concept để chốt art direction trước khi dựng Blender:

```sh
codex exec --skip-git-repo-check -s workspace-write "Generate <mô tả>, no text. Save it as <tên>.png in the current directory and print its absolute path."
```

Nếu Codex không lưu được file thì lấy ảnh ở `~/Library/Application Support/orca/codex-accounts/*/home/generated_images/`. Nén ảnh trước khi đưa vào `app/assets` hoặc `blender/textures`. Texture dùng trong Blender phải lặp được (tileable) hoặc được chiếu (project) cho khớp góc máy.

---

## 1. Art direction

- Tông: "cozy spooky", ấm áp chứ không kinh dị. Bán thực, như một khung hình phim ngắn hoạt hình. Không máu me.
- Bảng màu: đêm chàm `#141a33`, sương xanh xám `#3b4a6b`, trăng `#e8f0ff`, bí ngô `#f07a1a` chuyển sang `#b34a0c` ở rãnh múi, thịt bí `#f6c56b`, lửa nến `#ffd27a` → `#ff9a2e`, cuống xanh rêu khô `#5b5a2e`.
- Quả bí: tròn hơi dẹt, 10–12 múi rãnh sâu, vỏ sần nhẹ, có vết trầy, cuống cong xoắn. Chiếm khoảng 55% bề ngang màn hình, đặt ở 1/3 dưới.
- Nền: bậc thềm gỗ cũ, chân tường nhà và một khung cửa tối, bầu trời có trăng tròn sau mây mỏng, có thể thêm vài cây khô viền khung. Đèn hiên treo phía trên bên trái (trạng thái trước khi thắp).
- Hai trạng thái ánh sáng: **trước** (đèn hiên ấm + trăng lạnh) và **sau** (chỉ còn trăng mờ và ánh nến).

## 2. Trải nghiệm và storyboard clip

| Giây | Cảnh | Tương tác / hiệu ứng |
|---|---|---|
| 0–2 | Bậc thềm, bí chưa khắc, sương trôi | Parallax nhẹ khi nghiêng, đom đóm rất thưa |
| 2–9 | Khắc mắt trái, mắt phải, mũi tam giác, miệng răng cưa | Có vệt dao theo ngón tay. Nhấc tay thì hình khép lại, mảnh vỏ sụp vào trong, vụn và hạt bí bắn ra, kèm haptic |
| 9–11 | Kéo que diêm vào miệng bí | Đèn hiên tắt, tối hẳn 0,3s, nến bùng lên kèm rung mạnh. Ánh sáng nổ ra qua các nét khắc |
| 11–14 | Nghiêng máy | Thành vết cắt lệch theo góc nhìn, lửa nghiêng, tia sáng xoay trong sương, bóng mặt trên thềm dịch theo |
| 14–16 | Dơi ùa ra từ miệng bí | Khoảng 30 con dơi vỗ cánh bay về phía camera, rung màn hình nhẹ |
| 16–18 | End card (làm trong promo, không làm trong app) | |

UI trong app tối giản: một tiêu đề nhỏ phía trên. Phía dưới có nút Undo, nút Reset và vài stencil (Classic, Spooky, Cat) để chạm vào là tự khắc. Que diêm nằm ở góc dưới phải, kéo vào bí là thắp. Sau khi thắp thì UI mờ dần đi.

## 3. Thiết kế khắc (carve)

- **Vùng khắc được:** chỉ trên mặt trước. Blender xuất `carvable.png` là vùng có normal hướng về camera (n·v > ~0,45) và chừa cuống. Nét vẽ ra ngoài vùng này thì bị cắt bỏ.
- **Nét vẽ:** Gesture Pan chạy trên UI thread, làm mượt điểm (Catmull-Rom hoặc trung bình trượt) rồi dựng `SkPath`. Trong lúc kéo, vẽ vệt dao: đường khía tối mảnh có highlight sáng một bên.
- **Khi nhấc tay:**
  - Đầu và cuối nét gần nhau (< ~40pt) hoặc nét tự cắt nhau thì khép path và fill. Đó là một lỗ khắc.
  - Nét hở thì thành rãnh mảnh (stroke ~5pt), cũng cắt xuyên.
  - Hình quá nhỏ (diện tích < ngưỡng) thì bỏ, kèm một haptic "lỗi" rất nhẹ.
- **Mask:** một offscreen surface khoảng nửa độ phân giải vùng bí (khoảng 600×600). Mỗi lần thêm lỗ, vẽ path đã fill vào surface rồi chụp ảnh làm uniform image cho shader. Chỉ vẽ lại khi có thay đổi. Kèm một bản mask đã blur (cho glow, độ trong mờ của vỏ, bóng in trên thềm) tính cùng lúc. Undo bằng cách vẽ lại từ danh sách path.
- **Mảnh vỏ sụp:** lúc khép lỗ, cắt ảnh vỏ theo path (clip + snapshot) thành một mảnh riêng. Mảnh đó lún vào trong: scale 1 → 0,85, tối dần, rơi xuống vài pt, xoay nhẹ, mờ trong ~350ms bằng spring. Lỗ hiện ra ngay phía sau.
- **Vụn và hạt:** dùng Skia Atlas với sprite sheet 16 biến thể (miếng thịt bí, hạt bí, sợi xơ). Tối đa ~200 hạt, mô phỏng trong `useFrameCallback` (trọng lực, xoay, nảy trên thềm, mờ dần). Sinh hạt dọc theo mép lỗ lúc mảnh vỏ sụp.
- **Haptic:** mỗi ~18pt nét dao gọi `selectionAsync` (cảm giác cưa), lúc mảnh vỏ sụp gọi `impactAsync(Light)`, lúc thắp nến gọi `impactAsync(Heavy)` rồi `notificationAsync(Success)`, lúc dơi bay ra là chuỗi Light. Gọi từ worklet qua `scheduleOnRN` và có throttle.

## 4. Shader ghép (composite.ts)

Thứ tự lớp, từ sau ra trước:

1. **Nền:** trộn `bg_lit` và `bg_dark` theo `porchLight`. Cộng thêm bóng mặt in trên thềm (xem bên dưới).
2. **Lòng bí:** trộn `interior_unlit` và `interior_lit` theo `candle`. Ngọn lửa procedural (SkSL noise, hình giọt nước, lõi trắng vàng, viền cam) đặt ở `layout.candle`, nghiêng ngược hướng gyro, cường độ chập chờn theo fbm thời gian (2 tần số + giật nhẹ ngẫu nhiên).
3. **Vỏ với parallax hole:**
   - `o = (tilt.xy * k + normal.xy * k2) * thickness`, với thickness khoảng 10–14px ở độ phân giải mask.
   - `outer = mask(uv)`, `inner = mask(uv + o)`.
   - `outer && inner` thì thấy lòng bí. `outer && !inner` thì thấy thành vết cắt: texture `flesh` (xơ thớ dọc), tô theo hướng của `o` (cạnh hướng về nến sáng hơn khi `candle` lên, có rim cam nóng). Không thuộc `outer` thì là vỏ: trộn `skin_lit` và `skin_dark`.
   - Độ trong mờ của vỏ: khi nến sáng, vỏ gần mép lỗ ửng cam (`blurMask * candle * warm`, mạnh hơn ở rãnh múi nơi vỏ mỏng).
   - Mép lỗ có một đường AO tối mảnh để lỗ có chiều sâu.
4. **Tia sáng (god rays):** radial blur của `(mask * interiorBrightness)` hướng ra từ vị trí nến, 24–32 tap, vẽ ở nửa độ phân giải rồi cộng (add) lên trên, nhân với mật độ sương.
5. **Sương:** fbm 2 lớp trôi ngang, dày ở dưới, được ánh nến (theo god rays) và đèn hiên chiếu sáng.
6. **Bóng mặt in trên thềm:** với pixel thuộc vùng thềm trước quả bí (`ground.png` từ Blender), map ngược về toạ độ mask bằng một phép biến đổi phối cảnh đơn giản (lật dọc, ép dẹt theo chiều sâu, giãn theo khoảng cách) rồi lấy blurMask (blur tăng theo khoảng cách). Cộng màu nến. Bản nâng cấp: Blender bake sẵn `projection.exr` (UV của mask cho từng pixel thềm, tính theo tia từ nến).
7. **Grade:** vignette, bloom rẻ (blur 1 lần của phần quá sáng), hạt film rất nhẹ, chromatic rất nhẹ lúc thắp nến.

Uniform điều khiển: `time`, `tilt` (vec2), `porchLight` 0–1, `candle` 0–1 (có overshoot lúc bùng), `flicker`, `shake`.

## 5. Blender

Mọi thứ dựng bằng script để chạy lại được (làm giống `goku-vs-frieza/blender/scripts`):

- `build_scene.py`:
  - **Bí ngô:** UV sphere ép dẹt, rãnh múi `r *= 1 - a·|sin(n·φ/2)|^p`, cộng noise displacement nhẹ, solidify thành vỏ rỗng dày khoảng 1,2cm. Cuống là curve xoắn có bevel. Vật liệu Principled: màu theo rãnh (bake từ AO và độ cong), roughness biến thiên, chút subsurface.
  - **Nến:** nến tealight trong lòng bí và một point light ấm.
  - **Cảnh:** thềm gỗ (2 bậc), chân tường, khung cửa, trăng (emission), bầu trời (texture vẽ tay sinh bằng Codex nếu cần), đèn hiên (area light ấm) cùng một sun lạnh làm trăng.
  - Camera: phối cảnh nhẹ (~50mm), tỉ lệ dọc 1320×2868 = 440×956 pt @3x (iPhone 17 Pro Max), quả bí ở 1/3 dưới.
- `render_passes.py`, EEVEE (Cycles cho các pass cần chất lượng nếu đủ thời gian):
  - `bg_lit.jpg`, `bg_dark.jpg`: cảnh không có bí (bí tắt camera ray nhưng vẫn đổ bóng tiếp đất).
  - `skin_lit.png`, `skin_dark.png`: RGBA, chỉ vỏ ngoài và cuống.
  - `interior_lit.png`, `interior_unlit.png`: nửa trước vỏ tắt camera visibility, nhìn thấy lòng bí (thành trong có xơ, hạt bám, đáy), nến tắt hoặc sáng. Lớp lửa vẽ procedural trong app nên không render lửa.
  - `normal.png` (normal theo không gian camera, mã hoá 0–1), `carvable.png`, `ground.png` (mask vùng thềm trước bí), `flesh.png` (texture thớ thịt bí lặp được).
  - Tất cả crop theo một khung vuông quanh quả bí (trừ nền). Vị trí khung, toạ độ nến, tâm miệng (nơi dơi bay ra) ghi vào `app/assets/scene/layout.json`.
- `sprites.py`: render sprite sheet `bats.png` (dơi silhouette vỗ cánh 8 frame, rim light cam) và `chunks.png` (16 vụn hoặc hạt).
- Xuất ảnh ở @2x so với logical point, nén (pngquant cho PNG, JPG chất lượng ~85 cho nền).

## 6. Cấu trúc thư mục

```
pumpkin-carve/
  PLAN.md  README.md
  blender/scripts/   build_scene.py  render_passes.py  sprites.py  promo.py
  blender/textures/
  tools/             build.sh (Blender → app/assets)  promo.sh (quay simulator → clip 4:3)
  app/               Expo SDK 58
    src/scene/PumpkinScene.tsx      Canvas, các lớp, phase
    src/carve/useCarveGesture.ts    pan, làm mượt, khép path, clamp vùng khắc
    src/carve/useCarveMask.ts       offscreen mask + blurMask, undo
    src/carve/PoppedPiece.tsx       mảnh vỏ sụp
    src/shaders/composite.ts  godrays.ts  fog.ts  flame.ts
    src/fx/Particles.tsx  Bats.tsx  Match.tsx
    src/state/phase.ts              idle → carving → lighting → lit → bats
    src/demo/script.ts              nét khắc dựng sẵn + tilt giả cho chế độ demo
  render/  versions/
```

## 7. Chế độ demo và clip X

- `EXPO_PUBLIC_DEMO=1`: app tự chạy đúng storyboard ở mục 2. Nét khắc phát lại từ danh sách điểm vẽ tay (tốc độ như người thật, có chấm tròn "ngón tay ảo" mờ). Que diêm tự kéo. Simulator không có gyro, nên `tilt` chạy theo đường cong lập sẵn (lắc chậm sang trái rồi sang phải sau khi thắp). Bản dev có thêm kéo hai ngón tay để giả lập nghiêng.
- `tools/promo.sh`: chép và chỉnh từ `../goku-vs-frieza/tools/promo.sh` và `blender/scripts/promo.py`. Khung 4:3, 60fps, mockup iPhone viền titanium, nền gradient đổi màu theo đoạn (tím đêm → cam → tím). Chữ lớn phía sau điện thoại: "CARVE" → "LIGHT" → "BOO". End card có logo "Pumpkin Carve", tagline "Carved with your finger. Lit by Skia.", credits "Expo · React Native · Skia · Reanimated · Blender", và "by Hoa Hoang · @novahoangdev". Status bar 9:41. Bản quay simulator phải conform sang CFR theo pts của container trước khi dựng, giữ tốc độ gần 1.0x, không cross-dissolve hai cảnh không khớp nhau.
- Kèm một ảnh xem nhanh (sheet 6 khung) và bản nháp caption X theo mẫu: "React Native can carve a jack-o'-lantern 🎃✨", một câu pitch, các dòng "Expo @expo / Skia @wcandillon / Reanimated @swmansion", rồi một dòng "Follow along…".

## 8. Thứ tự làm (mỗi mốc phải quay được)

| Mốc | Nội dung | Xong khi |
|---|---|---|
| **M0** | Khởi tạo app (copy cấu hình từ Goku), Blender dựng bí + nền, render pass bản preview, `layout.json`, scene hiển thị đúng | Thấy bậc thềm và quả bí trên simulator |
| **M1** | Khắc: gesture, mask, parallax hole, thành vết cắt, mảnh vỏ sụp, haptic | Khắc được mặt và nghiêng thấy độ dày vỏ |
| **M2** | Thắp: nến, lửa, lòng bí sáng, vỏ trong mờ, god rays, sương, bóng in trên thềm, tắt đèn hiên | Khoảnh khắc thắp nến nhìn "wow" |
| **M3** | Chế độ demo, quay và dựng clip promo, ảnh xem nhanh, caption. **Đây là bản đăng X tối nay** | Có file clip |
| **M4** | Dơi, vụn và hạt bí, que diêm kéo được, stencil, đom đóm, render final chất lượng cao, quay lại clip | Clip bản 2 |
| **M5** | Âm thanh (dao, lửa bùng, dơi; tổng hợp bằng numpy như Goku hoặc chỉ ghép trong promo), đo hiệu năng trên máy thật | |

Nếu M0–M2 nhanh thì làm dơi (M4) trước khi quay M3, vì đó là cái kết mạnh của clip.

## 9. Rủi ro và cách xử lý

- **API offscreen surface của Skia v3 (Graphite) trên UI thread:** kiểm tra trước trong M1. Nếu không ổn thì dựng mask bằng `Picture` (`Skia.PictureRecorder`) rồi `makeImageFromPicture` hoặc dùng `drawAsImage`. Phương án cuối là gửi tối đa ~16 path vào shader dưới dạng SDF đơn giản.
- **Hiệu năng:** god rays và bloom chạy ở nửa độ phân giải. Mask chỉ vẽ lại khi có thay đổi. Hạt dùng Atlas (một draw call). Đo trên simulator trước, iPhone thật sau.
- **Simulator không có gyro:** dùng tilt giả trong chế độ demo và hai ngón tay trong bản dev.
- **Nét khắc xấu do vẽ tay:** chế độ demo dùng các stencil dựng sẵn, đẹp. Người dùng thật có làm mượt và khép path tự động.
- **Render Blender lâu:** M0 dùng EEVEE 50%, final mới dùng độ phân giải đầy đủ (giống `PREVIEW=1 tools/build.sh` của Goku).

## 10. Mặc định đã chọn (đổi được)

- Tên hiển thị "Pumpkin Carve", bundle id `dev.hoanghoa.pumpkincarve`.
- Thiết bị quay: simulator riêng của dự án "Pumpkin 17 Pro Max" (iPhone 17 Pro Max, iOS 27.0,
  UDID `CA7F5A01-D288-47E0-9CED-0EFBED4178D1`), portrait, màn 1320×2868 px = 440×956 pt. Không dùng sim 17 Pro cũ.
- Chỉ iOS. Không tạo repo git hay push khi chưa hỏi.
