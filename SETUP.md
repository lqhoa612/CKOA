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
| DeliveryDays | Tuesday, Friday |
| ThirdPartyCategories | Fortuna |

`InvoiceEmail` là nơi nhận invoice do bếp xuất (thường là kế toán). Để trống thì dùng `CentralKitchenEmail`. Nhà hàng luôn được CC.

`KitchenName` là tên bên bán hiện trên invoice. Để trống thì dùng `AppTitle`.

### `DeliveryDays` — các ngày giao hàng trong tuần

Viết **tên thứ bằng tiếng Anh, cách nhau bằng dấu phẩy**. Sửa xong app nhận ngay, **không cần deploy lại**.

| Viết | Nghĩa |
|---|---|
| `Tuesday, Friday` | giao thứ Ba và thứ Sáu *(đang dùng)* |
| `Tue, Fri` | viết tắt cũng được |
| `Mon, Wed, Fri` | ba ngày một tuần |
| `Monday` | một ngày một tuần |
| *(để trống)* | mặc định thứ Ba và thứ Sáu |

Thứ tự viết không quan trọng, viết hoa thường không quan trọng, trùng lặp tự bỏ. Ngăn cách bằng `,` `;` `/` đều được.

> Gõ sai tên thứ (ví dụ `Tuseday`) thì app **bỏ qua từ đó và gửi email cảnh báo cho admin**. Nếu không đọc được từ nào thì giữ nguyên mặc định — đổi lịch giao của cả chuỗi vì một lỗi chính tả thì nguy hiểm hơn nhiều.

Đổi `DeliveryDays` **không ảnh hưởng đơn cũ** — đơn đã đặt vẫn giữ ngày giao đã chọn.

### `ThirdPartyCategories` — hàng giao giúp nhà cung cấp khác

Khai những `Category` mà bếp trung tâm **chỉ giao giúp**, không phải hàng của mình. Nhiều nhà cung cấp thì cách nhau bằng dấu phẩy: `Fortuna, Acme`.

Món thuộc nhóm này trong **email đơn hàng** sẽ được:

- Liệt kê thành **một mục riêng**, tách khỏi hàng của bếp
- Có **tổng tiền riêng** cho từng nhà cung cấp
- Không cộng vào dòng *Central kitchen total*

Email vẫn có dòng **Order total** là tổng tất cả, để nhà hàng biết tổng phải trả cho cả đơn.

Tên khai ở đây phải **trùng với cột `Category`** trong tab `Items` (không phân biệt hoa thường). Để trống thì email giữ nguyên dạng cũ, một danh sách một tổng.

> ⚠️ **Hoá đơn (invoice) bên bếp xuất thì chưa tách.** Mới chỉ tách ở email đơn hàng. Nếu kế toán cần hoá đơn cũng tách riêng phần Fortuna thì báo để làm tiếp.

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
| **Sign out of Google** | Dứt điểm nhất. Đăng xuất xong mở lại link app và đăng nhập đúng tài khoản. Lưu ý cách này đăng xuất khỏi **toàn bộ** dịch vụ Google trên máy đó, kể cả Gmail |
| **Cửa sổ ẩn danh** | Giữ nguyên tài khoản đang đăng nhập. Mở cửa sổ ẩn danh, dán link app (panel hiện sẵn link để copy), đăng nhập tài khoản cần dùng |

Cách thứ hai tiện khi máy dùng chung, hoặc khi một người vừa có tài khoản nhà hàng vừa có tài khoản quản lý.

> **Không có cách chọn tài khoản bằng URL.** Với web app của Apps Script, thêm tiền tố `/u/1/` vào URL không chạy — Drive sẽ nhận nhầm và báo *"Sorry, unable to open the file at present"*. Đây là giới hạn của Apps Script, không phải lỗi cấu hình.

`OrdererName` là tên người đặt gắn với email đó — hiện ở phần ký tên cuối email đơn hàng và ghi vào tab `Orders`. Người đặt **không phải gõ tên** mỗi lần đặt nữa; app tự lấy từ cột này. Để trống thì app dùng tạm địa chỉ email, nên nhớ điền cho từng nhà hàng.

### Tab `Items`

