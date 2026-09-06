# Hướng dẫn triển khai CKOA

CKOA chạy hoàn toàn trên **Google Apps Script**, gắn với một **Google Sheet** duy nhất do
admin (bạn) sở hữu. Không cần server, không tốn phí hosting.

- Frontend: HTML/CSS/JS thuần (trong `src/Index.html`, `src/Stylesheet.html`, `src/JavaScript.html`)
- Backend: `src/Code.gs` (Apps Script, cũng là JavaScript)
- Database: chính Google Sheet của bạn
- Đăng nhập: mỗi nhà hàng dùng tài khoản Google riêng (Google Sign-In)
- Gửi đơn: qua Gmail của bạn (tài khoản admin deploy app)

## 1. Tạo Google Sheet

Tạo một Google Sheet mới, đặt tên tuỳ ý (vd "CKOA Data"), và tạo đúng 4 tab với header ở hàng đầu tiên:

### Tab `Settings`

| Key | Value |
|---|---|
| AppTitle | Đặt hàng Bếp Trung Tâm |
| GoogleClientId | *(điền ở bước 3)* |
| CentralKitchenEmail | bep.trungtam@gmail.com |
| OrderCutoffHour | 16 |
| OrderCutoffDaysBefore | 1 |

**Hạn chốt đơn** = `OrderCutoffHour` giờ, của `OrderCutoffDaysBefore` ngày trước ngày giao. Cấu hình mặc định ở trên nghĩa là **16:00 ngày hôm trước**:

| Ngày giao | Hạn chốt đơn |
|---|---|
| Thứ 4 | 16:00 thứ 3 |
| Thứ 6 | 16:00 thứ 5 |

App chỉ hiển thị những ngày giao còn trong hạn, và kiểm tra lại hạn này ở server khi gửi đơn (nếu quá hạn ngay lúc bấm gửi thì đơn bị từ chối kèm thông báo). Muốn đổi thành 15:00 chỉ cần sửa `OrderCutoffHour` thành `15`; muốn chốt sớm 2 ngày thì đặt `OrderCutoffDaysBefore` = `2`.

### Tab `Restaurants`

| Email | RestaurantName | DeliveryAddress | Active |
|---|---|---|---|
| nhahang1@gmail.com | Nhà hàng Quận 1 | 12 Nguyễn Huệ, Q1 | TRUE |
| nhahang2@gmail.com | Nhà hàng Quận 3 | 45 Võ Văn Tần, Q3 | TRUE |

Mỗi dòng là một tài khoản Google được phép đăng nhập + tên nhà hàng sẽ hiện trên đơn/email. Đặt `Active` = `FALSE` để tạm khoá một nhà hàng mà không cần xoá dòng.

### Tab `Items`

| ID | Category | Name | Unit | Price | Active |
|---|---|---|---|---|---|
| | Rau củ | Cà rốt sơ chế | kg | 25000 | TRUE |
| | Thịt | Thịt heo xay | kg | 120000 | TRUE |
| | Nước sốt | Sốt cà chua | lít | 60000 | TRUE |

- Cột `ID` để trống, app sẽ tự sinh mã lần đầu đọc và ghi lại vào sheet — bạn không cần tự quản lý ID.
- Đây chính là nơi **admin chỉnh sửa danh sách món**: thêm dòng mới, xoá/đặt `Active=FALSE`, sửa giá trực tiếp trong Sheet. App sẽ luôn hiển thị dữ liệu mới nhất, không cần deploy lại.

### Tab `Orders` (log, để app tự ghi — bạn chỉ cần tạo header)

| OrderID | Timestamp | RestaurantEmail | RestaurantName | OrdererName | DeliveryDate | DeliveryAddress | ItemsJSON | Total | Status |
|---|---|---|---|---|---|---|---|---|---|

## 2. Gắn Apps Script vào Sheet

