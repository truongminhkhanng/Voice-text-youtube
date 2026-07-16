# YouTube Subtitle to Vietnamese Speech

Tiện ích Chrome cá nhân giúp đọc phụ đề YouTube bằng giọng nói trên máy. Bản hiện tại ưu tiên phụ đề tiếng Việt đang hiển thị trực tiếp trên YouTube, đọc bám theo video và không can thiệp vào hệ thống phụ đề native của YouTube.

Phiên bản hiện tại: **1.5.0**

## Điểm chính

- Đọc phụ đề tiếng Việt đang chạy trên video bằng Web Speech API.
- Đọc đúng thời điểm phụ đề xuất hiện, không đọc trước câu tiếp theo.
- Tự chờ khi video tạm dừng và bỏ câu cũ khi tua.
- Điều khiển Phát, Dừng chờ và Dừng hoàn toàn.
- Chọn giọng đọc, âm lượng và tốc độ từ **0.5× đến 4.0×**.
- Theo dõi điều hướng video của YouTube mà không cần tải lại toàn bộ trang.
- Có tùy chọn dịch bằng Google Cloud Translation với API key riêng.
- Không phụ thuộc Read Frog hoặc bất kỳ extension nào khác.

## Không xung đột với phụ đề YouTube

Tiện ích hoạt động theo nguyên tắc **zero-touch**:

- không tự click nút CC;
- không mở menu phụ đề hoặc panel bản chép lời;
- không đổi caption track bằng API nội bộ;
- không gọi `setOption` hoặc `loadModule`;
- không chặn `fetch`, `XMLHttpRequest` hoặc dùng quyền `webRequest`;
- không gửi request `tlang=vi` riêng để ép YouTube dịch.

YouTube hoàn toàn tự quản lý CC và bản dịch tự động. Ở chế độ native mặc định, tiện ích chỉ đọc trạng thái player và nội dung phụ đề tiếng Việt đang hiển thị. Chỉ khi người dùng chủ động bật chế độ Google, tiện ích mới tải caption nguồn và gửi nội dung cần dịch tới Google Cloud. Nếu YouTube chuyển khỏi tiếng Việt trong lúc đọc native, giọng đọc sẽ tự dừng để không đọc nhầm tiếng Anh bằng giọng Việt.

## Cài để sử dụng riêng trên Chrome

### Cách 1: tải mã nguồn từ GitHub

1. Chọn **Code → Download ZIP** trên GitHub.
2. Giải nén file vừa tải.
3. Mở `chrome://extensions`.
4. Bật **Developer mode**.
5. Chọn **Load unpacked / Tải tiện ích đã giải nén**.
6. Chọn thư mục đã giải nén có file `manifest.json` ở ngay bên trong.
7. Ghim icon **YT Auto Translate + TTS** lên thanh công cụ nếu cần.

### Cách 2: clone repository

```powershell
git clone https://github.com/truongminhkhanng/Voice-text-youtube.git
cd Voice-text-youtube
```

Sau đó dùng **Load unpacked / Tải tiện ích đã giải nén** và chọn thư mục `Voice-text-youtube`.

### Tạo một thư mục đóng gói sạch

Yêu cầu Node.js 20+:

```powershell
npm run package:unpacked
```

Lệnh này tạo:

- `release/YT-Auto-Translate-TTS-unpacked`: thư mục dùng cho **Load unpacked / Tải tiện ích đã giải nén**;
- `release/YT-Auto-Translate-TTS-v1.5.0.zip`: file lưu trữ hoặc chép sang máy khác.

Chrome không nạp trực tiếp file ZIP. Hãy giải nén ZIP trước khi dùng **Load unpacked / Tải tiện ích đã giải nén**.

## Cách sử dụng với video tiếng Anh

1. Mở video YouTube có phụ đề.
2. Tự bật nút **CC** trên YouTube.
3. Mở **Cài đặt ⚙ → Phụ đề → Dịch tự động → Tiếng Việt**.
4. Chờ phụ đề tiếng Việt xuất hiện trên video.
5. Mở popup của tiện ích.
6. Nếu popup đang báo cần xử lý, bấm **Thử lại**.
7. Chọn giọng đọc, tốc độ và âm lượng.
8. Bấm **Phát**.

Tiện ích không tự chọn mục **Dịch tự động → Tiếng Việt** vì thao tác đó từng làm phụ đề YouTube biến mất hoặc không dịch được. Việc để người dùng chọn trực tiếp giúp YouTube hoạt động ổn định hơn.

## Điều khiển giọng đọc

- **Phát**: bắt đầu hoặc tiếp tục đọc tại vị trí hiện tại của video.
- **Dừng chờ**: tạm dừng giọng đọc nhưng giữ trạng thái hiện tại.
- **Dừng**: hủy câu đang đọc; lần sau sẽ đọc lại theo vị trí video.
- **Tốc độ**: từ `0.5×` đến `4.0×`, bước nhảy `0.1×`.
- **Âm lượng**: từ 0% đến 100%.
- **Đọc tự động khi mở video**: tự phát khi Chrome cho phép autoplay, CC đã bật và phụ đề tiếng Việt đã được chọn/hiển thị.

Tốc độ thực được tính bằng tốc độ trong tiện ích nhân với tốc độ phát video YouTube và luôn giới hạn tối đa ở `4.0×`. Một số giọng của Windows hoặc Chrome có thể không thể hiện đầy đủ khác biệt ở mức rất cao, dù tiện ích đã truyền đúng tốc độ đã chọn.

