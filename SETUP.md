# Hướng dẫn triển khai CKOA

CKOA chạy hoàn toàn trên **Google Apps Script**, gắn với một **Google Sheet** duy nhất do
admin (bạn) sở hữu. Không cần server, không tốn phí hosting.

- Frontend: HTML/CSS/JS thuần (trong `src/Index.html`, `src/Stylesheet.html`, `src/JavaScript.html`)
- Backend: `src/Code.gs` (Apps Script, cũng là JavaScript)
- Database: chính Google Sheet của bạn
- Đăng nhập: mỗi nhà hàng dùng tài khoản Google riêng, dựa vào cơ chế đăng nhập sẵn có của Apps Script (không cần OAuth Client ID)
- Phân quyền: chỉ những Gmail có tên trong tab `Restaurants` mới vào được
- Gửi đơn: qua Gmail của bạn (tài khoản admin deploy app)

## 1. Tạo Google Sheet

Tạo một Google Sheet mới, đặt tên tuỳ ý (vd "CKOA Data"), và tạo đúng 4 tab với header ở hàng đầu tiên:

### Tab `Settings`

| Key | Value |
|---|---|
| AppTitle | Central Kitchen Ordering |
| CentralKitchenEmail | centralkitchen@example.com |
| OrderCutoffHour | 16 |
| OrderCutoffDaysBefore | 1 |

**Hạn chốt đơn** = `OrderCutoffHour` giờ, của `OrderCutoffDaysBefore` ngày trước ngày giao. Cấu hình mặc định ở trên nghĩa là **16:00 (4pm) ngày hôm trước**:

| Ngày giao | Hạn chốt đơn |
|---|---|
| Thứ 4 | 4pm thứ 3 |
| Thứ 6 | 4pm thứ 5 |

App chỉ hiển thị những ngày giao còn trong hạn, và kiểm tra lại hạn này ở server khi gửi đơn (nếu quá hạn ngay lúc bấm gửi thì đơn bị từ chối kèm thông báo). Muốn đổi thành 15:00 chỉ cần sửa `OrderCutoffHour` thành `15`; muốn chốt sớm 2 ngày thì đặt `OrderCutoffDaysBefore` = `2`.

### Tab `Restaurants`

| Email | RestaurantName | DeliveryAddress | Active |
|---|---|---|---|
| hobartcbd@example.com | Hobart CBD | 45 Elizabeth St, Hobart TAS 7000 | TRUE |
| sandybay@example.com | Sandy Bay | 12 King St, Sandy Bay TAS 7005 | TRUE |

Mỗi dòng là một tài khoản Google được phép đăng nhập + tên nhà hàng sẽ hiện trên đơn/email. Đặt `Active` = `FALSE` để tạm khoá một nhà hàng mà không cần xoá dòng.

### Tab `Items`

| ID | Category | Name | Unit | Price | Active |
|---|---|---|---|---|---|
| | Prepped Vegetables | Julienned carrots | kg | 8.50 | TRUE |
| | Prepped Meat | Pork mince | kg | 14.90 | TRUE |
| | Sauces & Stocks | Tomato sauce base | L | 9.00 | TRUE |

- Cột `Price` là **AUD**, nhập số thuần (`8.50`), không kèm ký hiệu `$`. App tự hiển thị thành `$8.50`.
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

## 3. Vì sao phải có 2 deployment

Đây là phần dễ nhầm nhất, nên đọc qua cho hiểu trước khi làm.

Apps Script chỉ cho biết **ai đang mở app** khi deployment chạy ở chế độ *"Execute as: User accessing the web app"*. Nhưng ở chế độ đó, code chạy dưới quyền của nhân viên nhà hàng — mà họ không có quyền vào Sheet của bạn, cũng không nên có.

Cách giải quyết: **cùng một code, deploy hai lần** với hai chế độ khác nhau.

| | Deployment **App** | Deployment **API** |
|---|---|---|
| Execute as | **User accessing the web app** | **Me** |
| Who has access | **Anyone with a Google Account** | **Anyone** |
| Chạy dưới quyền | Nhân viên nhà hàng | Bạn (admin) |
| Việc của nó | Biết ai đang mở app, hiện giao diện | Đọc/ghi Sheet, gửi email đơn hàng |
| URL đưa cho ai | Các nhà hàng | Không đưa ai — chỉ App gọi tới |

App gọi sang API bằng `UrlFetchApp`, kèm email người dùng và một **mã bí mật dùng chung**. API kiểm tra mã bí mật, rồi đối chiếu email với tab `Restaurants` trước khi làm bất cứ việc gì. Nhờ vậy nhà hàng không cần quyền vào Sheet, và email đơn hàng luôn gửi từ Gmail của bạn.

> **Lưu ý bảo mật**: URL của API ai có cũng gọi được, nên mã bí mật là thứ bảo vệ nó. Đừng chia sẻ URL API, và đừng đặt mã bí mật quá ngắn.

## 4. Deploy

### 4.1 Deploy API trước

