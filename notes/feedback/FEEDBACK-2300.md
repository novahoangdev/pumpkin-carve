# Feedback anh Hoa 23:00, sau khi xem clip v5s: sửa xong rồi quay lại bản cuối

Ảnh nằm trong thư mục này.

1. **Mặt trăng bị méo** (`moon-warp.png`), giao ATMOS
   - Khi camera ngước lên hoặc nhìn quanh, trăng thành hình elip nghiêng, do bị kéo giãn khi dựng lại ảnh từ ảnh nền và panorama.
   - Sửa: trăng phải luôn tròn. Vẽ trăng thành một sprite riêng, ở vô cực, theo hướng thế giới, chiếu đúng phối cảnh.
   - Xoá trăng khỏi ảnh nền và panorama, hoặc che trăng gốc bằng màu trời. Giữ quầng sáng và mây đi qua trăng.

2. **Vụn bí dính trên mặt quả bí** (`debris-on-face.png`), giao CAT (giữ `Particles.tsx` / `pfx_atlas.ts`)
   - Những cục giống hòn sỏi nâu lơ lửng hoặc dính trên mặt bí, và hạt bí dính quanh mắt, mũi, miệng.
   - Sửa: vụn phải rơi khỏi mặt bí ngay (trọng lực) và nằm trên sàn, không lơ lửng trước mặt bí.
   - Vụn phải là thịt bí màu cam vàng, ẩm, nhỏ, không phải cục đá nâu to. Giảm số lượng.

3. **Thừa chữ trên màn hình** (`extra-title.png`, `extra-buttons.png`), giao agent chính
   - Bỏ tiêu đề PUMPKIN CARVE kèm dòng phụ "carve · tap · look around · light the match", và hàng nút Undo / Reset / Classic / Spooky / Cat.
   - Bỏ ở bản quay và chế độ demo. Cho một cờ `EXPO_PUBLIC_CLEAN=1`, hoặc ẩn hẳn.

4. **Ánh sáng lỗi dưới các mảnh vụn** (`light-under-debris.png`), giao LIGHT
   - Giữa các mảng sáng cam của mặt cười trên sàn có các hình mặt cười màu trắng xám nhạt bị lệch. Có thể là vệt sét xuyên lỗ còn sót lại, hoặc lớp ánh sáng cũ chưa tắt.
   - Sửa: bỏ hẳn bóng ma trắng này. Sàn ngoài vùng sáng cam phải là gỗ bình thường.
   - Kiểm lúc sét và ngoài lúc sét.

5. **Dơi bay ra từ quả bí xấu** (`bats-fire-burst.png`), giao CAT (giữ `Bats.tsx`)
   - Đang có một đám lửa hoặc khói bùng ra từ miệng bí, mép rách như giấy. Trông xấu, phải bỏ hẳn.
   - Theo anh Hoa, dơi bay vào **từ bên ngoài** thì hợp lý hơn.
   - Cách làm: đàn dơi bay tới từ khoảng sân tối hoặc bầu trời phía xa, lượn qua hiên (có đàn lướt sát ống kính), rồi bay lên trời xếp chữ HAPPY HALLOWEEN như bản đã duyệt.
   - Không phát ra gì từ quả bí cả.

## Thứ tự
- Mỗi tab sửa xong thì báo agent chính.
- Agent chính gộp, build Release, quay bằng rec120, rồi dựng promo máy đứng yên (`v5s.json`) ở 60 fps.
- Chỉ dọn thư mục tạm khi đã dựng xong.
