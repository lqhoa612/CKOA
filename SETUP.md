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
| LogoUrl | *(tuỳ chọn, xem bên dưới)* |
| CentralKitchenEmail | kitchen@example.com,accountant@example.com |
| InvoiceEmail | accountant@example.com |
| KitchenName | Saigon Express Central Kitchen |
| OrderCutoffHour | 16 |
| OrderCutoffDaysBefore | 1 |

`InvoiceEmail` là nơi nhận invoice do bếp xuất (thường là kế toán). Để trống thì dùng `CentralKitchenEmail`. Nhà hàng luôn được CC.

`KitchenName` là tên bên bán hiện trên invoice. Để trống thì dùng `AppTitle`.

**Logo** (`LogoUrl`): để trống thì app không hiện logo, chỉ hiện tên nhà hàng như bình thường. Muốn có logo thì điền một đường link ảnh mà trình duyệt tải được:

- **Google Drive**: upload ảnh → chuột phải → **Share** → đổi thành **Anyone with the link** → copy link, lấy đoạn `FILE_ID` ở giữa, rồi điền vào ô:
  `https://drive.google.com/thumbnail?id=FILE_ID&sz=w360`
  (dùng dạng `thumbnail` này, dạng `uc?export=view` hay bị Google chặn khi nhúng)
- **GitHub** (đang dùng): logo Saigon Express đã nằm sẵn trong repo tại `assets/logo.png`, điền vào ô `LogoUrl`:
  `https://raw.githubusercontent.com/lqhoa612/CKOA/main/assets/logo.png`

Nếu sau này đổi logo, nhớ **cắt sát viền trắng và thu nhỏ trước khi upload**. File gốc lúc đầu là 8334 × 8334 pixel nặng 771KB, trong đó 86% diện tích chỉ là nền trắng — trình duyệt phải giải nén thành khoảng 278MB trong RAM chỉ để vẽ ra một hình cao 34px, đủ làm giật máy điện thoại yếu. Bản đang dùng là 360 × 109 pixel, 35KB.

**Kích thước ảnh nên dùng:**

| | Khuyến nghị |
|---|---|
| Định dạng | PNG nền trong suốt |
| Chiều cao ảnh gốc | **100–120px** |
| Chiều rộng ảnh gốc | tối đa **360px** |
| Tỉ lệ | ngang (landscape) đẹp nhất; vuông vẫn ổn |
| Dung lượng | dưới 100KB |

App hiển thị logo cao **34px**, rộng tối đa **120px**. Ảnh gốc nên lớn gấp khoảng 3 lần con số đó để không bị rỗ trên màn hình điện thoại đời mới. Ảnh lớn hơn nữa cũng không đẹp thêm, chỉ tải chậm hơn.

Logo hiện ở góc trên bên trái, cạnh tên nhà hàng. Ảnh tỉ lệ nào cũng không bị méo (app tự co cho vừa). Nếu link hỏng hoặc ảnh không tải được, app tự ẩn logo đi chứ không hiện icon ảnh vỡ. Sửa ô này là có hiệu lực ngay, không cần deploy lại.

**Nhiều người cùng nhận đơn**: `CentralKitchenEmail` điền được nhiều địa chỉ, **ngăn cách bằng dấu phẩy**. Đây là hành vi sẵn có của `GmailApp`, không cần sửa code.

- Chỉ dùng **dấu phẩy**. Dấu chấm phẩy `;` hoặc xuống dòng trong ô sẽ **không** chạy.
- An toàn nhất là viết liền không khoảng trắng: `a@x.com,b@y.com`
- Tất cả nằm ở dòng `To`. Email của nhà hàng đặt đơn luôn được **CC tự động**, không cần khai ở đây.
- Mỗi địa chỉ tính một lượt trong hạn mức gửi mail hằng ngày của Gmail (100 lượt/ngày với Gmail cá nhân, 1.500 với Google Workspace).

**Hạn chốt đơn** = `OrderCutoffHour` giờ, của `OrderCutoffDaysBefore` ngày trước ngày giao. Cấu hình mặc định ở trên nghĩa là **16:00 (4pm) ngày hôm trước**:

| Ngày giao | Hạn chốt đơn |
|---|---|
| Thứ 4 | 4pm thứ 3 |
| Thứ 6 | 4pm thứ 5 |