| ID | Category | Name | Unit | Price | Step | MaxQty | Description | ImageUrl | Active |
|---|---|---|---|---|---|---|---|---|---|
| | Prepped Vegetables | Julienned carrots | kg | 8.50 | | | Washed, peeled, cut 4cm. | https://… | TRUE |
| | Cooked Meat | BBQ Pork | kg | 14.90 | 0.1 | | Marinated overnight, roasted, sliced. | https://… | TRUE |
| | Cooked Meat | Whole Duck | each | 32.00 | | | | | TRUE |
| | Uniform | Staff T-Shirt (M) | each | 18.00 | | 1 | Black, embroidered logo. | | TRUE |
| | Uniform | Staff T-Shirt (L) | each | 18.00 | | 1 | Black, embroidered logo. | | TRUE |

> **Giao diện app là tiếng Anh** vì có nhân viên không đọc được tiếng Việt. Nên cột `Name`, `Unit`, `Category` và `Description` cũng nên viết tiếng Anh. Riêng `Unit` thì **bắt buộc** dùng chữ tiếng Anh (`kg`, `g`, `L`, `ml`, `each`, `box`…) — app dựa vào đó để biết món nào đặt được số lẻ, `ký` hay `hộp` nó không hiểu.

- Cột `Price` là **AUD**, nhập số thuần (`8.50`), không kèm ký hiệu `$`. App tự hiển thị thành `$8.50`.
- Cột `Step` là **bước nhảy số lượng**. **Cột này không bắt buộc** — app tự suy ra từ cột `Unit` khi bỏ trống:
  - `Unit` là **kg, g, l, ml** (hoặc lít/litre/kilo/gram) → app cho đặt lẻ **0.1**. Các món cooked meat bán theo kg tự động chạy đúng, không cần điền gì.
  - `Unit` là bất kỳ thứ gì khác (**con**, cái, hộp, bịch…) → chỉ đặt được số nguyên. Whole Duck tự động đúng.
  - Điền `Step` khi muốn **đè lên** suy đoán đó: `1` để ép một món bán theo kg chỉ đặt được số nguyên, `0.5` cho nửa đơn vị, `0.25` cho một phần tư, `0.001` cho cực lẻ.
  - Trong app, nút `+`/`−` nhảy đúng theo bước này; muốn đặt 2.5 thì **gõ thẳng vào ô số lượng** thay vì bấm 25 lần.

> **Nếu nút `+`/`−` vẫn nhảy theo 1 với món bán theo kg**, gần như chắc chắn là bản code trên Apps Script chưa được cập nhật. Xem dưới món đó trong app: có dòng *"in steps of 0.1"* nghĩa là app đã nhận đúng; không có dòng đó nghĩa là code cũ. Deploy lại theo mục 4.4.

**Bếp trung tâm nhập số thực giao chính xác hơn.** Ô `Supplied` cho gõ thẳng số đến 3 chữ số thập phân (ví dụ `2.345` kg cân được trên cân), không bị giới hạn theo bước nhảy của món — vì cân thực tế không bao giờ ra đúng bội số của 0.1. Chỉ không được nhập nhiều hơn số đã đặt.

#### Cột `MaxQty` — giới hạn số lượng tối đa mỗi đơn

Không bắt buộc. **Để trống = không giới hạn** (đa số món nên để trống).

Điền số vào thì nhà hàng không đặt quá số đó trong một đơn: nút `+` **mờ đi khi chạm trần**, gõ số lớn hơn cũng bị kéo về đúng trần. Dòng chữ xám dưới tên món hiện thêm `max 1`.

Server kiểm tra lại lần nữa khi nhận đơn, không tin số từ trình duyệt gửi lên.

Dùng cho những món **cấp phát có định mức**, ví dụ áo đồng phục mỗi quý một cái, hoặc món bếp chỉ làm được số lượng có hạn.

#### Cột `Description` — giải thích món đó là gì

Không bắt buộc. Điền vào thì trong app món đó có **mũi tên nhỏ** cạnh tên; người đặt bấm vào tên món là mở ra phần giải thích. Để trống thì món đó không mở ra gì cả.

Dùng để nói rõ **trong gói có gì**, sơ chế tới đâu, để được bao lâu — những thứ nhà hàng hay gọi điện hỏi. Ví dụ: *"Pork shoulder marinated overnight in five-spice, then roasted. Arrives sliced and ready to plate. Keeps 4 days chilled."*

Xuống dòng trong ô bằng **Alt+Enter** (Windows) hoặc **Option+Enter** (Mac); app giữ nguyên các dòng đó.

#### Cột `ImageUrl` — ảnh món