1. Apps Script editor → **Deploy → New deployment** → chọn loại **Web app**
2. Description: `API` (để sau này khỏi nhầm)
3. Execute as: **Me**
4. Who has access: **Anyone**
5. **Deploy** → cấp quyền khi Google hỏi (màn hình cảnh báo *"Google hasn't verified this app"* là bình thường với app tự viết — bấm **Advanced → Go to … (unsafe)**)
6. Copy URL dạng `https://script.google.com/macros/s/XXXX/exec`

### 4.2 Khai báo 2 Script Properties

1. Trong editor, chọn hàm `generateApiSecret` ở thanh trên → bấm **Run**. Hàm này tự sinh mã bí mật và lưu lại.
2. Vào **Project Settings** (bánh răng) → kéo xuống **Script Properties** → **Add script property**, kiểm tra và điền:

| Property | Value |
|---|---|
| `API_SECRET` | (đã được `generateApiSecret` tạo sẵn, không cần sửa) |
| `API_URL` | URL `/exec` của deployment **API** ở bước 4.1 |

3. **Save script properties**.

### 4.3 Deploy App

1. **Deploy → New deployment** → **Web app**
2. Description: `App`
3. Execute as: **User accessing the web app**
4. Who has access: **Anyone with a Google Account**
5. **Deploy** → copy URL
6. Đây mới là URL gửi cho các nhà hàng.

> Lần đầu mỗi nhà hàng mở link App, Google sẽ hỏi họ cấp quyền cho script (để app biết email của họ và gọi được sang API). Họ cũng gặp màn hình *"Google hasn't verified this app"* → **Advanced → Go to … (unsafe)**. Chỉ một lần cho mỗi tài khoản.

### 4.4 Khi sửa code về sau

Phải cập nhật **cả hai** deployment, nếu không App và API sẽ chạy hai phiên bản code khác nhau:

**Deploy → Manage deployments** → với từng deployment: bấm bút chì → **Version: New version** → **Deploy**.

## 5. Test thử

1. Mở URL **App** bằng một tài khoản Google có trong tab `Restaurants`.
2. Chọn món → chọn ngày giao (chỉ hiện thứ 4/6 sắp tới) → nhập tên người đặt, địa chỉ → **Place order**.
3. Kiểm tra:
   - Email đã tới hộp thư `CentralKitchenEmail` (và CC về email nhà hàng).
   - Một dòng mới xuất hiện trong tab `Orders`.
   - Mục **My orders** trong app hiển thị đơn vừa gửi.
4. Thử bằng một tài khoản Google **không** có trong tab `Restaurants` — app phải chặn lại kèm thông báo chưa được đăng ký.

## Quản lý vận hành

- **Thêm/xoá/sửa món & giá**: sửa trực tiếp tab `Items`.
- **Thêm nhà hàng mới**: thêm dòng vào tab `Restaurants` với email Google của họ.
- **Đổi email bếp trung tâm nhận đơn**: sửa `CentralKitchenEmail` trong tab `Settings`.
- **Đổi hạn chốt đơn**: sửa `OrderCutoffHour` / `OrderCutoffDaysBefore` trong tab `Settings`.
- **Lịch sử đơn hàng**: xem trực tiếp tab `Orders`, hoặc trong app mục "Đơn đã đặt" (mỗi nhà hàng chỉ thấy đơn của mình).

## Ghi chú kỹ thuật

- Ngày giao hàng cố định thứ 4 và thứ 6 hàng tuần (`DELIVERY_WEEKDAYS` trong `Code.gs`), có thể sửa nếu cần thêm ngày khác.
- Múi giờ đặt ở `timeZone` trong `appsscript.json` (hiện là `Australia/Hobart`) và được dùng cho toàn bộ app qua `Session.getScriptTimeZone()` — đổi một chỗ đó là đổi hết ngày giao, hạn chốt đơn và mã đơn hàng. Sau khi sửa manifest nhớ deploy version mới. Phép cộng ngày trong `Code.gs` tính theo lịch nên không lệch vào tuần đổi giờ mùa hè (DST).
- Danh tính người dùng lấy từ `Session.getActiveUser()` phía deployment **App**, rồi được API kiểm tra lại với tab `Restaurants` trước mỗi thao tác — trình duyệt không tự khai được mình là ai.
- `doGet` có chốt chặn: nếu không xác định được người đang đăng nhập (tức là đang chạy trên deployment API), nó trả về trang thông báo thay vì giao diện đặt hàng. Nếu không có chốt này, người lạ mở URL API sẽ chạy code dưới quyền admin.
- Ban đầu app dùng Google Identity Services (Client ID + nút "Sign in with Google") nhưng **không dùng được**: Apps Script hiển thị trang trong iframe thuộc `googleusercontent.com`, mà Google từ chối domain này khi khai *Authorised JavaScript origins* ("Uses a forbidden domain"). Vì vậy mới chuyển sang 2 deployment.
- Vì đây là app nội bộ quy mô nhỏ, không dùng database ngoài — mọi dữ liệu nằm trong chính Google Sheet để admin dễ xem/sửa trực tiếp.
