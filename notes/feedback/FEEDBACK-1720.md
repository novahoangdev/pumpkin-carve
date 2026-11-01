# Feedback anh Hoa 17:20: bóng và ánh nến trên sàn phải thật hơn; quay 120 FPS

Ảnh: `shadow-fake.png` (cùng thư mục).

## 1. Bóng và ánh nến trên sàn (giao LIGHT; LIGHT nhận luôn `app/src/shaders/candleLight.ts` từ ATMOS)

Đang sai:
- Ánh mặt cười trên sàn bị **xếp thành 3–4 dải ngang chồng nhau**, như nhiều bản sao lệch nhau. Nguyên nhân gần chắc là 16 nguồn điểm xếp theo 3 vòng cố định cùng điểm `hot` và `flameW` trong `candleLight.ts`: mỗi vòng nguồn sinh ra một bản sao hình miệng.
- Dải sáng có vệt ngang giống răng cưa hoặc độ phân giải thấp của `lightMap`.
- Bóng quả bí là một vệt tối hình elip, mép cứng, đậm đều. Không có bóng tiếp xúc ở chân bí.

Muốn đạt:
- **Ánh mặt cười trên sàn là một hình duy nhất** đúng phối cảnh: dài ra theo hướng xa bí, có đủ mắt, mũi, miệng.
  - Mép sắc ở gần bí, càng xa càng mềm (bán ảnh tăng theo khoảng cách, đúng như nguồn sáng có kích thước).
  - Độ sáng giảm theo 1/d².
- Làm mềm bằng **lấy mẫu nhiều nguồn ngẫu nhiên liên tục** (khoảng 48–96 mẫu theo blue-noise hoặc Fibonacci trên nắp và thành trong, xoay mẫu theo pixel), không dùng vòng cố định.
  - Map chỉ tính một lần mỗi khi mask đổi, nên tốn thêm mẫu cũng được.
  - Thêm một lần blur nhẹ theo bán ảnh nếu cần. Tăng `lk` nếu map đang thô.
- Ánh sáng **ăn vào vân gỗ**: nhân với albedo gỗ, khe giữa các ván tối hơn, và sàn ướt có một vệt bóng loáng (specular) ấm theo góc nhìn. Đừng chỉ cộng một lớp màu cam phẳng.
- **Chập chờn theo ngọn lửa** mà không phải tính lại map: dịch và co giãn rất nhẹ, kèm độ sáng dao động theo nhiễu (cùng nhịp với lửa).
- **Bóng quả bí:**
  - Có bóng tiếp xúc rất tối và hẹp ngay chân bí (AO).
  - Bóng đổ từ đèn hiên và trăng mềm dần theo khoảng cách, không còn mép elip cứng.
  - Sau khi thắp, quanh chân bí có thêm quầng ấm hắt từ lòng bí qua lỗ khắc.
  - Nếu cần sửa pass Blender (`shadow_lit` / `shadow_dark`) thì ghi đề xuất cho agent chính, hoặc làm bóng bằng shader.
- Kiểm ở khung nghỉ mới, lúc nghiêng máy, và lúc sét. Giữ 120 fps.

## 2. Quay 120 FPS (giao agent chính + PERF)

Thực tế máy:
- Màn Mac đang ở **60 Hz** (4K, 60.00Hz), và `tools/simrec.sh` quay theo thời gian thật. Vì vậy simulator không cho ra 120 khung khác nhau mỗi giây khi quay trực tiếp.
- App đã bật `CADisableMinimumFrameDurationOnPhone`.

Cách quay 120 fps thật, mượt tuyệt đối: **quay chậm rồi nén thời gian.**
- Thêm `EXPO_PUBLIC_TIMESCALE` (ví dụ 0.5 hoặc 0.25). **Mọi** chuyển động phải lấy từ một đồng hồ demo đã nhân hệ số này, gồm:
  - kịch bản demo, camera, nét khắc, mưa, sét, hạt, dơi, lửa, nhún nhảy,
  - mọi `withSpring` / `withTiming` dùng trong demo (đổi sang hàm của đồng hồ demo, hoặc nhân duration và cấu hình spring theo hệ số).
- Quay simulator ở 60 fps thời gian thật với timescale 0.5: được 120 khung cho mỗi giây demo.
  - `ffmpeg -i raw.mov -vf "setpts=0.5*PTS" -r 120 …`, rồi CFR 120.
  - Timescale 0.25 cho dư khung, rồi lấy 120.
- Âm thanh dựng riêng bằng `synth_audio.py` theo mốc thời gian, không bị ảnh hưởng.
- Vì mỗi khung có gấp đôi thời gian để render, cách này còn **xoá luôn khựng** của simulator.
- Kiểm bằng `mpdecimate`: bản 120 fps cuối phải có 120 khung khác nhau mỗi giây ở mọi đoạn.

Xuất file:
- Bản master: `render/promo/pumpkin-carve-demo-120.mp4` (120 fps).
- Bản đăng X: X chỉ phát tối đa 60 fps, nên xuất thêm bản 60 fps lấy cách khung từ master (không blend). Khung 60 fps nào cũng là khung thật nên vẫn rất mượt.
