# LabMaster 2026-2027 🖥️
## Sổ Thực Hành & Quản Lý Phòng Thực Hành Trực Tuyến

> **Hệ thống Quản lý Sổ Thực Hành Phòng Máy Khai Báo Động**, thiết kế theo chuẩn năm học **2026 - 2027** (bắt đầu tháng 09/2026 đến hết tháng 05/2027).  
> **Không chứa dữ liệu ảo/mẫu** — Admin tự do khai báo tên phòng, danh sách lớp, tài khoản Gmail người dùng (trực tiếp hoặc qua Excel), phân quyền, đặt tên từng tuần thực hành, và cung cấp trang **Tra Cứu Lịch Hôm Nay** trực quan cho Giáo viên & Học sinh. Sẵn sàng 100% triển khai miễn phí lên **Vercel**.

---

## 🌟 Các Tính Năng Mới & Nổi Bật

### 1. Dữ Liệu Sạch Sẽ (Không Rác Dữ Liệu Ảo)
- Toàn bộ dữ liệu đặt trước đã được xóa sạch. Hệ thống ở trạng thái tinh gọn, sẵn sàng để nhà trường đưa vào vận hành thực tế ngay lập tức.
- Có nút **"Xóa hết dữ liệu & Làm mới"** trong mục Quản trị để Admin có thể reset dữ liệu bất kỳ lúc nào chỉ với 1 click.

### 2. Trang "Hôm Nay Có Gì? (Lịch Hôm Nay Cho GV & HS)"
- **Trang chuyên dụng công khai cho Học sinh và Giáo viên**:
  - Xem ngay: **Hôm nay lớp nào thực hành ở phòng nào, tiết nào?**
  - Hiển thị rõ ràng 2 ca: **Buổi Sáng (Tiết 1 – 5)** và **Buổi Chiều (Tiết 1 – 5)**.
  - **Bộ lọc thông minh**:
    - Học sinh chỉ cần chọn lớp mình (ví dụ: `10A1`) -> Hệ thống làm nổi bật ngay tiết thực hành của lớp hôm nay!
    - Lọc theo phòng thực hành.
  - Nút chuyển nhanh: `[◀ Hôm qua]`, `[Về hôm nay]`, `[Ngày mai ▶]`.

### 3. Admin Tự Do Khai Báo Tên Phòng Thực Hành (Không Bị Ép Tên Mặc Định)
- Quản trị viên tự đặt tên các phòng thực hành theo đúng thực tế của trường:
  - Ví dụ: `Phòng Tin Học 1 - Khu Nhà B`, `Phòng Thực Hành Robot STEM`, `Phòng Lab Ngoại Ngữ Đa Năng`, v.v.
  - Khai báo vị trí khu nhà, số lượng máy tính học sinh (30, 36, 40 máy...), thiết bị máy chiếu/TV/điều hòa, cán bộ phụ trách phòng.
  - Dễ dàng sửa tên phòng hoặc xóa phòng bất cứ lúc nào. Mọi thay đổi lập tức đồng bộ sang thời khóa biểu và các form đăng ký.

### 4. Admin Khai Báo Danh Sách Lớp Thực Hành
- Thêm từng lớp lẻ hoặc **thêm nhanh hàng loạt**:
  - Chỉ cần nhập danh sách lớp cách nhau bởi dấu phẩy hoặc xuống dòng (ví dụ: `10A1, 10A2, 10A3, 11A1, 11B2, 12A1`).
  - Hệ thống tự động phân loại và đồng bộ vào dropdown đăng ký và trang tra cứu học sinh.

### 5. Khai Báo Tài Khoản Gmail & Phân Quyền (Hỗ Trợ File Excel)
- **Khai báo trực tiếp**: Nhập Họ tên, Email Gmail, Số điện thoại, Tổ bộ môn, Phân quyền (`Admin` hoặc `Giáo viên`).
- **Phân quyền 1 chạm**: Nút chuyển đổi nhanh vai trò giữa Quản trị viên và Giáo viên.
- **Nạp danh sách từ file Excel (.xlsx)**:
  - Tải file Excel mẫu chuẩn tiếng Việt chỉ với 1 click (`Mau_Danh_Sach_Giao_Vien_PhongMay.xlsx`).
  - Kéo thả file Excel để nạp hàng loạt giáo viên vào hệ thống.
- **Xuất danh sách ra Excel (.xlsx)**: Tải toàn bộ danh sách giáo viên, Gmail, số điện thoại, quyền hạn ra file Excel hoàn chỉnh.

### 6. Đặt Tên Riêng Cho Từng Tuần Thực Hành & Cấu Hình Năm Học
- Admin có thể tự đặt tên/chủ đề cho từng tuần:
  - Ví dụ: `Tuần 1: Khởi động năm học mới`, `Tuần 7: Thi đua dạy tốt - học tốt`, `Tuần 18: Ôn tập & Kiểm tra học kỳ 1`, v.v.
  - Tên tuần do Admin đặt sẽ tự động xuất hiện trên dropdown chọn tuần `Kỳ nộp *`, tiêu đề sổ và bản in sổ thực hành!
- Cấu hình năm học: Bắt đầu từ tháng 9/2026, kết thúc tháng 5/2027 (chuẩn 38 tuần).

### 7. Xuất File Excel Chuẩn & In Ấn A4
- Xuất file `.xlsx` chuẩn 2 bảng Sáng & Chiều theo đúng biểu mẫu sổ thực hành gốc.
- In ấn A4 Landscape chuẩn mực nộp Ban Giám Hiệu.

---

## 🚀 Hướng Dẫn Chạy & Triển Khai Vercel

1. **Chạy thử ngay trên máy tính**:
   - Click đúp vào file `chay_thu_web.bat` hoặc mở file `index.html` bằng trình duyệt web.
2. **Triển khai lên Vercel miễn phí 100%**:
   - Đẩy mã nguồn lên GitHub -> Vào [vercel.com/new](https://vercel.com/new) -> Import dự án -> Bấm **Deploy**.
   - Xem hướng dẫn chi tiết tại file `HUONG_DAN_VERCEL.md`.
