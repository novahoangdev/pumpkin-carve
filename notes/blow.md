# BLOW: thổi vào micro để tắt nến (agent BLOW)

Sim riêng "Pumpkin Blow 17 Pro Max" (0DCEAC26-…), Metro 8099 chạy từ sandbox trong scratchpad (bản clone app + expo-audio,
build Debug vào DerivedData riêng). **Chưa đụng** `package.json`, `app.json`, `ios/`, `PumpkinScene.tsx`, `pumpkin.ts` của dự án thật.

## Đã làm (17:30)

Khi nến đang cháy, thổi vào mic:
- **Thổi nhẹ / vừa:** lửa nghiêng mạnh và chao qua lại theo cường độ hơi thổi, gợn nhanh hơn, hơi lùn lại. Ánh nến qua lỗ khắc
  (lòng bí, vệt sáng trên thềm, sương) chập chờn và tối đi theo (nhân vào `flick`, nên mọi shader dùng `candle` đều rung theo).
- **Thổi đủ mạnh khoảng 0,3 s:** nến tắt. Lửa co về bấc trong 0,24 s, rồi tàn đỏ ở bấc hắt ánh đỏ lên lòng bí (các lỗ khắc ửng đỏ rồi
  nguội trong khoảng 1,5 s). Hai dải khói mỏng bay ra từ mép trên hai lỗ cao nhất (thường là hai mắt): đoạn đầu thẳng, sau đó xoắn
  chữ S, nở rộng, tan dần, sống khoảng 3,4 s. Khói nằm trong toạ độ thế giới (m), chiếu qua `basis` nên có parallax đúng khi
  nghiêng hay nhìn quanh. Khói được trăng chiếu, ấm lên khi đèn hiên sáng lại, sáng loé theo sét. Sau đó cảnh tối sầm, chỉ còn
  trăng; 1,7 s sau đèn hiên chập chờn rồi bật lại (`PORCH_BACK_MS`, đặt < 0 để giữ tối). Có haptic medium.
- **Thắp lại:** que diêm hiện lại trên thềm. Chạm vào que diêm thì que tự quẹt, nhấc lên, hạ vào miệng bí và thắp (gọi lại
  `lightUp`). Kéo que diêm như lần đầu cũng được. Dơi chỉ bay lần đầu.

Ảnh (bản Debug trên sim Blow, ghép theo giờ app):
- `notes/blow/sheet.png`: 29,8 (đang cháy) · 30,6 (thổi nhẹ, lửa chao) · 31,6 (thổi mạnh) · 32,6 (tắt, tàn đỏ, khói) · 33,4 (đèn hiên bật
  lại) · 34,2 (que diêm trên thềm) · 36,4 (thắp lại).
- `notes/blow/smoke.png`: cận cảnh dải khói 32,0 → 34,0.

### File (của BLOW)

- `app/src/fx/blowOut.ts`: hook `useBlowOut`, đọc mic, phân tích tín hiệu, kịch bản demo `BLOW_DEMO`, các worklet `blowFlicker`,
  `blowLean`, `emberAt`.
- `app/src/fx/Smoke.tsx`: dải khói (Atlas, tối đa 144 sprite, dùng `pfx_atlas.ts` và sprite khói trong `pfx_match.png`, chỉ đọc).
- `notes/blow/patch.py`: vá `PumpkinScene.tsx` (13 chỗ) và `pumpkin.ts` (7 chỗ) theo chuỗi neo. Script idempotent, không khớp neo nào
  thì dừng và không ghi.
- `notes/blow/test_detector.sh`: kiểm bộ phát hiện offline.

## Agent chính cần làm

### Bước 1: gộp code (chưa cần dependency, chưa cần build lại)

```sh
python3 notes/blow/patch.py app/src/scene/PumpkinScene.tsx app/src/shaders/pumpkin.ts
```

`pumpkin.ts` là file của PERF: patch chỉ thêm 2 uniform (`gust`, `ember`) và vài dòng trong `flameCol` cùng màu lòng bí. Nên báo PERF.

Chưa có expo-audio thì `require("expo-audio")` nằm trong try/catch. Metro coi đây là optional dependency nên bundle vẫn build
(đã thử `expo export:embed` trên bản clone app thật không có expo-audio: OK, tsc và lint sạch). Lúc chạy thì không có mic, không
thổi tắt được, mọi thứ khác như cũ. Chế độ demo không cần mic: hơi thổi chạy theo kịch bản. Đã thử thêm trường hợp JS expo-audio đã
có nhưng native chưa build (bản `.app` hiện tại của agent chính chạy với Metro có expo-audio): không lỗi, demo vẫn tắt và thắp lại đúng.

