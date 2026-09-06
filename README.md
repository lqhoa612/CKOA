# CKOA — Central Kitchen Ordering App

Ứng dụng web giúp các nhà hàng trong chuỗi đặt hàng thực phẩm đã sơ chế từ bếp trung tâm.

- **Đăng nhập**: mỗi nhà hàng dùng một tài khoản Google riêng (Google Sign-In).
- **Dữ liệu**: lưu trong Google Sheet của admin — danh sách món, giá, danh sách nhà hàng, và log đơn hàng.
- **Quản trị**: admin thêm/xoá/sửa món và giá trực tiếp trong Sheet, không cần sửa code.
- **Đặt hàng**: giỏ hàng, chọn ngày giao (cố định thứ 4 & thứ 6 hàng tuần, chốt đơn 4pm ngày hôm trước), địa chỉ giao hàng.
- **Ngôn ngữ & tiền tệ**: giao diện tiếng Anh (Úc), giá theo AUD, múi giờ `Australia/Hobart`.
- **Gửi đơn**: khi đặt hàng, app tự gửi email tới Gmail của bếp trung tâm với subject/nội dung/tên nhà hàng và người đặt được điền tự động.
- **Công nghệ**: HTML/CSS/JS thuần chạy trên Google Apps Script (Web App) — không cần server hay hosting riêng.

## Cấu trúc

```
src/
  Code.gs          # Backend: auth, đọc/ghi Sheet, gửi email
  Index.html       # Khung trang chính
  Stylesheet.html  # CSS
  JavaScript.html  # Logic frontend (giỏ hàng, checkout, lịch sử đơn)
  appsscript.json  # Manifest Apps Script
```

## Bắt đầu

Xem hướng dẫn triển khai chi tiết trong [SETUP.md](./SETUP.md): tạo Google Sheet với cấu trúc dữ liệu, tạo Google OAuth Client ID, và deploy Web App.
