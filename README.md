# YT Auto Translate + TTS (Vietnamese)

Chrome Extension Manifest V3 lấy phụ đề của video YouTube, ưu tiên track tiếng Việt, dịch khi người dùng chủ động cấu hình và đọc đồng bộ theo timeline video bằng giọng Web Speech có sẵn trên máy.

## Cài để sử dụng riêng trên Chrome

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn **thư mục gốc `Voice-text-youtube`** — chính là thư mục đang chứa file `manifest.json` này.
5. Mở hoặc tải lại một trang video `youtube.com/watch?v=...`.
6. Click icon extension, đợi trạng thái **Sẵn sàng**, rồi chọn **Phát**.

Bạn cũng có thể tạo một bản sạch chỉ chứa file cần cho Chrome:

```powershell
npm run package:unpacked
```

Sau đó chọn thư mục `release/YT-Auto-Translate-TTS-unpacked` trong **Load unpacked**. File ZIP bên cạnh dùng để lưu trữ hoặc chép sang máy khác; cần giải nén ZIP trước khi chọn trong Chrome.

Sau mỗi lần sửa mã, bấm **Reload** trên thẻ extension và tải lại tab YouTube để content script mới được nạp.

## Tính năng MVP

- Theo dõi điều hướng SPA của YouTube và tự nạp lại phụ đề cho video mới.
- Đọc caption track từ player data trong main world, có fallback parser cho script trên trang.
- Ưu tiên track tiếng Việt thủ công; fallback sang track gốc tốt nhất nếu không có.
- Chỉ đọc câu khi video chạm timestamp tương ứng; không tự đọc trước câu tiếp theo.
- Tự pause theo video, bỏ câu cũ khi tua và cắt câu còn dở lúc phụ đề kế tiếp bắt đầu để luôn bám timeline.
- Play, Pause/Resume và Stop (phát lại từ vị trí video hiện tại).
- Chọn giọng, tốc độ 0.5–2.0×, âm lượng và auto-play.
- Lưu tùy chọn bằng `chrome.storage.sync`.
- Cảnh báo rõ khi thiếu caption, endpoint timedtext lỗi hoặc máy không có giọng `vi-*`.
- Khi YouTube yêu cầu PO Token, thử lại URL do player tạo và fallback sang panel **Hiện bản chép lời**.
- Dịch tùy chọn qua Google Cloud Translation Basic v2 bằng API key riêng của người dùng.
- Tự nhận bản auto-translate tiếng Việt đang bật trong YouTube (`tlang=vi`) và đọc trực tiếp, không cần API key.
- Nếu API nội bộ vẫn báo track gốc như `en-GB`, lấy chính dòng phụ đề đang hiển thị trên video; vì vậy bản auto-translate Việt trên màn hình không bị thay bằng câu tiếng Anh.
- Chỉ đọc trạng thái player và tài nguyên phụ đề đã có; extension không gọi `setOption`, không bật/tắt CC và không tự click mở panel của YouTube.

Floating control chưa nằm trong phiên bản hiện tại.

## Dịch sang tiếng Việt

Extension không có và không nhúng sẵn khóa dịch. Để bật dịch:

1. Tạo Google Cloud project, bật Cloud Translation API và billing.
2. Tạo API key có restriction phù hợp.
3. Mở **Cài đặt nâng cao** của extension.
4. Nhập key, bấm **Lưu và thử dịch “Hello”**.
5. Bật **Dịch sang tiếng Việt trước khi đọc**.

API key được lưu bằng `chrome.storage.local`, không đồng bộ qua tài khoản Chrome. Nội dung phụ đề chỉ được gửi tới Google khi tùy chọn dịch đang bật và video không có track tiếng Việt. Google Cloud Translation có quota và chi phí riêng.

## Giọng tiếng Việt

Danh sách giọng phụ thuộc hệ điều hành. Nếu `speechSynthesis.getVoices()` không trả về giọng có `lang` bắt đầu bằng `vi`, extension sẽ không tự chuyển sang giọng Anh. Người dùng có thể:

- cài gói ngôn ngữ/giọng tiếng Việt của hệ điều hành; hoặc
- tự chọn rõ ràng một giọng ngôn ngữ khác trong popup/options.

## Kiến trúc

- `content.js`: lifecycle của video, caption, dịch và TTS DOM.
- `background.js`: service worker điều phối tab, đọc player data ở MAIN world và thực hiện network request.
- `popup.*`: điều khiển nhanh và trạng thái tab hiện tại.
- `options.*`: cấu hình đầy đủ và API key cục bộ.
- `lib/`: parser caption, hàng đợi TTS và chia lô dịch có thể unit test.

Service worker không gọi `speechSynthesis`; TTS chỉ chạy trong content script.

## Kiểm thử

Yêu cầu Node.js 20+:

```powershell
npm test
npm run validate
npm run smoke:youtube
```

`smoke:youtube` cần Internet và kiểm tra một video công khai. Nếu YouTube chặn timedtext ngoài page context, test sẽ báo `inconclusive`; extension thật còn thử lại request trong MAIN world của tab. Có thể truyền video ID khác bằng `node scripts/smoke-youtube.js VIDEO_ID`.

Tạo lại icon PNG:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```

Checklist thủ công quan trọng:

- video có phụ đề Việt thủ công;
- video chỉ có phụ đề auto tiếng Anh;
- video không có caption;
- máy có/không có giọng Việt;
- chuyển video bằng điều hướng SPA mà không refresh;
- pause, resume, stop, tua video và phát lại đúng câu tại vị trí hiện tại;
- API key dịch hợp lệ/không hợp lệ.

## Giới hạn và quyền riêng tư

YouTube không cung cấp public Caption API dành cho luồng này. Extension dựa vào player data và endpoint `timedtext` không chính thức, vì vậy có thể hỏng khi YouTube thay đổi cấu trúc và cần được bảo trì. Extension không mute video gốc. Web Speech không cho biết trước chính xác thời lượng đọc, nên một câu quá dài có thể bị cắt khi phụ đề kế tiếp bắt đầu để tránh làm giọng đọc trễ khỏi video.

Các quyền được dùng:

- `storage`: lưu tùy chọn và API key.
- `activeTab`: điều khiển tab YouTube mà người dùng đang mở.
- `scripting`: đọc player response trong MAIN world.
- host YouTube: lấy caption.
- `translation.googleapis.com`: chỉ gọi khi người dùng bật dịch.