Patch làm những việc sau (xem `notes/blow/patch.py`):
1. Import `Easing`, `Smoke` và `{ BLOW_DEMO, blowFlicker, blowLean, useBlowOut }`.
2. Gọi `const blow = useBlowOut({ time, candle, porch, litAt, demo: DEMO, onOut })` ngay sau `matchFade`. `onOut` đưa que diêm về
   `MATCH_REST`, `burn = 0`, rồi hiện lại (`matchFade` → 0 sau 0,9 s).
3. `lightUp`: cho thắp lại khi `blow.outAt >= 0` và gọi `blow.relit()`. Dơi chỉ đặt lịch khi `batsAt < 0`.
4. Thêm worklet `strikeMatch()` (đặt trước `useFrameCallback`): que diêm tự bay vào miệng bí theo cung trong 0,82 s rồi `lightUp()`.
5. Demo: lúc `BLOW_DEMO.relight`, ngón tay ảo chạm que diêm rồi gọi `strikeMatch()`.
6. Gesture: pan que diêm được phép khi nến đã tắt; tap vào que diêm khi nến đã tắt thì gọi `strikeMatch()`.
7. `resetAll`: `blow.relit()`.
8. `flick *= blowFlicker(t, gust)`; `pU.lean += blowLean(t, gust)`; `pU.gust`, `pU.ember`.
9. `<Smoke outAt={blow.outAt} time={time} basis={basis} holes={bursts} porch={porch} storm={storm} />` ngay sau `<Gust layer="scene" …/>`
   (trước mưa).

### Bước 2: thêm mic (khi sẵn sàng build native)

```sh
cd app
npx expo install expo-audio          # → "expo-audio": "~58.0.10"
```

Trong `app.json`, thay mục `"expo-audio"` mà `expo install` vừa thêm vào `plugins` bằng:

```json
["expo-audio", {
  "microphonePermission": "Blow into the microphone to blow out the candle.",
  "enableBackgroundPlayback": false,
  "enableBackgroundRecording": false,
  "recordAudioAndroid": false
}]
```

Rebuild native, chọn một trong hai cách:
- **Prebuild:** `npx expo prebuild --platform ios --no-install && (cd ios && pod install)`, rồi build như thường lệ
  (`npx expo run:ios` / xcodebuild). Cách này ghi đè `ios/` theo `app.json`, nên chỉ dùng nếu mọi chỉnh native đều đã nằm trong `app.json`.
- **Sửa tay (nhẹ hơn, giữ nguyên ios/ hiện tại):** thêm vào `ios/PumpkinCarve/Info.plist`
  `<key>NSMicrophoneUsageDescription</key><string>Blow into the microphone to blow out the candle.</string>`, rồi
  `cd ios && pod install` (autolinking tự thêm pod `ExpoAudio 58.0.10`) và build lại.

Sandbox đã build Debug theo cách prebuild: **BUILD SUCCEEDED**. Info.plist có `NSMicrophoneUsageDescription`, không thêm
`UIBackgroundModes`.

## Hơi thổi trong demo (giờ app)

`BLOW_DEMO` trong `blowOut.ts`. Agent chính có thể chuyển nó sang `demo/script.ts` nếu muốn quản lý mốc ở một chỗ.

| t (s) | Việc |
|---|---|
| 30,0–30,75 | thổi nhẹ (0,42): lửa chao, ánh qua lỗ khắc rung, nến không tắt |
| 31,25–31,95 | thổi mạnh, nến tắt ≈ 31,6: lửa co về bấc, tàn đỏ, khói bắt đầu ≈ 31,7 |
| ≈ 33,3 | đèn hiên chập chờn rồi bật lại |
| 34,1–34,4 | ngón tay ảo hiện ở que diêm; chạm lúc 34,4 |
| ≈ 35,22 | que diêm vào miệng bí → `lightUp`: tắt đèn hiên, tối 0,39 s, nến bùng ≈ 35,61 |

- Muốn kết clip trong bóng tối: `BLOW_DEMO.relight = null`.
- Muốn bỏ hẳn đoạn thổi trong demo: dời `puff`/`blow` ra sau lúc clip kết thúc.
- Nghiêng demo (`demoTilt`) chạy lại sau khi thắp lại, vì `litAt` mới.
- Âm thanh cho `synth_audio.py`: tiếng hơi thở nhẹ ở 30,0 · tiếng thổi mạnh ở 31,25 · lửa phụt tắt "fft" ở 31,6 · lách tách tàn ·
  tách công tắc đèn hiên ở 33,3 · quẹt diêm ở 34,45 · nến bùng ở 35,61.

