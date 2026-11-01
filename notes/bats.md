# BATS — FEEDBACK-2300 mục 2 và 5 (23:xx)

Chỉ sửa `app/src/fx/Bats.tsx` và `app/src/fx/Particles.tsx`. Không cần sửa gì ở PumpkinScene.tsx hay demo/script.ts (props, `batLook`, `BAT_SKY`, mốc thời gian giữ nguyên).
tsc và eslint sạch.

## (5) Dơi bay tới từ bên ngoài, không còn "đám lửa"
- Đám "lửa hoặc khói" trong `bats-fire-burst.png` thực ra là 720 con dơi chui ra từ miệng bí. Chúng chồng lên nhau sát ngọn nến, và lớp tô cộng sáng (pass B, ánh nến) làm cả đám trông như ngọn lửa có mép rách.
- Pha 1 mới: mỗi con bay theo một đường cong Bézier bậc 2 từ ngoài sân vào, rồi lò xo cũ (giữ nguyên) đưa nó về đúng chỗ trong chữ.
  - Điểm xuất phát: khoảng 75% bay ra từ sân tối sau lan can (x −4,6…−0,6, y 3,6…6,4, z 0,7…2,2 m; phần lớn đi vào từ mép trái khung), khoảng 25% từ bầu trời xa (y 8…14, z 3,4…5,8).
  - Đàn sà qua hiên về phía ống kính, luôn cao trên đỉnh bí (z ≥ 0,45 m), vòng lên rồi mới rẽ vào chữ.
  - Khoảng 25 con (`skim`) lướt cách ống kính 0,2–0,26 m, lệch ngang 7–13 cm.
  - Đã kiểm bằng tính toán: ngoài nhóm `skim`, không con nào tới gần mắt hơn 0,44 m.
- Mọi con đã vào chữ chậm nhất ở giây 2,0 (trễ 0–0,55 s + bay 1,0–1,45 s). Vì vậy chữ vẫn xếp xong lúc 3,0, giữ tới 4,2 rồi tan ra như bản đã duyệt. Phần xếp chữ, giữ chữ và tan ra không đổi.
- Không còn con nào xuất phát từ quả bí. Hằng `MOUTH` đã xoá. Dơi hiện dần trong 0,3 s đầu khi còn ở xa, thay cho việc "nở to" ở miệng bí.
- Hiệu năng: chỉ thêm vài phép tính số mỗi con, không cấp phát gì. Mảng mới `__fxB1` (camera lúc dơi xuất hiện) cấp một lần trên UI runtime.
- Âm thanh: `BAT_TIMES.emergeEnd` (1,25) giờ nên hiểu là "đàn đang sà qua hiên". Dơi lướt sát ống kính ở khoảng 0,9–1,6 s sau `bats`. Nếu `synth_audio.py` có tiếng "phụt ra từ bí" ở 24,9 thì nên đổi thành tiếng cánh vỗ to dần từ xa, có tiếng vút ở khoảng 25,9–26,4.

## (2) Vụn bí
- Bỏ hẳn vụn dính trên mặt bí (`stuck`, trước đây 22% số vụn thịt nằm lại dưới mép lỗ, chính là các "cục sỏi nâu" ở mũi và miệng).
- Bỏ hạt bí và xơ ruột (các hạt dính quanh mắt). Giờ chỉ còn vụn thịt và giọt nước bí.
- `PER_BURST` giảm từ 18 xuống 9. Vụn thịt nhỏ lại: 3,5–10 mm (trước đây tới 26 mm).
- Vụn sinh cách vỏ 1 cm, bắn về phía camera ít nhất 0,24 m/s để vượt qua phần bụng phình phía dưới, gần như không bị hất lên. Vì vậy vụn rơi ngay xuống sàn và nằm lại trước chân bí.
- Màu: thịt bí cam vàng tươi (nhân khoảng 1,15 / 0,86 / 0,42, đáy sáng nâng lên) thay cho màu xám trung tính từng làm sprite thành nâu. Ánh ướt lấp lánh giữ nguyên.
- Sim riêng (8B860304): sau khi khắc, mặt bí sạch, chỉ còn các chấm cam nhỏ trên sàn trước chân bí.

## Lưu ý cho agent chính
- Metro hiện tại báo lỗi SkSL `symbol 'MOON_D' was already defined` trong `shaders/candleLight.ts` (dòng 226, có lẽ do phần trăng hoặc LIGHT đang làm dở).
- Trên sim của tôi, bản demo dừng ở khung nghỉ sau đoạn nhìn quanh: không nhảy, không thắp nến, không tới đoạn dơi. Vì vậy tôi chưa chụp được màn dơi trên sim. Đường bay đã được kiểm bằng tính số.
- Khi lỗi trên được sửa, nên xem lại khoảng 24,9–27 s.
