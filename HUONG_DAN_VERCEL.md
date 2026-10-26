# HƯỚNG DẪN CHI TIẾT TRIỂN KHAI LABMASTER LÊN VERCEL 🚀

Tài liệu này hướng dẫn bạn từng bước cách đưa ứng dụng **LabMaster 2026-2027 (Sổ Thực Hành Phòng Máy)** lên nền tảng **Vercel** để sử dụng trực tuyến mọi lúc mọi nơi trên điện thoại, máy tính bảng và máy tính.

---

## BƯỚC 1: Chuẩn bị tài khoản Vercel và GitHub

1. Truy cập [github.com](https://github.com) và đăng ký/đăng nhập tài khoản.
2. Truy cập [vercel.com](https://vercel.com) và chọn **"Sign Up with GitHub"** (hoặc đăng nhập bằng Google).

---

## BƯỚC 2: Đẩy mã nguồn lên GitHub

Mở PowerShell hoặc Git Bash tại thư mục này (`c:\Users\Admin\Documents\antigravity\brave-einstein`) và chạy các lệnh:

```bash
git init
git add .
git commit -m "Khoi tao he thong LabMaster 2026-2027"
git branch -M main
```

Sau đó tạo một repository mới trên GitHub (ví dụ: `labmaster-phongmay`) và đẩy code lên:
```bash
git remote add origin https://github.com/TÊN_GITHUB_CỦA_BẠN/labmaster-phongmay.git
git push -u origin main
```

*(Nếu bạn không dùng Git dòng lệnh, bạn có thể dùng phần mềm **GitHub Desktop** kéo thả thư mục vào là xong).*

---

## BƯỚC 3: Import và Deploy trên Vercel (Chỉ 30 giây)

1. Vào trang quản trị Vercel: [vercel.com/new](https://vercel.com/new)
2. Tại mục **Import Git Repository**, bạn sẽ thấy dự án `labmaster-phongmay` vừa đẩy lên. Bấm nút **"Import"**.
3. Tại giao diện **Configure Project**:
   - **Project Name**: Giữ nguyên hoặc đặt tên theo ý muốn (ví dụ: `so-thuc-hanh-phong-may`).
   - **Framework Preset**: Chọn `Other` (vì dự án là dạng Jamstack siêu nhẹ, tương thích 100%).
   - **Root Directory**: `./` (để nguyên mặc định).
   - **Build & Output Settings**: Giữ nguyên mặc định (không cần điền lệnh build).
4. Bấm nút màu xanh **"Deploy"**.
5. Vercel sẽ tự động đóng gói trong khoảng 10 - 20 giây và hiển thị màn hình chúc mừng: **"Congratulations! You just deployed a new project to Vercel."**

---

## BƯỚC 4: Sử dụng và Cấu hình Tên Miền Riêng (Tùy chọn)

- Sau khi deploy xong, Vercel sẽ cung cấp cho bạn một đường link miễn phí trọn đời có định dạng:
  👉 `https://so-thuc-hanh-phong-may.vercel.app`
- Bạn có thể gửi link này cho toàn bộ giáo viên trong trường truy cập bằng tài khoản Gmail của mình để:
  - Xem thời khóa biểu phòng máy theo từng tuần.
  - Đăng ký tiết học cho các lớp.
  - Ký nhận đầu giờ và cuối giờ.
  - Báo hỏng thiết bị và xuất file Excel.
- Nếu trường có tên miền riêng (ví dụ: `phongmay.thptchuyen.edu.vn`), bạn vào mục **Settings -> Domains** trên Vercel để gắn tên miền chỉ trong vài phút.

---

## BƯỚC 5: Hướng Dẫn Giáo Viên Sử Dụng Gmail Đăng Nhập

1. Khi mở ứng dụng trên Vercel, bấm vào góc trên bên phải (chỗ ảnh đại diện).
2. Chọn **"Đăng nhập tài khoản Gmail khác..."**.
3. Điền địa chỉ Gmail (ví dụ: `nguyenvana.gv@gmail.com`) và Họ tên giáo viên.
4. Bấm **"Tiếp tục với Gmail này"** là hoàn tất! Hệ thống sẽ tự động lưu lại hồ sơ cho những lần truy cập sau.
5. Tài khoản Quản trị viên (Admin) mặc định: `admin.phongmay@gmail.com`. Admin có thể cấp quyền Admin cho bất kỳ Gmail nào khác ngay trong bảng **"Quản trị & Phân quyền Gmail"**.