App chỉ hiển thị những ngày giao còn trong hạn, và kiểm tra lại hạn này ở server khi gửi đơn (nếu quá hạn ngay lúc bấm gửi thì đơn bị từ chối kèm thông báo). Muốn đổi thành 15:00 chỉ cần sửa `OrderCutoffHour` thành `15`; muốn chốt sớm 2 ngày thì đặt `OrderCutoffDaysBefore` = `2`.

### Tab `Restaurants`

| Email | RestaurantName | OrdererName | DeliveryAddress | Active | Role |
|---|---|---|---|---|---|
| hobartcbd@example.com | Hobart CBD | Minh Nguyen | 45 Elizabeth St, Hobart TAS 7000 | TRUE | |
| sandybay@example.com | Sandy Bay | Lan Tran | 12 King St, Sandy Bay TAS 7005 | TRUE | |
| kitchen.manager@example.com | Central Kitchen | Hoa Le | | TRUE | kitchen |
| owner@example.com | Head Office | Jimmy Le | | TRUE | admin |

Mỗi dòng là một tài khoản Google được phép đăng nhập + tên nhà hàng sẽ hiện trên đơn/email. Đặt `Active` = `FALSE` để tạm khoá một nhà hàng mà không cần xoá dòng.

Cột **`Role`** quyết định người đó thấy màn hình nào:

| `Role` | Thấy gì |
|---|---|
| để trống | Màn hình đặt hàng bình thường (nhà hàng) |
| `kitchen` | Bếp trung tâm: danh sách đơn cần xử lý, ghi số thực giao, xuất invoice |
| `admin` | Xem tất cả: mọi đơn của mọi nhà hàng và mọi invoice. **Chỉ đọc** |

Mỗi vai trò chỉ thấy màn hình của mình. Tài khoản `kitchen` và `admin` **không đặt hàng được**; nhà hàng không vào được màn hình của bếp hay của admin. Việc chặn nằm ở phía server chứ không chỉ ẩn nút, nên không lách được bằng cách can thiệp trình duyệt.

Dòng `kitchen` và `admin` không cần điền `DeliveryAddress`.

### Nhà hàng dùng email công ty / Outlook thì sao?

App nhận diện người dùng qua **tài khoản Google**, nhưng tài khoản Google **không bắt buộc phải là địa chỉ @gmail.com**. Địa chỉ công ty đang chạy trên Microsoft 365 (Outlook) vẫn đăng ký làm tài khoản Google được, và người dùng không phải đổi email hay chuyển hộp thư đi đâu cả.

Cách làm, mỗi nhà hàng làm một lần:

1. Vào [accounts.google.com/signup](https://accounts.google.com/signup)
2. Ở ô nhập tên tài khoản, bấm dòng **"Use your existing email address instead"** (Google hay đổi vị trí dòng này, cứ tìm chữ *existing email*)
3. Nhập địa chỉ công ty, ví dụ `hobart@saigonexpress.com.au`
4. Google gửi mã xác minh **về chính hộp thư Outlook đó** — mở Outlook lấy mã, nhập vào
5. Đặt mật khẩu → xong

Sau đó điền đúng địa chỉ công ty đó vào cột `Email` của tab `Restaurants` như các nhà hàng khác. Email đơn hàng CC về địa chỉ này cũng vào thẳng Outlook như thường.

**Lưu ý khi đăng nhập**: trên máy đang đăng nhập sẵn một tài khoản Google khác, họ phải bấm chuyển tài khoản khi mở link app, nếu không Google sẽ dùng tài khoản đang đăng nhập và app báo chưa được đăng ký.

### Đăng nhập nhầm email thì làm sao

App **không tự quản lý phiên đăng nhập** — Google làm việc đó, nên không có nút "đăng xuất" theo nghĩa thông thường. Thay vào đó app có mục **Account**:

- Trong app: nút **Account** ở thanh trên cùng
- Đăng nhập nhầm nên bị chặn ở màn hình lỗi: panel này hiện luôn ngay dưới thông báo lỗi, không cần vào được app mới thấy

Panel đó cho hai cách:

| Cách | Khi nào dùng |
|---|---|
| **Open as account 1/2/3/4** | Máy đang đăng nhập nhiều tài khoản Google cùng lúc. Bấm số tương ứng là mở app dưới tài khoản đó, không phải đăng xuất gì cả |
| **Sign out of Google** | Chỉ có một tài khoản, hoặc muốn dứt điểm. Lưu ý cách này đăng xuất khỏi **toàn bộ** dịch vụ Google trên máy đó, kể cả Gmail |

Cách thứ nhất nhanh hơn hẳn và nên thử trước. "Account 1" là tài khoản đăng nhập đầu tiên trên máy đó, "Account 2" là tài khoản thứ hai, và cứ thế.

`OrdererName` là tên người đặt gắn với email đó — hiện ở phần ký tên cuối email đơn hàng và ghi vào tab `Orders`. Người đặt **không phải gõ tên** mỗi lần đặt nữa; app tự lấy từ cột này. Để trống thì app dùng tạm địa chỉ email, nên nhớ điền cho từng nhà hàng.

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

| OrderID | Timestamp | RestaurantEmail | RestaurantName | OrdererName | DeliveryDate | DeliveryAddress | ItemsJSON | Total | Status | Notes | SuppliedJSON | InvoiceRef | InvoiceTotal | InvoicedAt | KitchenNote |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

**11 cột đầu phải giữ đúng thứ tự** — app ghi đơn mới theo đúng thứ tự đó. Năm cột cuối do bếp trung tâm ghi khi xuất invoice, app tìm theo **tên cột** nên đặt đâu cũng được, miễn có mặt ở hàng tiêu đề.

| Cột | Ai ghi | Nội dung |
|---|---|---|
| `Notes` | Nhà hàng | Ghi chú kèm đơn (món ngoài danh sách, yêu cầu riêng) |
| `SuppliedJSON` | Bếp | Số lượng thực giao từng món |
| `InvoiceRef` | Bếp | Mã invoice, dạng `INV260915-143012` |
| `InvoiceTotal` | Bếp | Số tiền thực tính, theo hàng đã giao |
| `InvoicedAt` | Bếp | Thời điểm xuất invoice |
| `KitchenNote` | Bếp | Lý do thiếu hàng, hàng thay thế... |

Cột `Status`: `Sent` = nhà hàng đã gửi, bếp chưa xử lý. `Invoiced` = bếp đã xuất invoice.

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

> **Nếu mở URL App mà gặp trang "This URL is the CKOA API endpoint"**: trang đó hiển thị luôn hai giá trị *Active user* và *Effective user* mà app nhìn thấy.
>
> - Cả hai đều trống → deployment sai cấu hình (kiểm tra lại Execute as / Who has access / version).
> - Chỉ *Active user* trống, *Effective user* có email → đây là hành vi đã biết của Apps Script với một số tài khoản Gmail cá nhân. Thêm `?app=1` vào cuối URL App và dùng link đó: `https://script.google.com/macros/s/XXXX/exec?app=1`
>
> Chỉ khi thiếu đuôi `?app=1` mà Google không cung cấp danh tính thì app mới từ chối, nên nếu link thường đã chạy thì không cần thêm gì.
>
> **Đừng chia sẻ URL của deployment API.** Khi có đuôi `?app=1`, URL đó cũng hiện được giao diện đặt hàng nhưng chạy dưới danh nghĩa admin.

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

## Bếp trung tâm xuất invoice

Bếp không phải lúc nào cũng đáp ứng đủ đơn. Thay vì giao thiếu rồi hai bên tự nhớ, quản lý bếp ghi lại **số thực giao** và xuất invoice theo đúng số đó.

**Luồng:**

1. Nhà hàng gửi đơn → dòng mới trong tab `Orders`, `Status` = `Sent`
2. Quản lý bếp mở app (tài khoản có `Role` = `kitchen`) → tab **To fulfil** liệt kê các đơn chưa xử lý
3. Bấm **Fulfil this order** → bảng hiện từng món với số đã đặt và ô nhập **số thực giao** (mặc định bằng số đặt)
4. Sửa số lượng những món giao thiếu, ghi chú lý do nếu cần
5. Bấm **Issue invoice**

**Kết quả:**

- Email invoice gửi tới `InvoiceEmail` (kế toán), CC nhà hàng, **kèm file PDF**
- Invoice liệt kê từng món: Ordered / Supplied / Short / Unit / Price / Amount
- **Chỉ tính tiền phần đã giao.** Phần thiếu hiện ở cột Short để đối chiếu, không tính tiền
- Dòng đơn trong tab `Orders` được cập nhật, `Status` chuyển thành `Invoiced`

**Một số quy tắc:**

- Không khai số giao lớn hơn số đặt — app tự chặn về đúng số đã đặt
- Một đơn chỉ xuất invoice được **một lần**; mở lại sẽ báo đã xuất rồi kèm mã invoice cũ
- Nếu gửi email lỗi thì Sheet không bị ghi, tránh tình trạng hệ thống báo đã xuất mà kế toán không nhận được gì
- Giá lấy từ lúc đặt hàng (đã lưu trong `ItemsJSON`), nên sửa giá trong tab `Items` về sau không làm sai lệch đơn cũ

## Màn hình admin

Tài khoản có `Role` = `admin` thấy hai tab, **chỉ đọc, không sửa được gì**:

**Tab "All orders"** — mọi đơn của mọi nhà hàng, mới nhất trước.

- Bốn ô thống kê ở đầu: tổng số đơn, số đơn chờ bếp, số đơn đã xuất invoice, tổng giá trị đã xuất
- Hai bộ lọc: theo nhà hàng và theo trạng thái
- Bấm **Show items** ở từng đơn để xem chi tiết từng món. Đơn chưa xử lý hiện số đã đặt; đơn đã xuất invoice hiện cả **Ordered và Supplied** cạnh nhau, phần giao thiếu tô đỏ
- Kèm ghi chú của nhà hàng và ghi chú của bếp

**Tab "Invoices"** — mọi invoice đã xuất, kèm mã invoice, số tiền, và danh sách món giao thiếu nếu có.

Màn hình này đọc 500 dòng gần nhất của tab `Orders`. Cần xem xa hơn thì mở thẳng Google Sheet.

## Quản lý vận hành

- **Thêm/xoá/sửa món & giá**: sửa trực tiếp tab `Items`.
- **Thêm nhà hàng mới**: thêm dòng vào tab `Restaurants` với email Google của họ.
- **Đổi email bếp trung tâm nhận đơn**: sửa `CentralKitchenEmail` trong tab `Settings`.
- **Đổi hạn chốt đơn**: sửa `OrderCutoffHour` / `OrderCutoffDaysBefore` trong tab `Settings`.
- **Lịch sử đơn hàng**: xem trực tiếp tab `Orders`, hoặc trong app mục "Đơn đã đặt" (mỗi nhà hàng chỉ thấy đơn của mình).

## Ghi chú kỹ thuật

- Ngày giao hàng cố định thứ 4 và thứ 6 hàng tuần (`DELIVERY_WEEKDAYS` trong `Code.gs`), có thể sửa nếu cần thêm ngày khác. App chỉ hiện **2 ngày giao gần nhất** còn trong hạn chốt đơn (`UPCOMING_DELIVERY_COUNT`).
- Múi giờ đặt ở `timeZone` trong `appsscript.json` (hiện là `Australia/Hobart`) và được dùng cho toàn bộ app qua `Session.getScriptTimeZone()` — đổi một chỗ đó là đổi hết ngày giao, hạn chốt đơn và mã đơn hàng. Sau khi sửa manifest nhớ deploy version mới. Phép cộng ngày trong `Code.gs` tính theo lịch nên không lệch vào tuần đổi giờ mùa hè (DST).
- Danh tính người dùng lấy từ `Session.getActiveUser()` phía deployment **App**, rồi được API kiểm tra lại với tab `Restaurants` trước mỗi thao tác — trình duyệt không tự khai được mình là ai.
- `doGet` có chốt chặn: nếu không xác định được người đang đăng nhập (tức là đang chạy trên deployment API), nó trả về trang thông báo thay vì giao diện đặt hàng. Nếu không có chốt này, người lạ mở URL API sẽ chạy code dưới quyền admin.
- Ban đầu app dùng Google Identity Services (Client ID + nút "Sign in with Google") nhưng **không dùng được**: Apps Script hiển thị trang trong iframe thuộc `googleusercontent.com`, mà Google từ chối domain này khi khai *Authorised JavaScript origins* ("Uses a forbidden domain"). Vì vậy mới chuyển sang 2 deployment.
- Vì đây là app nội bộ quy mô nhỏ, không dùng database ngoài — mọi dữ liệu nằm trong chính Google Sheet để admin dễ xem/sửa trực tiếp.