## Phát hiện tiếng thổi

Dùng `expo-audio` `useAudioStream`: PCM thô 16 kHz mono, chia block 32 ms. Phiên âm thanh native dùng `.record` / `.measurement`,
tức không có AGC. Mic chỉ chạy khi nến đang cháy, và bắt đầu 2,5 s sau lúc thắp (`MIC_DELAY_MS`) để hộp xin quyền lần đầu không đè
lên khoảnh khắc nến bùng. Nến tắt thì dừng mic.

Đặc trưng mỗi block:
- **level** (dBFS) so với nền ồn của phòng (nền ồn bám xuống nhanh, lên chậm);
- **tỉ phần biên độ < 300 Hz**: hơi thổi đập vào mic là tiếng ầm tần thấp; "sss"/"shhh" nằm ở dải cao;
- **độ đều**: biên độ dao động trong 160 ms;
- **tính hữu thanh**: tự tương quan của dải cao ở độ trễ 80–400 Hz. Nguyên âm có chu kỳ, hơi thổi thì không. Giá trị này có nhớ khoảng
  250 ms để chặn cả khoảng nghỉ giữa các âm tiết.

Từ đó tính `gust`: hơi thở nào hướng vào máy cũng làm lửa chao, tiếng nói chỉ làm chao ở 25 %. `force`: chỉ tính hơi thổi to,
tần thấp, đều, không hữu thanh. `force > 0,55` cộng dồn đủ 0,3 s thì nến tắt.

Kiểm offline: `notes/blow/test_detector.sh` (chạy đúng hàm `analyse` trong Node, trên âm tổng hợp trộn tiếng ồn phòng):

| mẫu | gust max | force max | giữ đủ | kết quả |
|---|---|---|---|---|
| thổi mạnh 1,4 s (~ −19 dBFS) | 1,00 | 1,00 | 1,12 s | **tắt** |
| thổi ngắn 0,6 s | 1,00 | 0,97 | 0,35 s | **tắt** |
| thở vừa (−33 dB) | 0,79 | 0,09 | 0 | chỉ chao |
| thở nhẹ | 0,12 | 0 | 0 | gần như không |
| nói thường | 0,43 | 0 | 0 | không tắt |
| nói to sát máy (−12 LUFS) | 1,00 | 0,35 | 0 | không tắt (trước khi thêm "hữu thanh" thì bị tắt) |
| "shhh" (dải cao) | 0 | 0 | 0 | không |

**Chưa thử được với mic thật.** Mac mini này không có mic trong. Đầu vào duy nhất là mic Bluetooth 8 kHz của loa Tzumi, và sim
báo `!dev` (AVAudioEngine không mở được thiết bị vào). Ngưỡng hiện chỉnh trên âm tổng hợp. Lần đầu chạy trên iPhone thật nên bật
`EXPO_PUBLIC_BLOW_DEBUG=1` (log `[blow] db … low … voice … force …` ra Metro 4 lần mỗi giây) để chỉnh `BLOW_FORCE` và các
`smoothJS(...)` trong `analyse` nếu cần. `EXPO_PUBLIC_BLOW_MIC=1` buộc dùng mic thật cả trong chế độ demo.

Lưu ý: khi mic chạy, phiên âm thanh ở chế độ `.record`, nên tiếng phát trong app (nếu sau này có) và nhạc của app khác bị tắt cho tới
khi nến tắt. Hiện app không phát âm thanh (âm thanh được ghép trong promo), nên không ảnh hưởng.

## Hiệu năng

- UI thread: một frame callback nhỏ, chỉ vài phép tính khi không ai thổi. Khói (144 sprite) dùng `useSpriteBuffers` (sprite ẩn
  dùng `HIDDEN_XF`, không spam log Graphite) và chỉ tính trong khoảng 6 s sau khi tắt. Shader thêm 2 uniform và vài phép tính trong
  `flameCol`, vốn chỉ chạy ở pixel nằm trong lỗ khắc.
- JS thread: phân tích mic khoảng 0,5 triệu phép nhân mỗi giây.
- Đo trên bản quay sim (Debug, máy tải ~30–35): các khung khựng 100–400 ms xuất hiện ở cả bản chưa vá lẫn đã vá, kể cả những đoạn không
  có gì thay đổi (bản chưa vá có khựng 655 ms ở 27,5 s). Đoạn thổi/tắt nằm trong mức nhiễu đó. Muốn có số chính xác cần đo trên bản
  Release.