Không bắt buộc. Điền vào thì app hiện **ảnh nhỏ bên trái tên món**, và ảnh lớn khi bấm mở món ra.

**Phải là link `https://` mở thẳng ra file ảnh** — dán vào trình duyệt phải thấy đúng tấm ảnh, chứ không phải một trang có tấm ảnh nằm trong đó. App bỏ qua mọi thứ không bắt đầu bằng `https://`.

Hai cách lấy link:

1. **Google Drive** — dễ nhất nếu quen Drive. Upload ảnh, chuột phải → Share → đổi thành **Anyone with the link**, copy link dạng `https://drive.google.com/file/d/`**`FILE_ID`**`/view?usp=sharing`, rồi ghép `FILE_ID` vào mẫu:
   ```
   https://drive.google.com/thumbnail?id=FILE_ID&sz=w600
   ```
   ⚠️ **Tôi chưa kiểm chứng được cách này** — môi trường của tôi bị chặn không gọi ra `drive.google.com`. Google cũng đã từng đổi cách hoạt động của link này. **Làm thử một món trước**, thấy ảnh hiện đúng thì làm tiếp các món còn lại.

2. **Để ảnh trong repo GitHub** — cách này đã chạy thật (logo của app đang dùng). Thư mục `assets/items/` **đã tạo sẵn**, hiện có 2 ảnh mẫu:

   | Ảnh | Dán vào cột `ImageUrl` |
   |---|---|
   | Vịt | `https://raw.githubusercontent.com/lqhoa612/CKOA/main/assets/items/duck.png` |
   | Heo | `https://raw.githubusercontent.com/lqhoa612/CKOA/main/assets/items/pig.png` |

   Thêm ảnh mới thì bỏ file vào `assets/items/`, push lên, rồi đổi tên file ở cuối link. Chắc chắn chạy, nhưng mỗi lần thêm ảnh phải push git — không tiện cho người không dùng git.

#### Ảnh nên chuẩn bị thế nào

| | |
|---|---|
| **Kích thước** | **600–800px** mỗi chiều. App hiện ảnh nhỏ 36px cạnh tên và ảnh lớn tối đa 320px, nên to hơn 800px là phí băng thông chứ không nét thêm |
| **Dung lượng** | **dưới 150KB**. Ảnh chụp thẳng từ điện thoại thường 3–5MB — để nguyên thì nhà hàng mở app bằng 4G sẽ rất chậm |
| **Hình vuông** | Ảnh nhỏ cạnh tên bị cắt thành hình vuông, nên ảnh vuông sẵn thì không bị cắt mất phần quan trọng |
| **Nền** | Với hình vẽ/icon, **nền trong suốt (PNG)** nhìn đẹp hơn hẳn — nền xám hay trắng sẽ thành một ô vuông nổi rõ trên thẻ trắng của app. Với ảnh chụp món thật thì không cần |

App có lazy-load (chỉ tải ảnh khi cuộn tới) nhưng không thay được việc nén.

> Hai ảnh mẫu trong `assets/items/` đã được xử lý đúng chuẩn này: cắt sát hình, xoá nền thành trong suốt, ép về 600×600, nén bảng màu còn ~20KB mỗi ảnh (từ 78KB và 181KB).

Link hỏng hoặc ảnh không tải được thì app **tự ẩn ảnh đi**, không hiện icon ảnh vỡ, món vẫn đặt bình thường.

- Cột `Category` vừa là tiêu đề nhóm trong danh sách, vừa là **nội dung ô chọn nhóm món** ở đầu màn hình đặt hàng — app tự gom các giá trị khác nhau trong cột này, thêm nhóm mới không phải sửa code. Viết đúng chính tả và thống nhất, vì `Cooked Meat` và `Cooked meat` sẽ thành hai nhóm riêng.
- Người đặt còn **tìm được theo cột `Description`**, nên viết rõ nguyên liệu chính vào đó thì tìm dễ hơn nhiều.
- Cột `ID` để trống, app sẽ tự sinh mã lần đầu đọc và ghi lại vào sheet — bạn không cần tự quản lý ID.
#### Món có nhiều biến thể (size áo, loại bao bì…) — tách thành nhiều dòng

Áo 3 size thì làm **3 dòng riêng**: `Staff T-Shirt (S)`, `Staff T-Shirt (M)`, `Staff T-Shirt (L)`. **Đừng** làm một dòng `Staff T-Shirt` rồi bảo người đặt ghi size vào ô note.

