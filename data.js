/**
 * DATA STORAGE & INITIAL CONFIGURATION FOR LABMASTER
 * Hệ thống Quản lý và Đăng ký Phòng Thực Hành 2026 - 2027
 * Không chứa dữ liệu đăng ký ảo/mẫu - Sẵn sàng cho Admin tự khai báo
 */

window.LAB_INITIAL_DATA = {
  schoolYear: '2026 - 2027',
  schoolName: 'TRƯỜNG THPT',
  yearStartDate: '2026-09-07',
  yearEndDate: '2027-05-31',
  currentWeekNumber: 7, // Tuần hiện tại: 19/10/2026 - 25/10/2026

  // Cấu hình giờ các tiết học (Admin có thể tự điều chỉnh theo hiệu lệnh trống của trường)
  periodTimes: {
    sang: {
      1: { start: '07:15', end: '08:00' },
      2: { start: '08:05', end: '08:50' },
      3: { start: '09:05', end: '09:50' },
      4: { start: '09:55', end: '10:40' },
      5: { start: '10:45', end: '11:30' }
    },
    chieu: {
      1: { start: '13:15', end: '14:00' },
      2: { start: '14:05', end: '14:50' },
      3: { start: '15:05', end: '15:50' },
      4: { start: '15:55', end: '16:40' },
      5: { start: '16:45', end: '17:30' }
    }
  },

  // Danh mục phòng thực hành ban đầu (Có vị trí cụ thể để gửi thông báo cho lớp trưởng)
  rooms: [
    {
      id: 'room_1',
      name: 'Phòng thực hành 1',
      location: 'Tầng 2 - Dãy nhà B',
      fullName: 'Phòng thực hành 1 (Tầng 2 - Dãy nhà B)',
      totalComputers: 36,
      workingComputers: 36,
      damagedComputers: 0,
      projector: 'Máy chiếu Epson HDMI',
      airConditioners: '2 máy điều hòa',
      managerName: 'Quản trị viên',
      managerEmail: 'admin@gmail.com',
      status: 'active'
    },
    {
      id: 'room_2',
      name: 'Phòng thực hành 2',
      location: 'Tầng 2 - Dãy phòng chức năng',
      fullName: 'Phòng thực hành 2 (Tầng 2 - Dãy phòng chức năng)',
      totalComputers: 36,
      workingComputers: 36,
      damagedComputers: 0,
      projector: 'Smart TV 75 inch',
      airConditioners: '2 máy điều hòa',
      managerName: 'Quản trị viên',
      managerEmail: 'admin@gmail.com',
      status: 'active'
    }
  ],

  // Danh mục Lớp thực hành kèm thông tin Lớp trưởng (Tên, SĐT, Email để gửi thông báo vào 21h)
  classes: [
    { name: '10A1', monitorName: 'Nguyễn Văn An', monitorPhone: '0912345601', monitorEmail: 'lop10a1@gmail.com' },
    { name: '10A2', monitorName: 'Trần Thị Bình', monitorPhone: '0912345602', monitorEmail: 'lop10a2@gmail.com' },
    { name: '10A3', monitorName: 'Lê Hoàng Cường', monitorPhone: '0912345603', monitorEmail: 'lop10a3@gmail.com' },
    { name: '10A4', monitorName: 'Phạm Thị Dung', monitorPhone: '0912345604', monitorEmail: 'lop10a4@gmail.com' },
    { name: '11A1', monitorName: 'Vũ Minh Đức', monitorPhone: '0912345605', monitorEmail: 'lop11a1@gmail.com' },
    { name: '11A2', monitorName: 'Đặng Ngọc Hân', monitorPhone: '0912345606', monitorEmail: 'lop11a2@gmail.com' },
    { name: '11A3', monitorName: 'Bùi Tuấn Kiệt', monitorPhone: '0912345607', monitorEmail: 'lop11a3@gmail.com' },
    { name: '11A4', monitorName: 'Đỗ Thùy Linh', monitorPhone: '0912345608', monitorEmail: 'lop11a4@gmail.com' },
    { name: '12A1', monitorName: 'Ngô Quốc Nam', monitorPhone: '0912345609', monitorEmail: 'lop12a1@gmail.com' },
    { name: '12A2', monitorName: 'Hoàng Yến Nhi', monitorPhone: '0912345610', monitorEmail: 'lop12a2@gmail.com' },
    { name: '12A3', monitorName: 'Dương Văn Phúc', monitorPhone: '0912345611', monitorEmail: 'lop12a3@gmail.com' },
    { name: '12A4', monitorName: 'Mai Phương Thảo', monitorPhone: '0912345612', monitorEmail: 'lop12a4@gmail.com' }
  ],

  // Phân môn / Môn học
  subjects: [
    'Tin học',
    'Tin học ứng dụng',
    'Lập trình máy tính',
    'Công nghệ - STEM',
    'Tiếng Anh trực tuyến',
    'Bồi dưỡng HSG',
    'Khác'
  ],

  // Danh sách tài khoản người dùng ban đầu do Admin cấp (Có mật khẩu & phân quyền)
  users: [
    {
      email: 'admin@gmail.com',
      password: 'admin',
      name: 'Quản Trị Viên Phòng Máy',
      phone: '0988888888',
      role: 'admin',
      department: 'Ban Quản Trị',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      signature: 'Quản Trị Viên'
    },
    {
      email: 'thanh.gv@gmail.com',
      password: '123',
      name: 'Thầy Phạm Đình Thanh',
      phone: '0912345678',
      role: 'teacher',
      department: 'Tổ Tin học',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=120&auto=format&fit=crop&q=80',
      signature: 'Phạm Đình Thanh'
    }
  ],

  // Tên tùy chỉnh cho các tuần do Quản trị viên đặt (Admin có thể đặt tên cho từng tuần)
  weekCustomNames: {
    1: 'Tuần 1: Khởi động năm học mới',
    7: 'Tuần 7: Thi đua dạy tốt - học tốt',
    18: 'Tuần 18: Ôn tập & Kiểm tra học kỳ 1',
    19: 'Tuần 19: Kết thúc học kỳ 1',
    35: 'Tuần 35: Ôn tập & Kiểm tra cuối năm'
  },

  // Cấu hình thông báo tự động cho lớp trưởng (Nhóm Zalo & Email)
  notificationSettings: {
    autoSendEnabled: true,
    sendHour: 21,
    sendMinute: 0,
    sendTarget: 'tomorrow',
    messageTemplate: 'Ngày mai lớp {tenLop} thực hành Tiết {tiet} ({gioBatDau} - {gioKetThuc}) tại phòng {tenPhong} vị trí {viTri}. Môn: {monHoc}. GV: {giaoVien}.'
  },

  initialBookings: [],
  initialIssues: [],
  notificationLogs: []
};