1. Trong Google Sheet: **Extensions → Apps Script**.
2. Xoá nội dung `Code.gs` mặc định, copy nội dung từng file trong thư mục `src/` của repo này vào project:
   - `Code.gs`
   - Tạo file HTML mới cho từng file: `Index.html`, `Stylesheet.html`, `JavaScript.html`
   - Mở **Project Settings** (biểu tượng bánh răng) → dán nội dung `appsscript.json` vào file manifest (bật "Show appsscript.json" trước nếu chưa thấy).

   Hoặc dùng [`clasp`](https://github.com/google/clasp) để đẩy code tự động (khuyến khích khi phát triển tiếp):
   ```bash
   npm install -g @google/clasp
   clasp login
   clasp create --type sheets --title "CKOA" --rootDir ./src
   # hoặc nếu đã có script: copy .clasp.json.example -> .clasp.json và điền scriptId
   clasp push
   ```

## 3. Tạo Google OAuth Client ID (cho Google Sign-In)

App dùng [Google Identity Services](https://developers.google.com/identity/gsi/web) để nhận diện tài khoản Google của từng nhà hàng — hoạt động với **bất kỳ** tài khoản Gmail nào (không cần Google Workspace).

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới (hoặc dùng project có sẵn liên kết với Apps Script: **Project Settings → Google Cloud Platform (GCP) Project**).
2. **APIs & Services → OAuth consent screen**: cấu hình cơ bản (tên app, email hỗ trợ). Loại "External" là đủ; không cần publish nếu số nhà hàng ít, chỉ cần thêm email các nhà hàng vào "Test users" khi ở chế độ Testing.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: thêm URL web app của bạn (dạng `https://script.google.com`) — bạn sẽ có URL chính xác sau bước Deploy ở dưới, quay lại thêm sau cũng được.
4. Copy **Client ID**, dán vào Sheet `Settings` → dòng `GoogleClientId`.

## 4. Deploy Web App

1. Trong Apps Script editor: **Deploy → New deployment**.
2. Chọn loại **Web app**.
3. Execute as: **Me** (email admin — để Gmail gửi đơn dùng tài khoản này).
4. Who has access: **Anyone**.
5. Deploy, copy URL web app (dạng `https://script.google.com/macros/s/XXXX/exec`).
6. Quay lại Cloud Console → OAuth client → thêm URL này (phần gốc `https://script.google.com`) vào **Authorized JavaScript origins** nếu chưa có.
7. Gửi URL này cho các nhà hàng để họ truy cập và đăng nhập bằng tài khoản Google đã đăng ký ở tab `Restaurants`.

Mỗi khi sửa code, tạo **New deployment** (hoặc "Manage deployments" → sửa deployment hiện có) để URL không đổi.

## 5. Test thử

1. Mở URL web app bằng một tài khoản Google có trong tab `Restaurants`.
2. Đăng nhập → chọn món → chọn ngày giao (chỉ hiện thứ 4/6 sắp tới) → nhập tên người đặt, địa chỉ → Gửi đơn.
3. Kiểm tra:
   - Email đã tới hộp thư `CentralKitchenEmail` (và CC về email nhà hàng).
   - Một dòng mới xuất hiện trong tab `Orders`.
   - Tab "Đơn đã đặt" trong app hiển thị đơn vừa gửi.

## Quản lý vận hành

- **Thêm/xoá/sửa món & giá**: sửa trực tiếp tab `Items`.
- **Thêm nhà hàng mới**: thêm dòng vào tab `Restaurants` với email Google của họ.
- **Đổi email bếp trung tâm nhận đơn**: sửa `CentralKitchenEmail` trong tab `Settings`.
- **Đổi hạn chốt đơn**: sửa `OrderCutoffHour` / `OrderCutoffDaysBefore` trong tab `Settings`.
- **Lịch sử đơn hàng**: xem trực tiếp tab `Orders`, hoặc trong app mục "Đơn đã đặt" (mỗi nhà hàng chỉ thấy đơn của mình).

## Ghi chú kỹ thuật

- Ngày giao hàng cố định thứ 4 và thứ 6 hàng tuần (`DELIVERY_WEEKDAYS` trong `Code.gs`), có thể sửa nếu cần thêm ngày khác.
- Múi giờ đặt ở `timeZone` trong `appsscript.json` (hiện là `Australia/Hobart`) và được dùng cho toàn bộ app qua `Session.getScriptTimeZone()` — đổi một chỗ đó là đổi hết ngày giao, hạn chốt đơn và mã đơn hàng. Sau khi sửa manifest nhớ deploy version mới. Phép cộng ngày trong `Code.gs` tính theo lịch nên không lệch vào tuần đổi giờ mùa hè (DST).
- Xác thực đăng nhập được kiểm tra lại ở server (`Code.gs`) qua Google tokeninfo endpoint mỗi lần gọi API quan trọng (xem catalog, gửi đơn) — không chỉ tin tưởng phía trình duyệt.
- Vì đây là app nội bộ quy mô nhỏ, không dùng database ngoài — mọi dữ liệu nằm trong chính Google Sheet để admin dễ xem/sửa trực tiếp.