## Dịch bằng Google Cloud — tùy chọn

Luồng khuyên dùng là bật bản dịch tiếng Việt trực tiếp trên YouTube. Nếu muốn tiện ích tự dịch caption nguồn mà không phụ thuộc bản dịch native, bạn có thể dùng Google Cloud Translation:

1. Tạo Google Cloud project.
2. Bật **Cloud Translation API** và billing.
3. Tạo API key có restriction phù hợp.
4. Mở **Cài đặt nâng cao** của tiện ích.
5. Nhập key và bấm **Lưu và thử dịch “Hello”**.
6. Bật **Dịch nếu YouTube chưa hiện tiếng Việt**.

API key được lưu trong `chrome.storage.local` trên máy hiện tại và không đồng bộ qua tài khoản Chrome. Caption chỉ được gửi tới Google khi tùy chọn dịch đang bật. Google Cloud có quota và chi phí riêng.

## Cập nhật tiện ích

Sau khi tải hoặc pull phiên bản mới:

1. Mở `chrome://extensions`.
2. Tìm **YT Auto Translate + TTS**.
3. Bấm **Reload** trên thẻ tiện ích.
4. Tải lại tab YouTube đang mở.

Nếu trước đây đã nạp nhiều bản từ các thư mục khác nhau, hãy xóa hoặc tắt tất cả bản cũ và chỉ giữ một bản mới nhất. Hai bản cùng chạy có thể gây hành vi khó đoán.

## Xử lý lỗi thường gặp

### YouTube không dịch hoặc phụ đề biến mất

- Kiểm tra tiện ích đang ở phiên bản `1.5.0` trở lên.
- Xóa hoặc tắt mọi bản tiện ích cũ.
- Khi chẩn đoán, tạm tắt Read Frog hoặc các extension phụ đề khác để loại trừ việc chúng cùng thay đổi YouTube.
- Bấm **Reload** tiện ích và tải lại tab YouTube.
- Chọn lại **Phụ đề → Dịch tự động → Tiếng Việt** bằng menu của YouTube.

### Popup yêu cầu chọn tiếng Việt

YouTube chưa xác nhận track đang hiển thị là tiếng Việt. Hãy bật CC, chọn **Dịch tự động → Tiếng Việt**, chờ phụ đề Việt xuất hiện rồi bấm **Thử lại**.

### Tiện ích chỉ đọc tiếng Anh

Với thiết lập mặc định, tiện ích sẽ không đọc live caption nếu player không xác nhận tiếng Việt. Hãy chắc chắn chỉ còn một bản extension đang hoạt động và bản dịch tiếng Việt thật sự đang hiển thị trước khi bấm **Phát**.

### Không có giọng tiếng Việt

Tiện ích ưu tiên giọng có mã `vi-*` và không âm thầm chuyển sang giọng Anh. Hãy cài gói ngôn ngữ/giọng tiếng Việt trong hệ điều hành hoặc chủ động chọn một giọng khác trong popup.

### Đã sửa mã nhưng Chrome vẫn chạy bản cũ

Bấm **Reload** tại `chrome://extensions`, sau đó tải lại tab YouTube. Content script cũ vẫn tồn tại trong tab cho đến khi trang được tải lại.

## Kiểm thử và phát triển

```powershell
npm test
npm run validate
npm run smoke:youtube
```

- `npm test`: chạy unit test cho parser, cài đặt, dịch và đồng bộ TTS.
- `npm run validate`: kiểm tra cả hai manifest, file tham chiếu, CSP và icon.
- `npm run smoke:youtube`: thử endpoint caption của một video công khai.

YouTube có thể trả timedtext rỗng cho bài smoke chạy ngoài page context. Khi đó kết quả `inconclusive` không đồng nghĩa extension đã lỗi; vẫn cần kiểm thử thủ công bằng Chrome với một video thật.

## Cấu trúc chính

- `manifest.json`: manifest dùng khi nạp trực tiếp thư mục repository.
- `extension/content.js`: lifecycle video, đọc caption live và điều phối TTS.
- `extension/background.js`: service worker, đọc player data và xử lý caption nguồn/dịch.
- `extension/popup.*`: giao diện điều khiển nhanh.
- `extension/options.*`: cài đặt nâng cao và Google API key.
- `extension/lib/`: parser caption, bộ TTS và tiện ích dịch có unit test.
- `tests/`: kiểm thử tự động.
- `scripts/`: validate, smoke test và đóng gói bản unpacked.

## Quyền và quyền riêng tư

Tiện ích dùng các quyền sau:

- `storage`: lưu cài đặt và API key.
- `activeTab`: giao tiếp với tab YouTube đang hoạt động.
- `scripting`: đọc player data trong MAIN world mà không thay đổi caption track.
- host `youtube.com`: đọc dữ liệu caption của video.
- host `translation.googleapis.com`: chỉ gọi khi người dùng chủ động bật dịch Google hoặc bấm thử dịch “Hello”.

Tiện ích không đọc storage, API key hoặc mã nội bộ của extension khác; không mute và không tự thay đổi âm lượng video gốc.

## Giới hạn

- YouTube không cung cấp public Caption API cho luồng này; thay đổi nội bộ của YouTube có thể yêu cầu cập nhật tiện ích.
- Web Speech API phụ thuộc giọng và khả năng của hệ điều hành.
- Câu quá dài có thể bị cắt khi phụ đề tiếp theo xuất hiện để tránh giọng đọc chạy chậm hơn video.
- Video không có caption sẽ không thể dùng chế độ đọc phụ đề.
