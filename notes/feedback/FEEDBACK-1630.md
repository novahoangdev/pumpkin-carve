# Feedback anh Hoa lúc 16:30, 31/10. Sửa trước khi quay bản cuối

Ảnh nằm cùng thư mục: `fog-layer-bug.png`, `water-fake.png`, `opening-angle.png`.

## 1. Sương bị lỗi layer (`fog-layer-bug.png`), giao cho ATMOS

Khi nhìn sang trái, sương là một dải sáng phẳng, mép trên cứng như cắt bằng thước. Dải này phủ lên chân cột lan can như một lớp dán đè. Cột gần và xa bị phủ đậm như nhau, nên trông giống tấm ảnh dán chứ không phải sương.

Cách sửa:
- Tính sương theo **độ sâu thật** (`bg_depth` / `bg_depth_pano`). Mật độ sương là tích phân sương theo độ cao (`exp(-h/H)`) dọc tia nhìn, từ mắt đến điểm cảnh.
  - Vật gần (cột lan can gần, mép sàn) gần như không có sương.
  - Xa ngoài sân thì sương dày.
- Không có mép cứng nào: độ cao đỉnh sương mờ dần, và nhiễu cuộn của sương neo theo toạ độ thế giới, không theo màn hình.
- Sương phải đứng yên trong không gian khi yaw/pitch thay đổi.
- Sương không được sáng hơn ánh trăng hắt lên nó. Sương ở gần đèn hiên và gần bí (khi đã thắp) thì ấm hơn.
- Kiểm ở yaw −0,66 và +0,62 (hai mốc nhìn quanh trong demo) và lúc nghiêng.

## 2. Nước cần tự nhiên hơn (`water-fake.png`), giao cho ATMOS (+ agent chính nếu phải sửa pass Blender)

Dải sáng xanh dọc chân lan can bị cháy sáng và nhoè thành vệt khói xanh, trông giả. Vệt mưa bắn ở mép sàn là các gạch ngắn đứng yên.

Cách sửa:
- **Bỏ quầng xanh phát sáng.** Sàn ướt nghĩa là gỗ **tối hơn**, bão hoà hơn và có phản chiếu sắc nét theo Fresnel.
  - Phản chiếu gồm trăng, đèn hiên, cửa sổ nhà bên, và ánh bí sau khi thắp.
  - Nhìn càng xiên thì phản chiếu càng mạnh.
- **Gợn mưa rơi:** vòng tròn nhỏ loang ra rồi tắt, trong toạ độ thế giới trên mặt phẳng sàn.
  - Khoảng 15–30 vòng cùng lúc, chỉ ở vùng ướt mép ngoài.
  - Các vòng làm méo phản chiếu bằng normal của gợn.
- Vũng nước có hình dạng không đều (dọc khe ván và mép ngoài), không đặt thành một băng thẳng.
- Thêm chi tiết thật: **giọt nước nhỏ từ mép mái và thanh trên lan can** xuống sàn, mỗi giọt chạm sàn tạo một gợn. Chi tiết rẻ mà nhìn rất thật.
- Hạt bắn tung (splash) nhỏ, sống ngắn khoảng 0,15 s, không có vệt đứng yên.
- Giữ 120 fps: gợn tính trong shader bằng hàm của thời gian, không dùng hạt CPU.

## 3. Mở đầu mới, "động đáo" hơn (`opening-angle.png`), giao cho agent chính (+ FX)

Anh Hoa không thích góc máy hiện tại. Bí nằm nhỏ ở mép phải, nửa dưới khung là sàn trống, phần mái phía trên tối, nên mở app vào nhìn rất phẳng.

### 3a. Khung nghỉ mới (góc máy chính sau intro)
- Góc thấp, ngang tầm quả bí.
- Bí to khoảng 50–55% bề ngang màn hình, đặt **giữa theo chiều ngang**, hơi dưới tâm (khoảng 58% chiều cao).
- Đèn hiên và trăng vẫn nằm trong khung phía trên.
- Bớt sàn trống phía trước.
- Có hai cách làm, agent chính chọn cách nhanh và đúng hơn:
  - (a) Đổi view mặc định (yaw/pitch/zoom, thêm `oy` để hạ mắt).
  - (b) Đặt lại camera Blender, nếu đằng nào cũng đang render lại pass cuối.
- Nếu chọn (a): kiểm toàn bộ toạ độ đang tính theo khung gốc (stencil `CENTER`, `matchTarget`, Dynamic Island, hạt) để vẫn đúng chỗ.

### 3b. Kịch bản intro 0,0 → 3,0 s (khắc vẫn bắt đầu ở 3,2 nên không phải dời mốc nào phía sau)

| t (s) | Hình | Âm thanh / haptic |
|---|---|---|
| 0,0–0,45 | Màn tối gần như đen, chỉ thấy vệt mưa lấp lánh. Camera đang ngước nhìn trăng sau mây (pitch ≈ +0,7, zoom ≈ 1,4) | Mưa, sấm rền xa |
| 0,45 | **Sét mở màn:** chớp 2 nhịp (sáng 70 ms, tối 110 ms, sáng 50 ms). Chữ PUMPKIN CARVE loé lên theo chớp rồi nguội thành màu cam ấm | Sấm nổ, haptic heavy |
| 0,6–2,3 | **Cẩu máy từ trăng xuống:** pitch lia từ +0,7 về khung nghỉ, yaw quay dần về phía bí, zoom 1,4 → 0,85 → 1,25 (đẩy vào), mắt hạ thấp dần (`oy`). Ease-in-out mạnh, nhanh nhất ở giữa, có motion blur nhẹ theo hướng lia lúc nhanh nhất | Gió vụt |
| ≈1,4 | Khi camera lướt qua, **đèn hiên chập chờn 2 lần** | Tiếng tách điện nhỏ |
| ≈1,6 | **Một cơn gió cuốn lá phong** bay ngang sát ống kính (lá tiền cảnh to, mờ do ngoài nét, parallax mạnh) và vài lá trên sàn trượt theo. Phần này giao FX: file mới `app/src/fx/Gust.tsx` | |
| 2,3–2,9 | Camera dừng ở khung nghỉ bằng spring hơi quá đà một chút rồi đứng yên. Quả bí khẽ lắc (squash nhẹ) như vừa bị gió đẩy | Haptic light |
| 3,2 | Bắt đầu khắc như cũ | |

Yêu cầu chung:
- Toàn bộ intro mượt 120 Hz trên 17 Pro Max.
- Không tạo object JS nào mỗi frame trong worklet.
- Motion blur làm rẻ: vài mẫu lệch dọc hướng lia, chỉ bật khi tốc độ lớn.
