# MOON — trăng tròn (FEEDBACK-2300 mục 1), 31/10

**Không cần sửa PumpkinScene.tsx**: không thêm uniform, không thêm lớp vẽ. Metro tự nạp.

## Nguyên nhân
Trăng nằm trên phông trời phẳng (sky.jpg) → trong ảnh gốc nó tròn, nhưng theo hướng thế giới nó là elip; dựng lại theo
góc nhìn khác (ngước lên, nhìn quanh, intro) thì elip lộ ra và nghiêng.

## Cách sửa
- File mới `app/src/shaders/moon.ts` → `MOON_SKSL` với `moonSprite(xy, w)`: chiếu hướng trăng (thế giới, tính từ tâm trăng đo
  trên bg_dark.jpg (63.33, 106.67) pt, R = 44 pt, qua CAM) qua basis xem `vX/vY/vZ/vf` (chỉ xoay, ở vô cực nên mắt dịch không ảnh
  hưởng) → tâm sprite trên màn; bán kính `tanR·vf/z` (khớp ảnh gốc lúc nghỉ); xoay theo hướng "lên" của thế giới tại trăng.
- Sprite **tròn trên màn**, kết cấu = đĩa trăng + quầng + mây sát trăng đọc từ ảnh gốc (ở đó trăng tròn), bán kính 1,45 R, mép
  hoà 1,2–1,45 R → phủ kín trăng gốc bị méo (không cần pass xoá). Chỉ thay pixel có độ sâu là trời (`w` 60→140 m), nên mái,
  cột, cây vẫn che trăng đúng.
- `background.ts`: include `MOON_SKSL`, sau khối `wb` trộn `bgDark`/`bgLit` tại toạ độ sprite (chỉ đọc lớp đang cần, chỉ trong
  vùng sprite: thêm ≤ 2 lần đọc ảnh cho vài nghìn pixel). Mưa, sương (atmos), sét vẫn vẽ đè lên như cũ.
- `atmos.ts` không đổi (MOON ở đó là hướng ánh sáng của Blender, không phải đĩa trăng nhìn thấy).
- Kiểm: SkSL canvaskit OK; sim EA6AE9EA (Debug, Metro 8094) chụp intro + nhìn trái + nghỉ: trăng tròn, không còn viền elip
  (`notes/feedback/moon-fixed.png`: trái = cùng góc với moon-warp.png).

## Tuỳ chọn (cần PumpkinScene): mây trôi ngang qua trăng
Hiện mây quanh trăng đứng yên theo trăng (đúng phối cảnh). Muốn mây trôi: thêm `uniform float mT;` vào moon.ts, `bgU` thêm
`mT: time.value`, rồi dịch toạ độ kết cấu phần mây (`o.x += mT * 1.5` ngoài đĩa). Chưa làm vì phải đụng PumpkinScene.