Lý do: ô note là chữ tự do, máy không cộng trừ được. Một dòng `T-Shirt` số lượng 5 kèm note *"2 cái M, 3 cái L"* thì bếp phải tự đọc và tự hiểu, invoice không tách được tiền theo size, và nếu bếp chỉ giao được 3 cái thì không có cách nào ghi lại là thiếu size nào. Tách thành 3 dòng thì mỗi dòng có số lượng riêng, tính tiền riêng, ghi thiếu riêng — tất cả đều tự động.

Tìm kiếm vẫn gộp chúng lại: gõ `shirt` ra cả ba dòng.

**Ô note cho từng món để dành cho dặn dò không liệt kê trước được** — *"cắt lát mỏng hơn bình thường"*, *"đóng gói riêng 2 phần"*, *"cho người mới"*. Những thứ **liệt kê trước được thì phải thành dòng riêng**.

- Đây chính là nơi **admin chỉnh sửa danh sách món**: thêm dòng mới, xoá/đặt `Active=FALSE`, sửa giá trực tiếp trong Sheet. App sẽ luôn hiển thị dữ liệu mới nhất, không cần deploy lại.

### Tab `Drafts` (danh sách đang ghi dở — app tự ghi, bạn chỉ cần tạo header)

| RestaurantEmail | DraftJSON | UpdatedAt |
|---|---|---|

Chỉ cần tạo đúng 3 ô header này, để trống phần dưới. App tự thêm và cập nhật dòng.

Đây là chỗ giữ **giỏ hàng đang làm dở** của từng nhà hàng. Cả tuần ai thấy món nào sắp hết thì mở app bấm vào giỏ, app tự lưu sau mỗi lần sửa khoảng 2 giây. Đến ngày đặt thì mở ra, mọi thứ vẫn còn nguyên. Gửi đơn xong app tự xoá để tuần sau bắt đầu sạch.

Giỏ hàng gắn với **tài khoản** chứ không gắn với máy — điện thoại, máy tính, máy nào mở cũng thấy cùng một danh sách. Nhân viên trong cùng một nhà hàng dùng chung tài khoản nên dùng chung danh sách; ai cũng thêm vào được.

> **Tab này không bắt buộc.** Chưa tạo thì app vẫn chạy bình thường, chỉ là giỏ hàng không được lưu lại giữa các lần mở.

Cột `DraftJSON` là dữ liệu máy đọc, **đừng sửa tay**. Ô hỏng thì app **gửi email báo cho admin** — xem mục dưới.

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

Gửi cho các nhà hàng link [HUONG-DAN-SU-DUNG.md](./HUONG-DAN-SU-DUNG.md) — hướng dẫn 4 bước đầu tiên có hình minh hoạ, viết cho người không rành công nghệ.

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

Đầu màn hình **"All orders"** còn hiện khung đỏ cảnh báo ô hỏng, nếu có — xem mục *Khi app không đọc được một ô*.

Màn hình này đọc 500 dòng gần nhất của tab `Orders`. Cần xem xa hơn thì mở thẳng Google Sheet.

## Khi app không đọc được một ô

Các cột tên có đuôi `JSON` (`ItemsJSON`, `SuppliedJSON`, `DraftJSON`) do app ghi. Sửa tay vào đó, dù chỉ thêm một dấu cách, là ô hỏng và **dữ liệu trong ô coi như mất**.

App **không im lặng bỏ qua**, nhưng **chỉ báo cho admin**. Nhà hàng và bếp không thấy gì cả — họ không sửa được ô trong bảng tính, báo cho họ chỉ là làm phiền.

Admin được báo bằng **hai đường**:

1. **Màn hình "All orders"** hiện một khung đỏ liệt kê mọi ô không đọc được, kèm **số dòng cụ thể** để mở Sheet vào đúng chỗ mà sửa. Không có ô nào hỏng thì khung này không xuất hiện.
2. **Email** tiêu đề `[CKOA] Unreadable cell: …`, ghi rõ:

- Tab nào, cột nào, **dòng số mấy**
- Đơn hàng / nhà hàng nào bị ảnh hưởng và hậu quả là gì
- 500 ký tự đầu của nội dung ô, để đối chiếu xem hỏng kiểu gì

**Email gửi tối đa 1 lần / 6 tiếng cho mỗi ô.** Không có chốt này thì một ô hỏng sẽ bắn email mỗi lần có người mở app — vừa spam vừa đốt quota gửi mail.

