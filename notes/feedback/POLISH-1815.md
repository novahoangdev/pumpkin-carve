# Polish 18:15: xem từ `render/preview/rec.png`, `stills.png`, `notes/light/v2-before-after.jpg`

## Lịch chốt (đăng X lúc 23:00)
- **21:00** dừng thêm tính năng. Sau mốc này chỉ sửa lỗi và tinh chỉnh nhỏ.
- **21:15 chậm nhất** bắt đầu quay bản cuối 120 fps và dựng promo. Promo hiện chỉ đạt khoảng 37 khung/phút, mất khoảng 55 phút, nên không được bắt đầu muộn hơn.
- **22:15** có bản X 60 fps, ảnh xem nhanh và caption.
- **22:30** giao cho anh Hoa.
- Bản v4b đang dựng là bản dự phòng: phải luôn có một clip đăng được.

## 1. Mặt bí khổng lồ trên tường nhà: SAI VẬT LÝ, bỏ hoặc thay (LIGHT + agent chính)
- Lỗ khắc quay về phía camera, còn bức tường nằm **sau** quả bí. Ánh nến qua lỗ khắc không thể in lên tường đó.
- Ngoài ra mặt in trên tường sáng hơn cả quả bí, và bị cắt cứng theo mép tường và cửa, nên trông như hình dán. Người xem kỹ sẽ thấy giả ngay.
- Thay bằng 2 thứ đúng vật lý:
  - (a) **Quầng ấm rất nhẹ** hắt lên tường và cửa phía sau, do ánh xuyên qua vỏ bí và hắt từ sàn. Mềm, không có hình mặt.
  - (b) **Mỗi lần sét**, ánh chớp từ ngoài trời (bên trái) đổ **bóng đen sắc** của quả bí (và mèo, nếu đang ngồi trên lan can) dài trên tường và cửa bên phải, rồi tắt theo đường cong chớp. Bóng thật nên rất "điện ảnh".
- Mặt cười khổng lồ chỉ nên có trên **sàn phía trước**, nơi ánh sáng thật sự đi tới.

## 2. Ánh mặt cười trên sàn (LIGHT): v2 đã tốt hơn, cần thêm
- Mắt đang là hai vệt tròn. Phải ra **hình tam giác** có mép mềm, kiểu sắc gần, mềm xa.
- Miệng phải có răng.
- Lõi đang vàng chanh cháy sáng. Hạ xuống màu cam hổ phách, có tone-map, và không được sáng hơn chính lỗ khắc.
- Vân gỗ và khe ván phải lộ ra trong vùng sáng.

## 3. Dơi xếp chữ HAPPY HALLOWEEN khó đọc (CAT nhận `Bats.tsx` vì tab FX đã đóng)
- Chữ nhỏ, lẫn vào mặt trên tường và nền tối.
- Xếp chữ ở vùng trời và trăng phía trên-trái, nơi có nền sáng để bóng dơi đen nổi lên. Chữ to khoảng 80% bề ngang, dày dơi hơn.
- Viền dơi có ánh trăng và ánh cam, giữ khoảng 1,2 s rồi mới tan về phía camera.

## 4. Vụn bí quanh chân bí (CAT nhận `Particles.tsx` / `pfx_atlas.ts`)
- Vụn đang rải thành một vành đều quanh quả bí, trông như confetti.
- Cần ít hơn, dồn phía trước (nơi mảnh khắc rơi ra), cỡ khác nhau, có mảnh dính ướt, và bớt bão hoà màu.

## 5. Tốc độ dựng promo (PERF)
- 37 khung/phút là quá chậm cho vòng cuối. Tìm cách giảm xuống dưới 20 phút mà không mất chất lượng, rồi ghi vào notes/perf.md cho agent chính:
  - render mockup một lần rồi ghép video bằng ffmpeg,
  - hoặc chạy song song nhiều tiến trình,
  - hoặc dùng Eevee,
  - hoặc hạ số mẫu ở các khung không cần.