Tuỳ chỗ hỏng mà app xử lý khác nhau (cột bên phải là những gì **nhà hàng / bếp** nhìn thấy):

| Ô hỏng | App làm gì |
|---|---|
| `Orders!ItemsJSON` khi bếp bấm xuất hoá đơn | **Chặn lại, không cho xuất** — báo "đơn này chưa xử lý được, văn phòng đã được thông báo". Đây là chỗ duy nhất người dùng thấy có gì đó không ổn, và là cố ý: xuất hoá đơn $0.00 cho một đơn không đọc được thì tệ hơn nhiều |
| `Orders!ItemsJSON` / `SuppliedJSON` khi chỉ đang xem | Hiện đơn đó trống, vẫn mở được màn hình |
| `Drafts!DraftJSON` | Nhà hàng bắt đầu với giỏ trống, không thấy thông báo gì |

### `AdminEmail` trong tab `Settings`

| Key | Value |
|---|---|
| `AdminEmail` | `ban@example.com` |

**Không bắt buộc.** Để trống thì email cảnh báo gửi về chính tài khoản Google sở hữu Sheet và script — tức là anh. Chỉ cần điền khi muốn gửi tới địa chỉ khác, hoặc thêm người khác cùng nhận.

## Quản lý vận hành

- **Thêm/xoá/sửa món & giá**: sửa trực tiếp tab `Items`.
- **Cho một món đặt được số lẻ**: để `Unit` là `kg`/`l` là đủ. Muốn khác đi thì điền `Step` (ví dụ `0.5`, hoặc `1` để ép về số nguyên). Không cần deploy lại.
- **Thêm nhà hàng mới**: thêm dòng vào tab `Restaurants` với email Google của họ.
- **Đổi email bếp trung tâm nhận đơn**: sửa `CentralKitchenEmail` trong tab `Settings`.
- **Đổi ngày giao hàng**: sửa `DeliveryDays` trong tab `Settings`, ví dụ `Tuesday, Friday`.
- **Đổi hạn chốt đơn**: sửa `OrderCutoffHour` / `OrderCutoffDaysBefore` trong tab `Settings`.
- **Xoá giỏ hàng đang lưu dở của một nhà hàng**: xoá nội dung ô `DraftJSON` ở dòng của họ trong tab `Drafts`.
- **Lịch sử đơn hàng**: xem trực tiếp tab `Orders`, hoặc trong app mục "Đơn đã đặt" (mỗi nhà hàng chỉ thấy đơn của mình).

## Ghi chú kỹ thuật

- Ngày giao hàng khai ở `DeliveryDays` trong tab `Settings`, sửa trong Sheet là xong, không cần deploy lại. App chỉ hiện **2 ngày giao gần nhất** còn trong hạn chốt đơn (`UPCOMING_DELIVERY_COUNT` trong `Code.gs`).
- Múi giờ đặt ở `timeZone` trong `appsscript.json` (hiện là `Australia/Hobart`) và được dùng cho toàn bộ app qua `Session.getScriptTimeZone()` — đổi một chỗ đó là đổi hết ngày giao, hạn chốt đơn và mã đơn hàng. Sau khi sửa manifest nhớ deploy version mới. Phép cộng ngày trong `Code.gs` tính theo lịch nên không lệch vào tuần đổi giờ mùa hè (DST).
- Danh tính người dùng lấy từ `Session.getActiveUser()` phía deployment **App**, rồi được API kiểm tra lại với tab `Restaurants` trước mỗi thao tác — trình duyệt không tự khai được mình là ai.
- `doGet` có chốt chặn: nếu không xác định được người đang đăng nhập (tức là đang chạy trên deployment API), nó trả về trang thông báo thay vì giao diện đặt hàng. Nếu không có chốt này, người lạ mở URL API sẽ chạy code dưới quyền admin.
- Ban đầu app dùng Google Identity Services (Client ID + nút "Sign in with Google") nhưng **không dùng được**: Apps Script hiển thị trang trong iframe thuộc `googleusercontent.com`, mà Google từ chối domain này khi khai *Authorised JavaScript origins* ("Uses a forbidden domain"). Vì vậy mới chuyển sang 2 deployment.
- Vì đây là app nội bộ quy mô nhỏ, không dùng database ngoài — mọi dữ liệu nằm trong chính Google Sheet để admin dễ xem/sửa trực tiếp.
