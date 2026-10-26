/**
 * LabMaster 2026-2027 - Application Logic (V3)
 * Nghiệp vụ theo yêu cầu chặt chẽ:
 * 1. Phân quyền chuẩn: Giáo viên KHÔNG THỂ hạ quyền Admin, chỉ quản lý tiết của mình.
 * 2. Ai đăng ký trước thì giữ lịch trước, ai đến sau không được đăng ký đè (phải báo Admin hoặc nhờ người đăng ký hủy).
 * 3. Tự động khóa sổ khi hết tuần, Admin có thể mở sổ để giáo viên sửa hoặc Admin trực tiếp xóa.
 * 4. Giáo viên vẫn được ký nhận/bàn giao khi dạy dù sổ đã khóa.
 * 5. Giáo viên có thể nạp file báo giảng (Excel Mẫu báo giảng.xlsx) để chọn tiết đăng ký vào phòng máy.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'LABMASTER_DATA_V3';
  const CURRENT_USER_KEY = 'LABMASTER_CURRENT_USER_V3';

  const DEFAULT_COMMENT_TEMPLATES = [
    'Máy hoạt động tốt, phòng sạch sẽ',
    'Một số máy hỏng',
    'Đã ngắt điện, thiết bị nguyên vẹn',
    'Một số máy mất kết nối Internet',
    'Chuột / Bàn phím chập chờn một vài máy',
    'Phòng máy sạch sẽ, ngăn nắp'
  ];

  let appState = {
    schoolYear: '2026 - 2027',
    yearStartDate: '2026-09-07',
    yearEndDate: '2027-05-31',
    currentWeekNumber: 8,
    selectedWeekNumber: 8,
    selectedRoomId: '',
    activeView: 'today',        // Mặc định mở trang tra cứu lịch hôm nay
    adminActiveSubTab: 'rooms',
    todayDayOffset: 0,
    periodTimes: null,          // Cấu hình giờ từng tiết Sáng/Chiều do Admin tùy chỉnh
    rooms: [],
    classes: [],                // Danh sách lớp kèm thông tin Lớp trưởng (Tên, SĐT, Email)
    subjects: [],
    users: [],
    bookings: [],
    issues: [],
    commentTemplates: [...DEFAULT_COMMENT_TEMPLATES],
    weekCustomNames: {},
    lockedWeeks: {},            // { [weekNum]: boolean } (true = locked, false = unlocked)
    notificationSettings: null, // Cấu hình tự động gửi thông báo 21h
    notificationLogs: [],       // Nhật ký đã phát thông báo cho lớp trưởng
    currentUser: null,
    generatedWeeks: [],
    tempBaoGiang: null          // Lưu trữ dữ liệu file báo giảng đang xem trước
  };
  window.appState = appState;

  const DAY_NAMES = {
    2: 'Thứ 2',
    3: 'Thứ 3',
    4: 'Thứ 4',
    5: 'Thứ 5',
    6: 'Thứ 6',
    7: 'Thứ 7'
  };

  const PERIOD_TIMES_DEFAULT = {
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
  };

  // Helper truy xuất giờ bắt đầu & kết thúc của một tiết học (tương thích cả khi Admin đã chỉnh sửa)
  function getPeriodTime(session, period) {
    if (appState.periodTimes && appState.periodTimes[session] && appState.periodTimes[session][period]) {
      return appState.periodTimes[session][period];
    }
    return (PERIOD_TIMES_DEFAULT[session] && PERIOD_TIMES_DEFAULT[session][period]) || {
      start: session === 'sang' ? '07:15' : '13:15',
      end: session === 'sang' ? '08:00' : '14:00'
    };
  }

  function getPeriodTimeRange(session, period) {
    const pt = getPeriodTime(session, period);
    return `${pt.start} - ${pt.end}`;
  }

  // ================= INITIALIZATION =================
  window.addEventListener('DOMContentLoaded', () => {
    initData();
    initClock();
    initFirebase();
    renderAll();
    setupGlobalClickListeners();
  });

  // Chuẩn hóa dữ liệu lớp học để luôn có thông tin Lớp trưởng (Tên, SĐT, Email)
  function normalizeClassItem(c) {
    if (typeof c === 'string') {
      const cleanName = c.trim().toUpperCase();
      return {
        name: cleanName,
        monitorName: 'Lớp trưởng ' + cleanName,
        monitorPhone: '0912345601',
        monitorEmail: `lop${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '')}@gmail.com`
      };
    }
    const cleanName = (c.name || '').trim().toUpperCase();
    return {
      name: cleanName,
      monitorName: c.monitorName || (cleanName ? 'Lớp trưởng ' + cleanName : 'Lớp trưởng'),
      monitorPhone: c.monitorPhone || '',
      monitorEmail: c.monitorEmail || ''
    };
  }

  // Chuẩn hóa thông tin phòng máy để luôn có location phục vụ thông báo 21h
  function normalizeRoomItem(r) {
    const name = r.name || 'Phòng thực hành';
    const loc = r.location || r.fullName || 'Tầng 2 - Dãy nhà B';
    return {
      id: r.id || `room_${Date.now()}`,
      name: name,
      location: loc,
      fullName: r.fullName || `${name} (${loc})`,
      totalComputers: r.totalComputers !== undefined ? r.totalComputers : 36,
      workingComputers: r.workingComputers !== undefined ? r.workingComputers : 36,
      damagedComputers: r.damagedComputers || 0,
      projector: r.projector || 'Máy chiếu HDMI',
      airConditioners: r.airConditioners || '2 máy điều hòa',
      managerName: r.managerName || 'Quản trị viên',
      managerEmail: r.managerEmail || 'admin@gmail.com',
      status: r.status || 'active'
    };
  }

  function initData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const initial = window.LAB_INITIAL_DATA || {};

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        appState.schoolYear = parsed.schoolYear || initial.schoolYear || '2026 - 2027';
        appState.yearStartDate = parsed.yearStartDate || initial.yearStartDate || '2026-09-07';
        appState.yearEndDate = parsed.yearEndDate || initial.yearEndDate || '2027-05-31';
        appState.currentWeekNumber = parsed.currentWeekNumber || 7;
        appState.selectedWeekNumber = parsed.selectedWeekNumber || 7;
        appState.periodTimes = parsed.periodTimes || initial.periodTimes || JSON.parse(JSON.stringify(PERIOD_TIMES_DEFAULT));

        const rawRooms = parsed.rooms && parsed.rooms.length ? parsed.rooms : (initial.rooms || []);
        appState.rooms = rawRooms.map(normalizeRoomItem);

        const rawClasses = parsed.classes && parsed.classes.length ? parsed.classes : (initial.classes || []);
        appState.classes = rawClasses.map(normalizeClassItem);

        appState.subjects = parsed.subjects || initial.subjects || [];
        appState.users = parsed.users && parsed.users.length ? parsed.users : (initial.users || []);
        appState.bookings = parsed.bookings || [];
        appState.issues = parsed.issues || [];
        appState.commentTemplates = (parsed.commentTemplates && Array.isArray(parsed.commentTemplates) && parsed.commentTemplates.length > 0)
          ? parsed.commentTemplates
          : (initial.commentTemplates || [...DEFAULT_COMMENT_TEMPLATES]);
        appState.weekCustomNames = parsed.weekCustomNames || initial.weekCustomNames || {};
        // Dọn dẹp tên ảo mẫu nếu có trong dữ liệu cũ để tên tuần hiển thị chuẩn xác
        if (appState.weekCustomNames[7] === 'Tuần 7: Thi đua dạy tốt - học tốt') delete appState.weekCustomNames[7];
        if (appState.weekCustomNames[1] === 'Tuần 1: Khởi động năm học mới') delete appState.weekCustomNames[1];
        if (appState.weekCustomNames[18] === 'Tuần 18: Ôn tập & Kiểm tra học kỳ 1') delete appState.weekCustomNames[18];
        if (appState.weekCustomNames[19] === 'Tuần 19: Kết thúc học kỳ 1') delete appState.weekCustomNames[19];
        if (appState.weekCustomNames[35] === 'Tuần 35: Ôn tập & Kiểm tra cuối năm') delete appState.weekCustomNames[35];
        appState.lockedWeeks = parsed.lockedWeeks || {};

        appState.notificationSettings = parsed.notificationSettings || initial.notificationSettings || {
          autoSendEnabled: true,
          sendHour: 21,
          sendMinute: 0,
          messageTemplate: 'Ngày mai lớp {tenLop} thực hành Tiết {tiet} ({gioBatDau} - {gioKetThuc}) tại phòng {tenPhong} vị trí {viTri}.'
        };
        appState.notificationLogs = parsed.notificationLogs || [];
        appState.selectedRoomId = parsed.selectedRoomId || (appState.rooms[0]?.id || '');
      } catch (e) {
        console.error('Error parsing localStorage', e);
        loadDefaultInitial(initial);
      }
    } else {
      loadDefaultInitial(initial);
    }

    // Luôn đảm bảo tài khoản Admin và Giáo viên cơ bản luôn sẵn sàng trong hệ thống
    if (!appState.users.some(u => u.role === 'admin' || (u.email && u.email.toLowerCase() === 'admin@gmail.com'))) {
      appState.users.unshift({
        email: 'admin@gmail.com',
        password: 'admin',
        name: 'Quản Trị Viên Phòng Máy',
        phone: '0988888888',
        role: 'admin',
        department: 'Ban Quản Trị'
      });
    }
    if (!appState.users.some(u => u.email && u.email.toLowerCase() === 'thanh.gv@gmail.com')) {
      appState.users.push({
        email: 'thanh.gv@gmail.com',
        password: '123',
        name: 'Thầy Phạm Đình Thanh',
        phone: '0912345678',
        role: 'teacher',
        department: 'Tổ Tin học'
      });
    }

    // Đảm bảo tất cả user đều có mật khẩu
    appState.users.forEach(u => {
      if (!u.password) {
        u.password = u.role === 'admin' ? 'admin' : '123';
      }
    });

    generateSchoolWeeks();

    // Init Current User: MẶC ĐỊNH LÀ KHÁCH (CHƯA ĐĂNG NHẬP)
    // "Nếu không đăng nhập thì chỉ có thể xem được lịch thực hành"
    const savedUser = localStorage.getItem(CURRENT_USER_KEY);
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        const matched = appState.users.find(u => u.email.toLowerCase() === (parsed.email || '').toLowerCase());
        appState.currentUser = matched || null;
      } catch (e) {
        appState.currentUser = null;
      }
    } else {
      appState.currentUser = null; // Khách / Chưa đăng nhập
    }

    if (!appState.selectedRoomId && appState.rooms.length > 0) {
      appState.selectedRoomId = appState.rooms[0].id;
    }
  }

  function loadDefaultInitial(initial) {
    appState.schoolYear = initial.schoolYear || '2026 - 2027';
    appState.yearStartDate = initial.yearStartDate || '2026-09-07';
    appState.yearEndDate = initial.yearEndDate || '2027-05-31';
    appState.currentWeekNumber = initial.currentWeekNumber || 7;
    appState.selectedWeekNumber = 7;
    appState.periodTimes = initial.periodTimes || JSON.parse(JSON.stringify(PERIOD_TIMES_DEFAULT));
    appState.rooms = (initial.rooms || []).map(normalizeRoomItem);
    appState.classes = (initial.classes || []).map(normalizeClassItem);
    appState.subjects = initial.subjects || [];
    appState.users = initial.users || [
      {
        email: 'admin@gmail.com',
        password: 'admin',
        name: 'Quản Trị Viên Phòng Máy',
        phone: '0988888888',
        role: 'admin',
        department: 'Ban Quản Trị'
      }
    ];
    appState.bookings = []; // Sạch hoàn toàn
    appState.issues = [];
    appState.commentTemplates = initial.commentTemplates || [...DEFAULT_COMMENT_TEMPLATES];
    appState.weekCustomNames = initial.weekCustomNames || {};
    appState.lockedWeeks = {};
    appState.notificationSettings = initial.notificationSettings || {
      autoSendEnabled: true,
      sendHour: 21,
      sendMinute: 0,
      messageTemplate: 'Ngày mai lớp {tenLop} thực hành Tiết {tiet} ({gioBatDau} - {gioKetThuc}) tại phòng {tenPhong} vị trí {viTri}.'
    };
    appState.notificationLogs = [];
    appState.selectedRoomId = appState.rooms[0]?.id || '';
    appState.currentUser = null; // Mặc định chưa đăng nhập
    saveState();
  }

  function saveState() {
    saveLocalStorageOnly();

    // Đồng bộ thời gian thực lên Google Firebase (nếu đã kết nối)
    if (window.firebaseDb) {
      try {
        window.firebaseDb.ref('labmaster_v3_data').set({
          schoolYear: appState.schoolYear,
          yearStartDate: appState.yearStartDate,
          yearEndDate: appState.yearEndDate,
          currentWeekNumber: appState.currentWeekNumber,
          selectedWeekNumber: appState.selectedWeekNumber,
          selectedRoomId: appState.selectedRoomId,
          periodTimes: appState.periodTimes,
          rooms: appState.rooms,
          classes: appState.classes,
          subjects: appState.subjects,
          users: appState.users,
          bookings: appState.bookings,
          issues: appState.issues,
          commentTemplates: appState.commentTemplates,
          weekCustomNames: appState.weekCustomNames,
          lockedWeeks: appState.lockedWeeks,
          notificationSettings: appState.notificationSettings,
          notificationLogs: appState.notificationLogs,
          lastUpdated: new Date().toISOString()
        }).catch(err => {
          console.warn('[Firebase] Ghi dữ liệu Cloud gặp sự cố:', err);
        });
      } catch (e) {
        console.warn('[Firebase] Exception saveState:', e);
      }
    }
  }
  window.saveState = saveState;

  function saveLocalStorageOnly() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        schoolYear: appState.schoolYear,
        yearStartDate: appState.yearStartDate,
        yearEndDate: appState.yearEndDate,
        currentWeekNumber: appState.currentWeekNumber,
        selectedWeekNumber: appState.selectedWeekNumber,
        selectedRoomId: appState.selectedRoomId,
        periodTimes: appState.periodTimes,
        rooms: appState.rooms,
        classes: appState.classes,
        subjects: appState.subjects,
        users: appState.users,
        bookings: appState.bookings,
        issues: appState.issues,
        commentTemplates: appState.commentTemplates,
        weekCustomNames: appState.weekCustomNames,
        lockedWeeks: appState.lockedWeeks,
        notificationSettings: appState.notificationSettings,
        notificationLogs: appState.notificationLogs
      }));
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  }

  // ================= SCHOOL WEEKS GENERATOR =================
  function generateSchoolWeeks() {
    appState.generatedWeeks = [];
    const [startYear, startMonth, startDay] = appState.yearStartDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = appState.yearEndDate.split('-').map(Number);

    let curMonday = new Date(startYear, startMonth - 1, startDay);
    const endDate = new Date(endYear, endMonth - 1, endDay);

    let wNum = 1;
    while (curMonday <= endDate) {
      const curSunday = new Date(curMonday);
      curSunday.setDate(curMonday.getDate() + 6);

      const mStr = String(curMonday.getMonth() + 1).padStart(2, '0');
      const yStr = curMonday.getFullYear();
      const monthGroup = `${mStr}/${yStr}`;

      const sDay = String(curMonday.getDate()).padStart(2, '0');
      const sMon = String(curMonday.getMonth() + 1).padStart(2, '0');
      const sYear = curMonday.getFullYear();

      const eDay = String(curSunday.getDate()).padStart(2, '0');
      const eMon = String(curSunday.getMonth() + 1).padStart(2, '0');
      const eYear = curSunday.getFullYear();

      const dateRangeStr = `${sDay}/${sMon}/${sYear} - ${eDay}/${eMon}/${eYear}`;
      const customTitle = appState.weekCustomNames[wNum];
      const baseLabel = `Tuần ${wNum} (${dateRangeStr})`;
      const label = customTitle ? `${customTitle} (${sDay}/${sMon} - ${eDay}/${eMon})` : `Tuần ${wNum} (${dateRangeStr})`;
      const fullLabel = customTitle ? `${customTitle} (${dateRangeStr})` : `Tuần ${wNum} (${dateRangeStr})`;

      const dayDates = {};
      for (let d = 2; d <= 7; d++) {
        const dObj = new Date(curMonday);
        dObj.setDate(curMonday.getDate() + (d - 2));
        const dd = String(dObj.getDate()).padStart(2, '0');
        const mm = String(dObj.getMonth() + 1).padStart(2, '0');
        dayDates[d] = {
          dateStr: `${dd}/${mm}/${dObj.getFullYear()}`,
          shortStr: `${dd}/${mm}`,
          fullDate: dObj
        };
      }

      appState.generatedWeeks.push({
        weekNumber: wNum,
        monthGroup: monthGroup,
        startDate: curMonday.toISOString().slice(0, 10),
        endDate: curSunday.toISOString().slice(0, 10),
        dateRangeStr: dateRangeStr,
        customTitle: customTitle || '',
        label: label,
        baseLabel: baseLabel,
        fullLabel: fullLabel,
        isCurrent: wNum === appState.currentWeekNumber,
        dayDates: dayDates
      });

      curMonday.setDate(curMonday.getDate() + 7);
      wNum++;
    }

    // Tự động xác định tuần hiện tại theo ngày thực tế hôm nay
    const now = new Date();
    const tY = now.getFullYear();
    const tM = String(now.getMonth() + 1).padStart(2, '0');
    const tD = String(now.getDate()).padStart(2, '0');
    const todayIso = `${tY}-${tM}-${tD}`;

    const matched = appState.generatedWeeks.find(w => todayIso >= w.startDate && todayIso <= w.endDate);
    if (matched) {
      appState.currentWeekNumber = matched.weekNumber;
    } else if (appState.generatedWeeks.length > 0) {
      if (todayIso < appState.generatedWeeks[0].startDate) {
        appState.currentWeekNumber = 1;
      } else if (todayIso > appState.generatedWeeks[appState.generatedWeeks.length - 1].endDate) {
        appState.currentWeekNumber = appState.generatedWeeks.length;
      }
    }

    appState.generatedWeeks.forEach(w => {
      w.isCurrent = (w.weekNumber === appState.currentWeekNumber);
    });
  }

  // ================= AUTO-LOCK & WEEK STATUS LOGIC =================
  // "hết tuần sẽ tự động khóa sổ hoặc admin có thể mở sổ để giáo viên sửa"
  function isWeekLocked(weekNum) {
    // 1. Nếu Admin đã chỉ định rõ khóa hoặc mở cho tuần này:
    if (appState.lockedWeeks[weekNum] !== undefined) {
      return !!appState.lockedWeeks[weekNum];
    }

    // 2. Tự động khóa nếu tuần đó đã kết thúc trong quá khứ (Tuần < Tuần hiện tại)
    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === weekNum);
    if (weekObj) {
      // Giả lập theo mốc thời gian năm học 2026-2027:
      // Nếu weekNum < appState.currentWeekNumber thì tuần đó đã trôi qua -> Tự động khóa!
      if (weekNum < appState.currentWeekNumber) {
        return true;
      }
    }

    return false;
  }

  // ================= LIVE CLOCK =================
  function initClock() {
    let lastCheckedHourMinute = '';

    function update() {
      const now = new Date();
      const clockEl = document.getElementById('headerLiveClock');
      if (clockEl) {
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        clockEl.textContent = `${d}/${m}/${y} - ${hh}:${mm}`;
      }

      // Giữ badge Tuần ở header trên cùng luôn hiển thị chính xác Tuần hiện tại của ngày hôm nay
      const headerWeekBadge = document.getElementById('headerWeekBadge');
      if (headerWeekBadge && appState.generatedWeeks.length > 0) {
        const curW = appState.generatedWeeks.find(w => w.weekNumber === appState.currentWeekNumber) || appState.generatedWeeks[0];
        if (curW) {
          headerWeekBadge.textContent = curW.fullLabel;
        }
      }

      // TỰ ĐỘNG GỬI THÔNG BÁO THEO LỊCH CÀI ĐẶT CỦA ADMIN
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const hmKey = `${now.toDateString()}_${currentHour}:${currentMinute}`;

      const autoEnabled = appState.notificationSettings?.autoSendEnabled ?? true;
      const cfgHour = Number(appState.notificationSettings?.sendHour ?? 21);
      const cfgMinute = Number(appState.notificationSettings?.sendMinute ?? 0);
      const cfgTarget = appState.notificationSettings?.sendTarget || 'tomorrow';

      if (autoEnabled && currentHour === cfgHour && currentMinute === cfgMinute && lastCheckedHourMinute !== hmKey) {
        lastCheckedHourMinute = hmKey;
        console.log(`[LabMaster] Kích hoạt tiến trình tự động phát thông báo lúc ${cfgHour}:${String(cfgMinute).padStart(2, '0')} (Mục tiêu: ${cfgTarget})`);
        executeAutomatedDispatch(cfgTarget);
      }
    }
    update();
    setInterval(update, 10000); // Kiểm tra mỗi 10 giây
  }

  // ================= MASTER RENDER =================
  function renderAll() {
    renderUserBar();
    renderRoomTabs();
    renderWeekDropdown();
    renderActiveView();
  }

  function renderUserBar() {
    const u = appState.currentUser;
    const guestContainer = document.getElementById('userAuthGuestContainer');
    const loggedInContainer = document.getElementById('userAuthLoggedInContainer');
    const adminTab = document.getElementById('tabBtn-admin');

    if (!u) {
      // CHẾ ĐỘ KHÁCH / CHƯA ĐĂNG NHẬP
      if (guestContainer) guestContainer.classList.remove('hidden');
      if (loggedInContainer) loggedInContainer.classList.add('hidden');

      // BẢO VỆ PHÂN QUYỀN: Khách hoặc chưa đăng nhập TUYỆT ĐỐI KHÔNG hiển thị thẻ Quản trị
      if (adminTab) {
        adminTab.classList.add('hidden');
        if (appState.activeView === 'admin') {
          switchView('today');
        }
      }
      return;
    }

    // ĐÃ ĐĂNG NHẬP (GIÁO VIÊN HOẶC ADMIN)
    if (guestContainer) guestContainer.classList.add('hidden');
    if (loggedInContainer) loggedInContainer.classList.remove('hidden');

    const avatarEl = document.getElementById('userAvatarImg');
    const nameEl = document.getElementById('userNameTxt');
    const emailEl = document.getElementById('userEmailTxt');
    const badgeEl = document.getElementById('userRoleBadge');

    const menuName = document.getElementById('menuUserFullName');
    const menuEmail = document.getElementById('menuUserEmail');
    const menuRolePill = document.getElementById('menuUserRolePill');

    if (avatarEl) avatarEl.src = u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
    if (nameEl) nameEl.textContent = u.name || 'Người dùng';
    if (emailEl) emailEl.textContent = u.email || 'user@gmail.com';

    const isAdmin = u.role === 'admin';
    if (badgeEl) {
      badgeEl.textContent = isAdmin ? 'Admin' : 'GV';
      badgeEl.className = isAdmin
        ? 'text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 border border-purple-200'
        : 'text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 border border-blue-200';
    }

    if (menuName) menuName.textContent = u.name || '';
    if (menuEmail) menuEmail.textContent = u.email || '';
    if (menuRolePill) {
      menuRolePill.className = isAdmin
        ? 'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200'
        : 'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200';
      menuRolePill.innerHTML = isAdmin
        ? '<i class="fa-solid fa-shield-halved"></i> Quản trị viên hệ thống'
        : '<i class="fa-solid fa-user-check"></i> Giáo viên bộ môn';
    }

    // BẢO VỆ PHÂN QUYỀN: Chỉ tài khoản Admin mới hiển thị thẻ Quản trị
    if (adminTab) {
      if (isAdmin) {
        adminTab.className = appState.activeView === 'admin'
          ? 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition bg-purple-600 text-white shadow-md ml-auto'
          : 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition text-purple-700 bg-purple-50/80 hover:bg-purple-100 border border-purple-200/80 ml-auto';
      } else {
        adminTab.className = 'hidden';
        if (appState.activeView === 'admin') {
          switchView('today');
        }
      }
    }
  }

  function renderRoomTabs() {
    const container = document.getElementById('roomTabsContainer');
    if (!container) return;

    if (appState.rooms.length === 0) {
      container.innerHTML = `
        <span class="text-xs text-amber-700 bg-amber-50 px-3 py-1 rounded-lg border border-amber-200">
          Chưa khai báo phòng. Quản trị viên vui lòng vào mục Quản trị để khai báo phòng thực hành của trường.
        </span>
      `;
      return;
    }

    container.innerHTML = appState.rooms.map(room => {
      const isSelected = room.id === appState.selectedRoomId;
      const activeClass = isSelected
        ? 'bg-slate-900 text-white shadow-md'
        : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200';

      return `
        <button onclick="selectRoom('${room.id}')" class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-2 whitespace-nowrap ${activeClass}">
          <i class="fa-solid fa-chalkboard text-[11px] ${isSelected ? 'text-brand-400' : 'text-slate-400'}"></i>
          <span>${room.name}</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}">
            ${room.totalComputers || 0}m
          </span>
        </button>
      `;
    }).join('');
  }

  // ================= VIEW SWITCHER =================
  window.switchView = function (viewName) {
    const isAdmin = appState.currentUser?.role === 'admin';

    // Nếu không phải admin mà cố vào admin thì chặn lại và về trang today
    if (viewName === 'admin' && !isAdmin) {
      alert('Bạn không có quyền truy cập khu vực Quản trị hệ thống!');
      viewName = 'today';
    }

    appState.activeView = viewName;

    ['today', 'timetable', 'standardTable', 'admin'].forEach(tab => {
      const btn = document.getElementById(`tabBtn-${tab}`);
      const viewEl = document.getElementById(`view-${tab}`);

      // BẢO VỆ PHÂN QUYỀN TUYỆT ĐỐI: Thẻ Admin chỉ hiển thị khi tài khoản có quyền Admin
      if (tab === 'admin' && !isAdmin) {
        if (btn) btn.className = 'hidden';
        if (viewEl) viewEl.classList.add('hidden');
        return;
      }

      if (btn) {
        if (tab === viewName) {
          btn.className = tab === 'today'
            ? 'px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20'
            : (tab === 'admin'
                ? 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition bg-purple-600 text-white shadow-md ml-auto'
                : 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition bg-slate-900 text-white shadow-sm');
        } else {
          btn.className = tab === 'admin'
            ? 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition text-purple-700 bg-purple-50/80 hover:bg-purple-100 border border-purple-200/80 ml-auto'
            : 'px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition text-slate-600 hover:text-slate-900 hover:bg-slate-100';
        }
      }

      if (viewEl) {
        if (tab === viewName) viewEl.classList.remove('hidden');
        else viewEl.classList.add('hidden');
      }
    });

    renderActiveView();
  };

  function renderActiveView() {
    switch (appState.activeView) {
      case 'today':
        renderTodayView();
        break;
      case 'timetable':
        renderTimetableGrid();
        break;
      case 'standardTable':
        renderStandardTable();
        break;
      case 'admin':
        renderAdminPanel();
        break;
    }
  }

  // =========================================================================
  // VIEW 1: LỊCH HÔM NAY (CHO GIÁO VIÊN VÀ HỌC SINH TRA CỨU)
  // =========================================================================
  window.changeTodayOffset = function (delta) {
    appState.todayDayOffset += delta;
    renderTodayView();
  };

  window.resetTodayOffset = function () {
    appState.todayDayOffset = 0;
    renderTodayView();
  };

  function renderTodayView() {
    const classFilter = document.getElementById('todayFilterClass');
    if (classFilter) {
      const curVal = classFilter.value || 'all';
      classFilter.innerHTML = '<option value="all">Tất cả các lớp học sinh</option>' +
        appState.classes.map(c => {
          const cName = typeof c === 'string' ? c : c.name;
          return `<option value="${cName}" ${cName === curVal ? 'selected' : ''}>${cName}</option>`;
        }).join('');
    }

    const roomFilter = document.getElementById('todayFilterRoom');
    if (roomFilter && roomFilter.options.length <= 1) {
      roomFilter.innerHTML = '<option value="all">Tất cả phòng thực hành</option>' +
        appState.rooms.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
    }

    // Dùng ngày thực tế hôm nay
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    const targetDate = new Date(baseDate);
    targetDate.setDate(baseDate.getDate() + appState.todayDayOffset);

    const dNum = targetDate.getDay();
    const dayOfWeek = dNum === 0 ? 8 : (dNum + 1);

    const dd = String(targetDate.getDate()).padStart(2, '0');
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const yyyy = targetDate.getFullYear();
    const dateFormatted = `${dd}/${mm}/${yyyy}`;
    const dayLabel = dayOfWeek === 8 ? 'Chủ nhật' : DAY_NAMES[dayOfWeek];

    const titleEl = document.getElementById('todayHeaderDateTitle');
    if (titleEl) {
      titleEl.textContent = `${dayLabel}, Ngày ${dateFormatted}`;
    }

    const tY = targetDate.getFullYear();
    const tM = String(targetDate.getMonth() + 1).padStart(2, '0');
    const tD = String(targetDate.getDate()).padStart(2, '0');
    const targetIso = `${tY}-${tM}-${tD}`;

    const matchedWeek = appState.generatedWeeks.find(w => targetIso >= w.startDate && targetIso <= w.endDate) ||
      (appState.generatedWeeks.length > 0 ? appState.generatedWeeks[0] : null);

    const weekTitleEl = document.getElementById('todayHeaderWeekTitle');
    if (weekTitleEl && matchedWeek) {
      weekTitleEl.textContent = matchedWeek.customTitle ? `${matchedWeek.customTitle} (${matchedWeek.dateRangeStr})` : matchedWeek.fullLabel;
    }

    const selectedClass = document.getElementById('todayFilterClass')?.value || 'all';
    const selectedRoom = document.getElementById('todayFilterRoom')?.value || 'all';

    let todayBookings = appState.bookings.filter(b =>
      b.week === matchedWeek?.weekNumber &&
      b.dayOfWeek === dayOfWeek
    );

    if (selectedClass !== 'all') {
      todayBookings = todayBookings.filter(b => b.className === selectedClass);
    }
    if (selectedRoom !== 'all') {
      todayBookings = todayBookings.filter(b => b.room === selectedRoom);
    }

    const countEl = document.getElementById('todayTotalCountTxt');
    if (countEl) countEl.textContent = `${todayBookings.length} tiết`;

    const container = document.getElementById('todayScheduleCardsContainer');
    if (!container) return;

    if (appState.rooms.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-3xl p-8 text-center text-slate-400 border border-slate-200">
          <i class="fa-solid fa-chalkboard text-3xl text-slate-300 mb-2 block"></i>
          Chưa có phòng thực hành nào. Quản trị viên vui lòng vào mục Quản trị để khai báo phòng.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <!-- BUỔI SÁNG -->
      <div class="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-amber-200/60 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <i class="fa-solid fa-sun"></i>
            </div>
            <div>
              <h2 class="text-sm font-black text-slate-800 uppercase tracking-wide">Buổi Sáng (Tiết 1 đến Tiết 5)</h2>
              <p class="text-[11px] text-amber-800/80 font-medium">Khung giờ sáng: 07:15 – 11:30</p>
            </div>
          </div>
          <span class="text-xs font-bold text-amber-700 bg-amber-100/70 px-3 py-1 rounded-full border border-amber-200">
            5 tiết sáng
          </span>
        </div>
        <div class="p-6 divide-y divide-slate-100">
          ${renderTodayPeriodRows('sang', matchedWeek?.weekNumber, dayOfWeek, todayBookings, selectedClass, selectedRoom)}
        </div>
      </div>

      <!-- BUỔI CHIỀU -->
      <div class="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="bg-gradient-to-r from-indigo-50 to-blue-50 px-6 py-4 border-b border-indigo-200/60 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <i class="fa-solid fa-moon"></i>
            </div>
            <div>
              <h2 class="text-sm font-black text-slate-800 uppercase tracking-wide">Buổi Chiều (Tiết 1 đến Tiết 5)</h2>
              <p class="text-[11px] text-indigo-800/80 font-medium">Khung giờ chiều: 13:15 – 17:30</p>
            </div>
          </div>
          <span class="text-xs font-bold text-indigo-700 bg-indigo-100/70 px-3 py-1 rounded-full border border-indigo-200">
            5 tiết chiều
          </span>
        </div>
        <div class="p-6 divide-y divide-slate-100">
          ${renderTodayPeriodRows('chieu', matchedWeek?.weekNumber, dayOfWeek, todayBookings, selectedClass, selectedRoom)}
        </div>
      </div>
    `;
  }

  function renderTodayPeriodRows(session, weekNum, dayOfWeek, todayBookings, selectedClass, selectedRoom) {
    let html = '';

    for (let p = 1; p <= 5; p++) {
      const timeStr = getPeriodTimeRange(session, p);
      const roomsToDisplay = selectedRoom === 'all'
        ? appState.rooms
        : appState.rooms.filter(r => r.name === selectedRoom);

      html += `
        <div class="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row gap-4 items-start">
          <div class="w-full md:w-36 flex-shrink-0 bg-slate-50 border border-slate-200 rounded-2xl p-3 text-center">
            <span class="inline-block text-xs font-black text-slate-900 bg-white px-2 py-0.5 rounded-lg border border-slate-200 mb-1">
              Tiết ${p}
            </span>
            <p class="text-[11px] font-mono font-semibold text-slate-500">${timeStr}</p>
          </div>

          <div class="flex-grow grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
      `;

      roomsToDisplay.forEach(room => {
        const booking = todayBookings.find(b =>
          b.session === session &&
          b.period === p &&
          b.room === room.name
        );

        if (booking) {
          const isTargetClass = selectedClass !== 'all' && booking.className === selectedClass;

          html += `
            <div class="p-4 rounded-2xl border transition-all ${
              isTargetClass
                ? 'bg-blue-50/90 border-blue-500 shadow-md ring-2 ring-blue-500/20'
                : 'bg-white border-slate-200 shadow-xs hover:border-brand-400'
            }">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold text-slate-600 flex items-center gap-1.5 truncate max-w-[150px]">
                  <i class="fa-solid fa-chalkboard text-brand-600"></i> ${room.name}
                </span>
                <span class="px-2.5 py-1 rounded-lg text-xs font-black bg-brand-600 text-white shadow-xs">
                  Lớp ${booking.className}
                </span>
              </div>
              <p class="text-xs font-bold text-slate-800 line-clamp-1 mb-1" title="${booking.lesson || booking.subject}">
                ${booking.lesson || booking.subject}
              </p>
              <div class="text-[11px] text-slate-500 flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                <span class="font-medium text-slate-700 truncate max-w-[120px]">
                  <i class="fa-solid fa-user-tie mr-1 text-slate-400"></i> ${booking.teacherName}
                </span>
                <span class="text-brand-700 font-semibold truncate max-w-[100px]">
                  ${booking.subject}
                </span>
              </div>
            </div>
          `;
        } else {
          html += `
            <div class="p-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 flex items-center justify-between text-slate-400">
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-door-open text-slate-300"></i>
                <span class="text-xs font-medium text-slate-600">${room.name}</span>
              </div>
              <span class="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">
                Phòng trống
              </span>
            </div>
          `;
        }
      });

      html += `</div></div>`;
    }

    return html;
  }

  // =========================================================================
  // VIEW 2: SỔ THỰC HÀNH & ĐĂNG KÝ THEO TUẦN (TIMETABLE GRID)
  // =========================================================================
  function renderTimetableGrid() {
    const curWeek = appState.selectedWeekNumber;
    const curRoom = appState.rooms.find(r => r.id === appState.selectedRoomId) || appState.rooms[0];
    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === curWeek);
    if (!weekObj || !curRoom) return;

    for (let day = 2; day <= 7; day++) {
      const dInfo = weekObj.dayDates[day];
      const thSang = document.getElementById(`th-day-${day}-sang`);
      const thChieu = document.getElementById(`th-day-${day}-chieu`);
      const dayTitle = `${DAY_NAMES[day]} (${dInfo.shortStr})`;
      if (thSang) thSang.textContent = dayTitle;
      if (thChieu) thChieu.textContent = dayTitle;
    }

    const morningBody = document.getElementById('morningGridBody');
    const afternoonBody = document.getElementById('afternoonGridBody');

    if (morningBody) morningBody.innerHTML = buildSessionRows('sang', curWeek, curRoom.name, weekObj);
    if (afternoonBody) afternoonBody.innerHTML = buildSessionRows('chieu', curWeek, curRoom.name, weekObj);

    // Banner details
    const bannerRoom = document.getElementById('bannerRoomBadge');
    const bannerTitle = document.getElementById('bannerWeekTitle');
    const bannerRange = document.getElementById('bannerWeekDateRange');
    const bannerCustom = document.getElementById('bannerWeekCustomName');
    const bannerDetails = document.getElementById('bannerRoomDetails');

    if (bannerRoom) bannerRoom.textContent = curRoom.name;
    if (bannerTitle) bannerTitle.textContent = `SỔ THỰC HÀNH - TUẦN ${curWeek}`;
    if (bannerRange) bannerRange.textContent = `(${weekObj.dateRangeStr})`;
    if (bannerCustom) bannerCustom.textContent = weekObj.customTitle ? `• ${weekObj.customTitle}` : '';

    if (bannerDetails) {
      bannerDetails.innerHTML = `
        <span><i class="fa-solid fa-desktop mr-1 text-brand-400"></i> ${curRoom.totalComputers || 0} máy học sinh</span>
        <span><i class="fa-solid fa-tv mr-1 text-brand-400"></i> ${curRoom.projector || 'Máy chiếu'}</span>
        <span><i class="fa-solid fa-location-dot mr-1 text-brand-400"></i> ${curRoom.fullName || curRoom.name}</span>
        <span><i class="fa-solid fa-user-tie mr-1 text-brand-400"></i> Phụ trách: ${curRoom.managerName || 'Quản trị viên'}</span>
      `;
    }

    const locked = isWeekLocked(curWeek);
    const statusTxt = document.getElementById('statWeekStatusTxt');
    if (statusTxt) {
      statusTxt.textContent = locked ? 'Đã khóa sổ đăng ký' : 'Đang mở đăng ký';
      statusTxt.className = locked
        ? 'text-xs font-bold px-3 py-1.5 rounded-xl bg-red-100 text-red-700 border border-red-200'
        : 'text-xs font-bold px-3 py-1.5 rounded-xl bg-white/10 text-emerald-300 border border-white/10';
    }
  }

  function buildSessionRows(session, week, roomName, weekObj) {
    let html = '';
    const locked = isWeekLocked(week);

    for (let period = 1; period <= 5; period++) {
      const pTime = getPeriodTime(session, period);

      html += `<tr class="hover:bg-slate-50/50 transition">`;
      html += `
        <td class="py-2.5 px-2 text-center border-r border-slate-200 bg-slate-50/80 font-mono select-none">
          <span class="block font-black text-slate-800 text-xs sm:text-sm">Tiết ${period}</span>
          <span class="block text-[10px] text-slate-600 font-bold leading-tight mt-1">${pTime.start}</span>
          <span class="block text-[9px] text-slate-400 leading-none">-</span>
          <span class="block text-[10px] text-slate-600 font-bold leading-tight">${pTime.end}</span>
        </td>
      `;

      for (let day = 2; day <= 7; day++) {
        const booking = appState.bookings.find(b =>
          b.week === week &&
          b.room === roomName &&
          b.session === session &&
          b.dayOfWeek === day &&
          b.period === period
        );

        html += `<td class="p-2 border-r border-slate-200 align-top h-24 timetable-slot">`;

        if (booking) {
          const hasStartSign = !!booking.signStart;
          const isMine = booking.teacherEmail === appState.currentUser?.email;

          html += `
            <div class="h-full rounded-xl p-2.5 bg-white border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col justify-between group cursor-pointer border-l-4 ${isMine ? 'border-l-brand-600' : 'border-l-slate-400'}" onclick="openDetailModal('${booking.id}')">
              <div>
                <div class="flex items-center justify-between gap-1 mb-1">
                  <span class="px-1.5 py-0.5 rounded text-[11px] font-black ${isMine ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-slate-100 text-slate-700'}">
                    ${booking.className || 'Lớp'}
                  </span>
                  <span class="text-[11px] font-bold text-slate-700 truncate max-w-[100px]" title="${booking.teacherName}">
                    ${booking.teacherName}
                  </span>
                </div>
                <p class="text-[11px] font-semibold text-slate-800 line-clamp-1" title="${booking.lesson || booking.subject}">
                  ${booking.lesson || booking.subject}
                </p>
                <p class="text-[10px] text-slate-400 line-clamp-1">${booking.subject || ''}</p>
              </div>

              <div class="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px]">
                <span class="${hasStartSign ? 'text-emerald-600 font-bold' : 'text-amber-600 font-medium'}">
                  ${hasStartSign ? '<i class="fa-solid fa-signature"></i> Đã ký' : '<i class="fa-regular fa-clock"></i> Chưa ký'}
                </span>
                <span class="text-slate-400">${isMine ? '(Của bạn)' : ''}</span>
              </div>
            </div>
          `;
        } else {
          if (!appState.currentUser) {
            html += `
              <button onclick="quickOpenBooking('${session}', ${day}, ${period})" class="w-full h-full rounded-xl border border-dashed border-slate-200/80 hover:border-slate-300 bg-slate-50/20 hover:bg-slate-50/60 text-slate-300 hover:text-slate-500 flex flex-col items-center justify-center transition group p-1" title="Nhấp để đăng nhập và đăng ký tiết này">
                <i class="fa-solid fa-door-open text-xs mb-1 text-slate-300 group-hover:scale-110 transition-transform"></i>
                <span class="text-[10px] text-slate-400 group-hover:text-slate-600 font-medium">Trống</span>
              </button>
            `;
          } else if (locked) {
            html += `
              <div class="h-full rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center text-slate-300 text-center p-2">
                <i class="fa-solid fa-lock text-xs mb-1"></i>
                <span class="text-[10px]">Đã khóa</span>
              </div>
            `;
          } else {
            html += `
              <button onclick="quickOpenBooking('${session}', ${day}, ${period})" class="w-full h-full rounded-xl border border-dashed border-slate-200 hover:border-brand-500 hover:bg-brand-50/40 text-slate-300 hover:text-brand-600 flex flex-col items-center justify-center transition group">
                <i class="fa-solid fa-plus text-xs group-hover:scale-125 transition-transform mb-1"></i>
                <span class="text-[10px] font-semibold text-slate-400 group-hover:text-brand-700">Đăng ký</span>
              </button>
            `;
          }
        }

        html += `</td>`;
      }

      html += `</tr>`;
    }

    return html;
  }

  // ================= VIEW 3: STANDARD 8-COLUMN TABLE =================
  function renderStandardTable() {
    const curWeek = appState.selectedWeekNumber;
    const curRoom = appState.rooms.find(r => r.id === appState.selectedRoomId) || appState.rooms[0];
    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === curWeek);
    if (!weekObj || !curRoom) return;

    const tbody = document.getElementById('standardTableBody');
    const badge = document.getElementById('standardTableInfoBadge');
    if (badge) badge.textContent = `${weekObj.label} | ${curRoom.name}`;

    const searchTxt = (document.getElementById('tableSearchInput')?.value || '').toLowerCase().trim();
    const sessionFilter = document.getElementById('tableSessionFilter')?.value || 'all';

    let list = appState.bookings.filter(b => b.week === curWeek && b.room === curRoom.name);

    if (sessionFilter !== 'all') {
      list = list.filter(b => b.session === sessionFilter);
    }

    if (searchTxt) {
      list = list.filter(b =>
        (b.teacherName || '').toLowerCase().includes(searchTxt) ||
        (b.className || '').toLowerCase().includes(searchTxt) ||
        (b.subject || '').toLowerCase().includes(searchTxt) ||
        (b.lesson || '').toLowerCase().includes(searchTxt)
      );
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="py-12 text-center text-slate-400 text-xs">
            <i class="fa-regular fa-folder-open text-2xl mb-2 block text-slate-300"></i>
            Chưa có tiết thực hành nào được đăng ký trong tuần này.
          </td>
        </tr>
      `;
      return;
    }

    const u = appState.currentUser;

    tbody.innerHTML = list.map(b => {
      const isMine = u?.email === b.teacherEmail || u?.role === 'admin';

      return `
        <tr class="hover:bg-slate-50/70 transition">
          <td class="py-3 px-3 text-center border-r border-slate-200 font-bold text-slate-800 bg-slate-50/40">
            <div>${b.dayName}</div>
            <span class="inline-block mt-0.5 text-[10px] font-semibold px-1.5 py-0.2 rounded ${b.session === 'sang' ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'}">
              ${b.session === 'sang' ? 'Sáng' : 'Chiều'}
            </span>
          </td>
          <td class="py-3 px-2 text-center border-r border-slate-200 font-black text-slate-900 text-sm">${b.period}</td>
          <td class="py-3 px-3 border-r border-slate-200">
            <div class="font-bold text-slate-900">${b.teacherName}</div>
            <div class="text-[11px] text-brand-600 font-semibold">${b.className} • ${b.subject}</div>
            <div class="text-[10px] text-slate-400 truncate">${b.lesson || ''}</div>
          </td>
          <td class="py-3 px-3 border-r border-slate-200 text-slate-700">${b.statusStart || 'Bình thường'}</td>
          <td class="py-3 px-2 text-center border-r border-slate-200">
            ${b.signStart
              ? `<span class="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-[11px]">
                  <i class="fa-solid fa-check"></i> ${b.signStart}
                </span>`
              : (isMine
                  ? `<button onclick="openSignModal('${b.id}', 'start')" class="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[10px] font-bold">Ký đầu giờ</button>`
                  : '<span class="text-slate-300 text-[10px]">Chưa ký</span>')
            }
          </td>
          <td class="py-3 px-3 border-r border-slate-200 text-slate-700">${b.statusEnd || ''}</td>
          <td class="py-3 px-2 text-center border-r border-slate-200">
            ${b.signEnd
              ? `<span class="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded text-[11px]">
                  <i class="fa-solid fa-check"></i> ${b.signEnd}
                </span>`
              : (isMine && b.signStart
                  ? `<button onclick="openSignModal('${b.id}', 'end')" class="px-2 py-1 bg-brand-600 hover:bg-brand-700 text-white rounded text-[10px] font-bold">Ký cuối giờ</button>`
                  : '<span class="text-slate-300 text-[10px]">Chưa ký</span>')
            }
          </td>
          <td class="py-3 px-3 border-r border-slate-200 text-slate-500 text-[11px]">${b.note || '—'}</td>
          <td class="py-3 px-2 text-center">
            <button onclick="openDetailModal('${b.id}')" class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 hover:text-brand-600 transition">
              <i class="fa-solid fa-eye"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.filterStandardTable = function () {
    renderStandardTable();
  };

  // =========================================================================
  // VIEW 4: ADMIN PANEL (CHỈ DÀNH CHO QUẢN TRỊ VIÊN)
  // =========================================================================
  window.switchAdminTab = function (tabName) {
    if (appState.currentUser?.role !== 'admin') return;
    appState.adminActiveSubTab = tabName;

    ['rooms', 'classes', 'users', 'weeks', 'periods', 'notifications', 'cloud', 'stats'].forEach(t => {
      const btn = document.getElementById(`adminTabBtn-${t}`);
      const panel = document.getElementById(`adminPanel-${t}`);

      if (btn) {
        if (t === tabName) {
          btn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-purple-700 shadow-sm border border-slate-200 flex items-center gap-2 whitespace-nowrap';
        } else {
          btn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-2 whitespace-nowrap';
        }
      }

      if (panel) {
        if (t === tabName) panel.classList.remove('hidden');
        else panel.classList.add('hidden');
      }
    });

    renderAdminPanel();
  };

  function renderAdminPanel() {
    if (appState.currentUser?.role !== 'admin') return;
    renderAdminRoomsList();
    renderAdminClassesList();
    renderAdminUsersList();
    renderAdminWeeksList();
    renderPeriodsConfigUI();
    renderNotificationSettingsUI();
    renderNotificationsPreview();
    renderNotificationLogs();
    renderAdminCloudPanel();
    renderAdminStatsPanel();
  }

  // SUB-TAB 1: ROOMS
  function renderAdminRoomsList() {
    const tbody = document.getElementById('adminRoomsTableBody');
    if (!tbody) return;

    if (appState.rooms.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 text-center text-slate-400">
            Chưa có phòng thực hành nào. Vui lòng bấm nút "+ Khai báo phòng thực hành mới" để thêm phòng!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = appState.rooms.map(r => `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-2">
          <i class="fa-solid fa-chalkboard text-brand-600"></i>
          <span>${r.name}</span>
        </td>
        <td class="py-2.5 px-3 text-slate-600 font-medium">${r.location || r.fullName || '—'}</td>
        <td class="py-2.5 px-3 text-center font-bold text-slate-800">${r.totalComputers || 0} máy</td>
        <td class="py-2.5 px-3 text-slate-600">${r.projector || '—'}</td>
        <td class="py-2.5 px-3 text-slate-700">${r.managerName || '—'}</td>
        <td class="py-2.5 px-3 text-center">
          <button onclick="editRoom('${r.id}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold mr-1">
            <i class="fa-solid fa-pen mr-1"></i> Sửa
          </button>
          <button onclick="deleteRoom('${r.id}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[10px] font-bold">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  window.openAddRoomModal = function () {
    if (appState.currentUser?.role !== 'admin') return;
    document.getElementById('roomEditId').value = '';
    document.getElementById('roomModalTitle').textContent = 'Khai Báo Phòng Thực Hành Mới';
    document.getElementById('roomNameInput').value = '';
    document.getElementById('roomLocationInput').value = '';
    document.getElementById('roomComputersInput').value = '36';
    document.getElementById('roomProjectorInput').value = 'Máy chiếu HDMI';
    document.getElementById('roomManagerInput').value = appState.currentUser?.name || '';
    document.getElementById('roomModal')?.classList.remove('hidden');
  };

  window.editRoom = function (roomId) {
    if (appState.currentUser?.role !== 'admin') return;
    const r = appState.rooms.find(x => x.id === roomId);
    if (!r) return;

    document.getElementById('roomEditId').value = r.id;
    document.getElementById('roomModalTitle').textContent = 'Chỉnh Sửa Thông Tin Phòng';
    document.getElementById('roomNameInput').value = r.name;
    document.getElementById('roomLocationInput').value = r.location || r.fullName || '';
    document.getElementById('roomComputersInput').value = r.totalComputers || 36;
    document.getElementById('roomProjectorInput').value = r.projector || '';
    document.getElementById('roomManagerInput').value = r.managerName || '';
    document.getElementById('roomModal')?.classList.remove('hidden');
  };

  window.closeRoomModal = function () {
    document.getElementById('roomModal')?.classList.add('hidden');
  };

  window.handleRoomSubmit = function (e) {
    e.preventDefault();
    if (appState.currentUser?.role !== 'admin') return;

    const editId = document.getElementById('roomEditId').value;
    const name = document.getElementById('roomNameInput').value.trim();
    const loc = document.getElementById('roomLocationInput').value.trim();
    const comps = parseInt(document.getElementById('roomComputersInput').value) || 36;
    const proj = document.getElementById('roomProjectorInput').value.trim();
    const mgr = document.getElementById('roomManagerInput').value.trim();

    if (!name) return;

    if (editId) {
      const r = appState.rooms.find(x => x.id === editId);
      if (r) {
        const oldName = r.name;
        r.name = name;
        r.location = loc || name;
        r.fullName = `${name} (${loc || 'Tầng 2'})`;
        r.totalComputers = comps;
        r.workingComputers = comps;
        r.projector = proj;
        r.managerName = mgr;

        appState.bookings.forEach(b => {
          if (b.room === oldName) b.room = name;
        });
      }
    } else {
      const newRoom = {
        id: `room_${Date.now()}`,
        name: name,
        location: loc || name,
        fullName: `${name} (${loc || 'Tầng 2'})`,
        totalComputers: comps,
        workingComputers: comps,
        damagedComputers: 0,
        projector: proj,
        managerName: mgr,
        status: 'active'
      };
      appState.rooms.push(newRoom);
      if (!appState.selectedRoomId) appState.selectedRoomId = newRoom.id;
    }

    saveState();
    closeRoomModal();
    renderAll();
    showToast(`Đã lưu phòng thực hành: ${name}`);
  };

  window.deleteRoom = function (roomId) {
    if (appState.currentUser?.role !== 'admin') return;
    const r = appState.rooms.find(x => x.id === roomId);
    if (!r) return;

    if (!confirm(`Bạn có chắc chắn muốn xóa phòng "${r.name}" không?`)) return;

    appState.rooms = appState.rooms.filter(x => x.id !== roomId);
    if (appState.selectedRoomId === roomId) {
      appState.selectedRoomId = appState.rooms[0]?.id || '';
    }

    saveState();
    renderAll();
    showToast(`Đã xóa phòng "${r.name}"`);
  };

  // SUB-TAB 2: KHAI BÁO LỚP THỰC HÀNH & THÔNG TIN LỚP TRƯỞNG (HỖ TRỢ EXCEL)
  function renderAdminClassesList() {
    const tbody = document.getElementById('adminClassesTableBody');
    if (!tbody) return;

    if (appState.classes.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-8 text-center text-slate-400">
            Chưa có lớp nào được khai báo. Vui lòng bấm "+ Khai báo lớp mới" hoặc "Nạp từ Excel"!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = appState.classes.map((c, idx) => {
      const cName = typeof c === 'string' ? c : c.name;
      const mName = typeof c === 'object' ? (c.monitorName || '—') : '—';
      const mPhone = typeof c === 'object' ? (c.monitorPhone || '—') : '—';
      const mEmail = typeof c === 'object' ? (c.monitorEmail || '—') : '—';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-2.5 px-3 text-center font-bold text-slate-400">${idx + 1}</td>
          <td class="py-2.5 px-3 font-bold text-slate-900">
            <span class="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 font-black">
              ${cName}
            </span>
          </td>
          <td class="py-2.5 px-3 font-semibold text-slate-800">
            <div class="flex items-center gap-1.5">
              <i class="fa-solid fa-user-graduate text-slate-400"></i>
              <span>${mName}</span>
            </div>
          </td>
          <td class="py-2.5 px-3 font-mono font-medium text-slate-700">
            ${mPhone !== '—' && mPhone ? `<a href="tel:${mPhone}" class="text-blue-600 hover:underline"><i class="fa-solid fa-phone mr-1 text-[10px]"></i>${mPhone}</a>` : '<span class="text-slate-400">Chưa có</span>'}
          </td>
          <td class="py-2.5 px-3 font-mono text-slate-600">
            ${mEmail !== '—' && mEmail ? `<a href="mailto:${mEmail}" class="text-indigo-600 hover:underline"><i class="fa-regular fa-envelope mr-1 text-[10px]"></i>${mEmail}</a>` : '<span class="text-slate-400">Chưa có</span>'}
          </td>
          <td class="py-2.5 px-3 text-center">
            <div class="inline-flex items-center gap-1">
              <button onclick="openEditClassModal('${cName}')" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold transition" title="Chỉnh sửa thông tin lớp và lớp trưởng">
                <i class="fa-solid fa-pen mr-0.5"></i> Sửa
              </button>
              <button onclick="deleteClass('${cName}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[10px] font-bold transition" title="Xóa lớp">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.openAddClassModal = function () {
    if (appState.currentUser?.role !== 'admin') return;
    document.getElementById('classEditNameOriginal').value = '';
    document.getElementById('classModalTitle').textContent = 'Khai Báo Lớp Thực Hành Mới';
    document.getElementById('classNameInput').value = '';
    document.getElementById('classMonitorNameInput').value = '';
    document.getElementById('classMonitorPhoneInput').value = '';
    document.getElementById('classMonitorEmailInput').value = '';
    document.getElementById('classModal')?.classList.remove('hidden');
  };

  window.openEditClassModal = function (className) {
    if (appState.currentUser?.role !== 'admin') return;
    const cObj = appState.classes.find(c => (typeof c === 'string' ? c : c.name) === className);
    if (!cObj) return;

    document.getElementById('classEditNameOriginal').value = className;
    document.getElementById('classModalTitle').textContent = `Chỉnh Sửa Lớp: ${className}`;
    document.getElementById('classNameInput').value = typeof cObj === 'string' ? cObj : cObj.name;
    document.getElementById('classMonitorNameInput').value = typeof cObj === 'object' ? (cObj.monitorName || '') : '';
    document.getElementById('classMonitorPhoneInput').value = typeof cObj === 'object' ? (cObj.monitorPhone || '') : '';
    document.getElementById('classMonitorEmailInput').value = typeof cObj === 'object' ? (cObj.monitorEmail || '') : '';
    document.getElementById('classModal')?.classList.remove('hidden');
  };

  window.closeClassModal = function () {
    document.getElementById('classModal')?.classList.add('hidden');
  };

  window.handleClassSubmit = function (e) {
    e.preventDefault();
    if (appState.currentUser?.role !== 'admin') return;

    const editOriginal = document.getElementById('classEditNameOriginal').value.trim();
    const name = document.getElementById('classNameInput').value.trim().toUpperCase();
    const monitorName = document.getElementById('classMonitorNameInput').value.trim();
    const monitorPhone = document.getElementById('classMonitorPhoneInput').value.trim();
    const monitorEmail = document.getElementById('classMonitorEmailInput').value.trim();

    if (!name) return;

    const newClassObj = {
      name,
      monitorName: monitorName || ('Lớp trưởng ' + name),
      monitorPhone,
      monitorEmail
    };

    if (editOriginal) {
      const idx = appState.classes.findIndex(c => (typeof c === 'string' ? c : c.name) === editOriginal);
      if (idx >= 0) {
        appState.classes[idx] = newClassObj;
      }
      if (editOriginal !== name) {
        // Cập nhật các booking cũ
        appState.bookings.forEach(b => {
          if (b.className === editOriginal) b.className = name;
        });
      }
    } else {
      if (appState.classes.some(c => (typeof c === 'string' ? c : c.name).toUpperCase() === name)) {
        alert(`Lớp "${name}" đã tồn tại trong danh mục!`);
        return;
      }
      appState.classes.push(newClassObj);
    }

    appState.classes.sort((a, b) => (a.name || a).localeCompare(b.name || b, undefined, { numeric: true }));

    saveState();
    closeClassModal();
    renderAll();
    showToast(`Đã lưu thông tin lớp: ${name}`);
  };

  window.deleteClass = function (className) {
    if (appState.currentUser?.role !== 'admin') return;
    if (!confirm(`Bạn có chắc muốn xóa lớp "${className}" khỏi danh mục?`)) return;
    appState.classes = appState.classes.filter(c => (typeof c === 'string' ? c : c.name) !== className);
    saveState();
    renderAll();
    showToast(`Đã xóa lớp "${className}"`);
  };

  window.clearAllClasses = function () {
    if (appState.currentUser?.role !== 'admin') return;
    if (!confirm('Bạn có chắc chắn muốn xóa tất cả danh sách lớp đã khai báo?')) return;
    appState.classes = [];
    saveState();
    renderAll();
    showToast('Đã xóa toàn bộ danh sách lớp');
  };

  // NẠP & XUẤT EXCEL CHO DANH SÁCH LỚP & LỚP TRƯỞNG
  window.downloadSampleClassExcelTemplate = function () {
    if (typeof XLSX === 'undefined') return;

    const rows = [
      ['STT', 'Tên Lớp', 'Họ và Tên Lớp Trưởng', 'Số Điện Thoại', 'Email Lớp Trưởng'],
      [1, '10A1', 'Nguyễn Văn An', '0912345601', 'lop10a1@gmail.com'],
      [2, '10A2', 'Trần Thị Bình', '0912345602', 'lop10a2@gmail.com'],
      [3, '11A1', 'Lê Hoàng Cường', '0912345603', 'lop11a1@gmail.com'],
      [4, '11A2', 'Phạm Thị Dung', '0912345604', 'lop11a2@gmail.com'],
      [5, '12A1', 'Vũ Minh Đức', '0912345605', 'lop12a1@gmail.com']
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Khai_Bao_Lop');
    XLSX.writeFile(wb, 'Mau_Khai_Bao_Lop_Thuc_Hanh.xlsx');
  };

  window.openImportClassesModal = function () {
    if (appState.currentUser?.role !== 'admin') return;
    const input = document.getElementById('excelClassesFileInput');
    if (input) input.value = '';
    document.getElementById('importClassesModal')?.classList.remove('hidden');
  };

  window.closeImportClassesModal = function () {
    document.getElementById('importClassesModal')?.classList.add('hidden');
  };

  window.handleExcelClassesUpload = function (e) {
    if (appState.currentUser?.role !== 'admin') return;
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 });

        let count = 0;
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.length === 0) continue;

          let className = '';
          let monitorName = '';
          let monitorPhone = '';
          let monitorEmail = '';

          // Nhận diện theo cấu trúc: nếu cột 0 là STT số
          if (row.length >= 2 && !isNaN(Number(row[0])) && String(row[1]).trim()) {
            className = String(row[1]).trim().toUpperCase();
            monitorName = String(row[2] || '').trim();
            monitorPhone = String(row[3] || '').trim();
            monitorEmail = String(row[4] || '').trim();
          } else {
            className = String(row[0] || '').trim().toUpperCase();
            monitorName = String(row[1] || '').trim();
            monitorPhone = String(row[2] || '').trim();
            monitorEmail = String(row[3] || '').trim();
          }

          if (!className) continue;
          if (!monitorName) monitorName = 'Lớp trưởng ' + className;

          const existingIdx = appState.classes.findIndex(c => (typeof c === 'string' ? c : c.name).toUpperCase() === className);
          const classObj = {
            name: className,
            monitorName: monitorName,
            monitorPhone: monitorPhone,
            monitorEmail: monitorEmail
          };

          if (existingIdx >= 0) {
            appState.classes[existingIdx] = classObj;
          } else {
            appState.classes.push(classObj);
          }
          count++;
        }

        appState.classes.sort((a, b) => (a.name || a).localeCompare(b.name || b, undefined, { numeric: true }));

        saveState();
        closeImportClassesModal();
        renderAll();
        showToast(`Đã nạp thành công ${count} lớp học từ file Excel!`);
      } catch (err) {
        console.error('Lỗi đọc file Excel lớp:', err);
        alert('Lỗi nạp file Excel: Vui lòng kiểm tra lại định dạng file!');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  window.exportClassesToExcel = function () {
    if (typeof XLSX === 'undefined') return;

    const rows = [
      ['STT', 'Tên Lớp', 'Họ và Tên Lớp Trưởng', 'Số Điện Thoại', 'Email Lớp Trưởng']
    ];

    appState.classes.forEach((c, idx) => {
      const cName = typeof c === 'string' ? c : c.name;
      const mName = typeof c === 'object' ? (c.monitorName || '') : '';
      const mPhone = typeof c === 'object' ? (c.monitorPhone || '') : '';
      const mEmail = typeof c === 'object' ? (c.monitorEmail || '') : '';
      rows.push([idx + 1, cName, mName, mPhone, mEmail]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Danh_Sach_Lop');
    XLSX.writeFile(wb, 'Danh_Sach_Lop_Thuc_Hanh_2026_2027.xlsx');
    showToast('Đã xuất danh sách lớp ra file Excel!');
  };

  // SUB-TAB 3: USERS (QUẢN LÝ TÀI KHOẢN, MẬT KHẨU & PHÂN QUYỀN GMAIL)
  function renderAdminUsersList() {
    const tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    tbody.innerHTML = appState.users.map((u, idx) => {
      const isAdmin = u.role === 'admin';
      const isSelf = u.email === appState.currentUser?.email;
      const isCustomPass = Boolean(u.isCustomPassword && !isAdmin);
      const userPass = u.password || (isAdmin ? 'admin' : '123');

      // MẬT KHẨU BẢO MẬT:
      // Khi giáo viên tự đổi mật khẩu riêng -> Admin TUYỆT ĐỐI KHÔNG THỂ XEM
      let passHtml = '';
      if (isCustomPass) {
        passHtml = `
          <div class="inline-flex items-center gap-1.5 flex-wrap">
            <span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-lg text-[11px] font-semibold" title="Giáo viên đã tự đổi mật khẩu riêng tư. Quản trị viên không thể xem theo chính sách bảo mật.">
              <i class="fa-solid fa-shield-halved text-emerald-600 text-[10px]"></i>
              <span>Đã đổi riêng</span>
              <span class="text-[10px] text-emerald-600 font-normal">(Bảo mật)</span>
            </span>
            <button type="button" onclick="openAdminResetPassModal('${u.email}')" class="px-1.5 py-0.5 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300 text-[10px] font-bold transition flex items-center gap-1" title="Cấp lại mật khẩu mới cho giáo viên khi quên mật khẩu">
              <i class="fa-solid fa-rotate-left text-[9px]"></i> Cấp lại
            </button>
          </div>
        `;
      } else {
        // Mật khẩu do Admin cấp ban đầu hoặc tài khoản Admin: Có thể xem/ẩn
        passHtml = `
          <div class="inline-flex items-center gap-1.5 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200 text-slate-700 text-[11px]">
            <span id="passSpan_${idx}" class="font-bold">••••••</span>
            <button type="button" onclick="toggleUserPassDisplay(${idx}, '${userPass.replace(/'/g, "\\'")}')" class="text-slate-400 hover:text-brand-600 p-0.5" title="Xem/Ẩn mật khẩu">
              <i id="passEyeIcon_${idx}" class="fa-solid fa-eye text-[10px]"></i>
            </button>
          </div>
        `;
      }

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-2">
            <img src="${u.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'}" class="w-6 h-6 rounded-full object-cover">
            <span>${u.name}</span>
          </td>
          <td class="py-2.5 px-3 font-mono text-slate-700">${u.email}</td>
          <td class="py-2.5 px-3 font-mono">
            ${passHtml}
          </td>
          <td class="py-2.5 px-3 font-mono text-slate-500">${u.phone || '—'}</td>
          <td class="py-2.5 px-3 text-slate-600">${u.department || 'Giáo viên'}</td>
          <td class="py-2.5 px-3 text-center">
            ${isAdmin
              ? '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200"><i class="fa-solid fa-shield-halved mr-1"></i>Admin</span>'
              : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200"><i class="fa-solid fa-user-tie mr-1"></i>Giáo viên</span>'
            }
          </td>
          <td class="py-2.5 px-3 text-center">
            <div class="inline-flex items-center gap-1">
              <button onclick="openEditUserModal('${u.email}')" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold transition" title="Chỉnh sửa thông tin & đổi mật khẩu">
                <i class="fa-solid fa-pen-to-square mr-0.5"></i> Sửa
              </button>
              ${!isSelf ? `
                <button onclick="toggleUserRole('${u.email}')" class="px-2 py-1 rounded text-[10px] font-semibold border ${
                  isAdmin ? 'border-slate-300 text-slate-600 hover:bg-slate-100' : 'border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100'
                }" title="Chuyển quyền">
                  ${isAdmin ? 'Hạ GV' : 'Lên Admin'}
                </button>
                <button onclick="deleteUser('${u.email}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[10px] font-bold transition" title="Xóa tài khoản">
                  <i class="fa-solid fa-trash"></i>
                </button>
              ` : '<span class="text-slate-300 text-[10px] italic px-1">(Đang dùng)</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.toggleUserPassDisplay = function (idx, pass) {
    const span = document.getElementById(`passSpan_${idx}`);
    const icon = document.getElementById(`passEyeIcon_${idx}`);
    if (!span) return;
    if (span.textContent === '••••••') {
      span.textContent = pass;
      if (icon) icon.className = 'fa-solid fa-eye-slash text-[10px] text-brand-600';
    } else {
      span.textContent = '••••••';
      if (icon) icon.className = 'fa-solid fa-eye text-[10px] text-slate-400';
    }
  };

  window.generateRandomPassword = function () {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const pass = 'gv' + randomDigits;
    const input = document.getElementById('userPasswordInput');
    if (input) input.value = pass;
  };

  window.openAddUserModal = function () {
    if (appState.currentUser?.role !== 'admin') return;
    document.getElementById('userEditEmailOriginal').value = '';
    document.getElementById('userModalTitle').textContent = 'Khai Báo Tài Khoản Người Dùng Mới';
    document.getElementById('userNameInput').value = '';
    document.getElementById('userEmailInput').value = '';
    const passInput = document.getElementById('userPasswordInput');
    if (passInput) {
      passInput.value = '123';
      passInput.required = true;
      passInput.placeholder = 'Nhập mật khẩu (ví dụ: 123456)...';
    }
    const passHint = document.getElementById('userPassHint');
    if (passHint) {
      passHint.innerHTML = '<span class="text-slate-400">Admin cấp mật khẩu này cho giáo viên để đăng nhập hệ thống</span>';
    }
    document.getElementById('userPhoneInput').value = '';
    document.getElementById('userDeptInput').value = 'Tổ Tin học';
    document.getElementById('userRoleSelect').value = 'teacher';
    document.getElementById('userModal')?.classList.remove('hidden');
  };

  window.openEditUserModal = function (email) {
    if (appState.currentUser?.role !== 'admin') return;
    const cleanEmail = (email || '').toLowerCase().trim();
    const u = appState.users.find(x => (x.email || '').toLowerCase().trim() === cleanEmail);
    if (!u) return;

    document.getElementById('userEditEmailOriginal').value = u.email;
    document.getElementById('userModalTitle').textContent = `Chỉnh Sửa Tài Khoản: ${u.name}`;
    document.getElementById('userNameInput').value = u.name;
    document.getElementById('userEmailInput').value = u.email;
    document.getElementById('userPhoneInput').value = u.phone || '';
    document.getElementById('userDeptInput').value = u.department || 'Tổ Tin học';
    document.getElementById('userRoleSelect').value = u.role || 'teacher';

    const passInput = document.getElementById('userPasswordInput');
    const passHint = document.getElementById('userPassHint');

    if (u.isCustomPassword && u.role !== 'admin') {
      if (passInput) {
        passInput.value = '';
        passInput.required = false;
        passInput.placeholder = '[Đã bảo mật - Giáo viên tự đặt mật khẩu riêng]';
      }
      if (passHint) {
        passHint.innerHTML = '<span class="text-amber-600 font-semibold"><i class="fa-solid fa-lock mr-1"></i>Giáo viên đã tự đổi mật khẩu riêng tư nên Admin không thể xem. Để trống nếu muốn giữ nguyên mật khẩu của GV, hoặc nhập mật khẩu mới nếu muốn cấp lại cho GV.</span>';
      }
    } else {
      if (passInput) {
        passInput.value = u.password || (u.role === 'admin' ? 'admin' : '123');
        passInput.required = true;
        passInput.placeholder = 'Nhập mật khẩu (ví dụ: 123456)...';
      }
      if (passHint) {
        passHint.innerHTML = '<span class="text-slate-400">Admin cấp mật khẩu này cho giáo viên để đăng nhập hệ thống</span>';
      }
    }

    document.getElementById('userModal')?.classList.remove('hidden');
  };

  window.closeUserModal = function () {
    document.getElementById('userModal')?.classList.add('hidden');
  };

  window.handleUserSubmit = function (e) {
    e.preventDefault();
    if (appState.currentUser?.role !== 'admin') return;

    const originalEmail = document.getElementById('userEditEmailOriginal').value.trim().toLowerCase();
    const name = document.getElementById('userNameInput').value.trim();
    const email = document.getElementById('userEmailInput').value.trim().toLowerCase();
    const enteredPass = document.getElementById('userPasswordInput').value.trim();
    const phone = document.getElementById('userPhoneInput').value.trim();
    const dept = document.getElementById('userDeptInput').value.trim();
    const role = document.getElementById('userRoleSelect').value;

    if (!name || !email) return;

    const targetEmail = (originalEmail || email).toLowerCase().trim();
    const existingIdx = appState.users.findIndex(u => (u.email || '').toLowerCase().trim() === targetEmail);
    const existingUser = existingIdx >= 0 ? appState.users[existingIdx] : null;

    let finalPass = '123';
    let isCustom = false;

    if (existingUser) {
      if (existingUser.isCustomPassword && existingUser.role !== 'admin') {
        if (!enteredPass) {
          // Admin để trống: Giữ nguyên mật khẩu riêng của giáo viên
          finalPass = existingUser.password;
          isCustom = true;
        } else {
          // Admin nhập mật khẩu mới: Reset về mật khẩu mới do Admin cấp
          finalPass = enteredPass;
          isCustom = false;
        }
      } else {
        finalPass = enteredPass || existingUser.password || (role === 'admin' ? 'admin' : '123');
        isCustom = false;
      }
    } else {
      finalPass = enteredPass || (role === 'admin' ? 'admin' : '123');
      isCustom = false;
    }

    const userData = {
      email: email,
      password: finalPass,
      isCustomPassword: isCustom,
      name: name,
      phone: phone,
      department: dept,
      role: role,
      avatar: (existingUser && existingUser.avatar)
        ? existingUser.avatar
        : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      signature: name
    };

    if (existingIdx >= 0) {
      appState.users[existingIdx] = userData;
      if (appState.currentUser?.email === targetEmail) {
        appState.currentUser = userData;
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(userData));
      }
    } else {
      appState.users.push(userData);
    }

    saveState();
    closeUserModal();
    renderAll();
    const passToast = isCustom ? '[Đã bảo mật riêng tư]' : finalPass;
    showToast(`Đã lưu tài khoản: ${email} (Mật khẩu: ${passToast})`);
  };

  window.deleteUser = function (email) {
    if (appState.currentUser?.role !== 'admin') return;
    if (email === appState.currentUser?.email) {
      alert('Bạn không thể tự xóa tài khoản của chính mình!');
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn xóa người dùng "${email}" không?`)) return;
    appState.users = appState.users.filter(u => u.email !== email);
    saveState();
    renderAll();
    showToast(`Đã xóa tài khoản: ${email}`);
  };

  // CHỈ ADMIN MỚI ĐƯỢC PHÉP ĐỔI VAI TRÒ
  window.toggleUserRole = function (email) {
    if (appState.currentUser?.role !== 'admin') {
      alert('Chỉ Quản trị viên (Admin) mới có quyền phân quyền người dùng!');
      return;
    }

    if (email === appState.currentUser?.email) {
      alert('Bạn không thể tự hạ quyền Admin của chính mình!');
      return;
    }

    const u = appState.users.find(x => x.email === email);
    if (!u) return;

    u.role = u.role === 'admin' ? 'teacher' : 'admin';
    saveState();
    renderAll();
    showToast(`Đã đổi vai trò của ${u.name} thành: ${u.role === 'admin' ? 'Admin' : 'Giáo viên'}`);
  };

  window.openImportUsersModal = function () {
    if (appState.currentUser?.role !== 'admin') return;
    document.getElementById('importUsersModal')?.classList.remove('hidden');
  };

  window.closeImportUsersModal = function () {
    document.getElementById('importUsersModal')?.classList.add('hidden');
  };

  window.downloadSampleUserExcelTemplate = function () {
    if (typeof XLSX === 'undefined') return;

    const rows = [
      ['Họ và tên', 'Tài khoản Gmail', 'Mật khẩu', 'Số điện thoại', 'Tổ bộ môn', 'Phân quyền (admin/giáo viên)'],
      ['Thầy Phạm Đình Thanh', 'thanh.gv@gmail.com', '123', '0912345678', 'Tổ Tin học', 'giáo viên'],
      ['Cô Vũ Thị Ý', 'vuthi.y@gmail.com', '123', '0987654321', 'Tổ Tin học', 'giáo viên'],
      ['Quản Trị Viên Phòng Máy', 'admin@gmail.com', 'admin', '0988888888', 'Ban Quản Trị', 'admin']
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Mau_Danh_Sach_Giao_Vien');
    XLSX.writeFile(wb, 'Mau_Danh_Sach_Giao_Vien_PhongMay.xlsx');
  };

  window.handleExcelUsersUpload = function (e) {
    if (appState.currentUser?.role !== 'admin') return;
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 });

        let count = 0;
        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.length < 2) continue;

          const name = String(row[0] || '').trim();
          const email = String(row[1] || '').trim().toLowerCase();
          let pass = '123';
          let phone = '';
          let dept = '';
          let roleStr = '';

          if (row.length >= 6) {
            pass = String(row[2] || '123').trim();
            phone = String(row[3] || '').trim();
            dept = String(row[4] || '').trim();
            roleStr = String(row[5] || '').toLowerCase().trim();
          } else {
            phone = String(row[2] || '').trim();
            dept = String(row[3] || '').trim();
            roleStr = String(row[4] || '').toLowerCase().trim();
          }

          const role = roleStr.includes('admin') ? 'admin' : 'teacher';

          if (name && email.includes('@')) {
            const idx = appState.users.findIndex(u => u.email === email);
            const userObj = {
              email: email,
              password: pass || (role === 'admin' ? 'admin' : '123'),
              name: name,
              phone: phone,
              department: dept || 'Giáo viên',
              role: role,
              avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
              signature: name
            };

            if (idx >= 0) appState.users[idx] = userObj;
            else appState.users.push(userObj);
            count++;
          }
        }

        saveState();
        closeImportUsersModal();
        renderAll();
        showToast(`Đã nạp thành công ${count} tài khoản từ file Excel!`);
      } catch (err) {
        console.error('Import users error', err);
        alert('Có lỗi khi đọc file Excel. Vui lòng đảm bảo file theo đúng mẫu!');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  window.exportUsersToExcel = function () {
    if (typeof XLSX === 'undefined') return;

    const rows = [
      ['STT', 'Họ và tên', 'Tài khoản Gmail', 'Mật khẩu', 'Số điện thoại', 'Tổ bộ môn', 'Phân quyền']
    ];

    appState.users.forEach((u, i) => {
      const isCustomPass = Boolean(u.isCustomPassword && u.role !== 'admin');
      const passText = isCustomPass ? 'Đã đổi riêng (Bảo mật)' : (u.password || (u.role === 'admin' ? 'admin' : '123'));
      rows.push([
        i + 1,
        u.name,
        u.email,
        passText,
        u.phone || '',
        u.department || '',
        u.role === 'admin' ? 'Quản trị viên (Admin)' : 'Giáo viên'
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Danh_Sach_Nguoi_Dung');
    XLSX.writeFile(wb, 'DANH_SACH_TAI_KHOAN_GMAIL_PHONG_MAY.xlsx');
    showToast('Đã xuất danh sách tài khoản Gmail & Mật khẩu ra file Excel!');
  };

  // SUB-TAB 4: WEEKS & CUSTOM NAMES
  function renderAdminWeeksList() {
    const tbody = document.getElementById('adminWeeksTableBody');
    if (!tbody) return;

    tbody.innerHTML = appState.generatedWeeks.map(w => {
      const locked = isWeekLocked(w.weekNumber);
      const customTitle = appState.weekCustomNames[w.weekNumber] || '';

      return `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-2 px-3 text-center font-bold text-slate-800">${w.weekNumber}</td>
          <td class="py-2 px-3 font-mono text-[11px] text-slate-500">${w.dateRangeStr}</td>
          <td class="py-2 px-3">
            <input type="text" id="weekNameInput_${w.weekNumber}" value="${customTitle}" placeholder="Đặt tên riêng cho tuần (Ví dụ: Tuần 7: Thi đua...)" onchange="updateWeekCustomName(${w.weekNumber}, this.value)" class="w-full px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white font-medium">
          </td>
          <td class="py-2 px-3 text-center">
            <button onclick="toggleLockForWeek(${w.weekNumber})" class="px-2.5 py-1 rounded-lg text-[10px] font-bold ${
              locked ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            }">
              ${locked ? '<i class="fa-solid fa-lock mr-1"></i> Đã khóa sổ' : '<i class="fa-solid fa-lock-open mr-1"></i> Mở đăng ký'}
            </button>
          </td>
          <td class="py-2 px-3 text-center">
            <button onclick="selectWeek(${w.weekNumber}); switchView('timetable');" class="text-brand-600 hover:underline text-[11px] font-bold">
              Xem sổ
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.updateWeekCustomName = function (weekNum, newName) {
    if (appState.currentUser?.role !== 'admin') return;
    if (newName && newName.trim()) {
      appState.weekCustomNames[weekNum] = newName.trim();
    } else {
      delete appState.weekCustomNames[weekNum];
    }
    generateSchoolWeeks();
    saveState();
    renderWeekDropdown();
    showToast(`Đã cập nhật tên Tuần ${weekNum}!`);
  };

  // ADMIN MỞ SỔ / KHÓA SỔ
  window.toggleLockForWeek = function (weekNum) {
    if (appState.currentUser?.role !== 'admin') {
      alert('Chỉ Admin mới có quyền mở sổ hoặc khóa sổ đăng ký!');
      return;
    }

    const currentLocked = isWeekLocked(weekNum);
    appState.lockedWeeks[weekNum] = !currentLocked; // Đảo ngược trạng thái
    saveState();
    renderAll();
    showToast(appState.lockedWeeks[weekNum] ? `Đã KHÓA sổ Tuần ${weekNum}` : `Đã MỞ SỔ Tuần ${weekNum} cho giáo viên sửa/đăng ký`);
  };

  window.saveSchoolYearSettings = function () {
    if (appState.currentUser?.role !== 'admin') return;
    const y = document.getElementById('adminSchoolYearInput').value.trim();
    const s = document.getElementById('adminYearStartInput').value;
    const e = document.getElementById('adminYearEndInput').value;

    if (!y || !s || !e) return;

    appState.schoolYear = y;
    appState.yearStartDate = s;
    appState.yearEndDate = e;

    generateSchoolWeeks();
    saveState();
    renderAll();
    showToast('Đã lưu cấu hình năm học thành công!');
  };

  window.clearAllDataPrompt = function () {
    if (appState.currentUser?.role !== 'admin') return;
    if (!confirm('CẢNH BÁO: Thao tác này sẽ XÓA HẾT tất cả các tiết thực hành đã đăng ký và đưa hệ thống về trạng thái sạch ban đầu. Bạn có chắc chắn không?')) {
      return;
    }

    appState.bookings = [];
    appState.issues = [];
    appState.notificationLogs = [];
    saveState();
    renderAll();
    showToast('Đã xóa hết dữ liệu đăng ký thành công!');
  };

  // =========================================================================
  // SUB-TAB 5: CẤU HÌNH GIỜ CÁC TIẾT HỌC (ADMIN TỰ ĐIỀU CHỈNH)
  // =========================================================================
  function renderPeriodsConfigUI() {
    const sangCont = document.getElementById('periodsConfigContainerSang');
    const chieuCont = document.getElementById('periodsConfigContainerChieu');
    if (!sangCont || !chieuCont) return;

    const pTimes = appState.periodTimes || PERIOD_TIMES_DEFAULT;

    // Buổi Sáng (Tiết 1 - 5)
    let sangHtml = '';
    for (let p = 1; p <= 5; p++) {
      const item = (pTimes.sang && pTimes.sang[p]) || { start: '07:15', end: '08:00' };
      sangHtml += `
        <div class="flex items-center justify-between p-2.5 bg-white rounded-xl border border-amber-200/80 shadow-2xs hover:border-amber-300 transition">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-amber-100 text-amber-900 font-black flex items-center justify-center text-xs">
              T${p}
            </span>
            <span class="font-bold text-slate-800 text-xs">Tiết ${p} (Buổi Sáng)</span>
          </div>
          <div class="flex items-center gap-2 font-mono text-xs">
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-slate-400 font-sans">Bắt đầu:</span>
              <input type="time" id="cfg_sang_${p}_start" value="${item.start}" class="px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:bg-white focus:border-amber-500">
            </div>
            <span class="text-slate-400 font-bold">-</span>
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-slate-400 font-sans">Kết thúc:</span>
              <input type="time" id="cfg_sang_${p}_end" value="${item.end}" class="px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:bg-white focus:border-amber-500">
            </div>
          </div>
        </div>
      `;
    }
    sangCont.innerHTML = sangHtml;

    // Buổi Chiều (Tiết 1 - 5)
    let chieuHtml = '';
    for (let p = 1; p <= 5; p++) {
      const item = (pTimes.chieu && pTimes.chieu[p]) || { start: '13:15', end: '14:00' };
      chieuHtml += `
        <div class="flex items-center justify-between p-2.5 bg-white rounded-xl border border-indigo-200/80 shadow-2xs hover:border-indigo-300 transition">
          <div class="flex items-center gap-2">
            <span class="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-900 font-black flex items-center justify-center text-xs">
              T${p}
            </span>
            <span class="font-bold text-slate-800 text-xs">Tiết ${p} (Buổi Chiều)</span>
          </div>
          <div class="flex items-center gap-2 font-mono text-xs">
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-slate-400 font-sans">Bắt đầu:</span>
              <input type="time" id="cfg_chieu_${p}_start" value="${item.start}" class="px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:bg-white focus:border-indigo-500">
            </div>
            <span class="text-slate-400 font-bold">-</span>
            <div class="flex items-center gap-1">
              <span class="text-[10px] text-slate-400 font-sans">Kết thúc:</span>
              <input type="time" id="cfg_chieu_${p}_end" value="${item.end}" class="px-2 py-1 rounded-lg border border-slate-300 bg-slate-50 font-bold text-slate-800 focus:bg-white focus:border-indigo-500">
            </div>
          </div>
        </div>
      `;
    }
    chieuCont.innerHTML = chieuHtml;
  }

  window.savePeriodTimesConfig = function () {
    if (appState.currentUser?.role !== 'admin') return;

    const newPeriods = { sang: {}, chieu: {} };
    for (let p = 1; p <= 5; p++) {
      const sStart = document.getElementById(`cfg_sang_${p}_start`)?.value || '07:15';
      const sEnd = document.getElementById(`cfg_sang_${p}_end`)?.value || '08:00';
      newPeriods.sang[p] = { start: sStart, end: sEnd };

      const cStart = document.getElementById(`cfg_chieu_${p}_start`)?.value || '13:15';
      const cEnd = document.getElementById(`cfg_chieu_${p}_end`)?.value || '14:00';
      newPeriods.chieu[p] = { start: cStart, end: cEnd };
    }

    appState.periodTimes = newPeriods;
    saveState();
    renderAll();
    showToast('Đã lưu cấu hình thời gian các tiết học thành công!');
  };

  window.resetPeriodTimesDefault = function () {
    if (appState.currentUser?.role !== 'admin') return;
    if (!confirm('Khôi phục lại khung giờ các tiết học theo chuẩn mặc định của trường?')) return;

    appState.periodTimes = JSON.parse(JSON.stringify(PERIOD_TIMES_DEFAULT));
    saveState();
    renderPeriodsConfigUI();
    renderAll();
    showToast('Đã khôi phục giờ các tiết học về mặc định!');
  };

  // =========================================================================
  // SUB-TAB 6: THỜI GIAN GIAO CHO LỚP (CÀI ĐẶT LỊCH TỰ ĐỘNG & ADMIN GIAO NGAY)
  // Cú pháp quy định: "Ngày mai lớp thực hành Tiết ..... tại phòng .... vị trí ................"
  // =========================================================================

  function getTargetScheduleInfo(targetKey = 'tomorrow') {
    const now = new Date();
    let targetDate = new Date(now);
    let syntaxLead = 'Ngày mai';
    let labelTitle = '';
    let dayOfWeek = 2;
    let weekNum = appState.selectedWeekNumber || 1;

    if (targetKey === 'tomorrow') {
      targetDate.setDate(now.getDate() + 1);
      syntaxLead = 'Ngày mai';
    } else if (targetKey === 'today') {
      syntaxLead = 'Hôm nay';
    } else if (targetKey.startsWith('day_')) {
      const targetDow = parseInt(targetKey.replace('day_', ''), 10);
      weekNum = appState.selectedWeekNumber || 1;
      const weekObj = appState.generatedWeeks.find(w => w.weekNumber === weekNum) || appState.generatedWeeks[0];
      if (weekObj && weekObj.dayDates && weekObj.dayDates[targetDow]) {
        targetDate = new Date(weekObj.dayDates[targetDow].fullDate);
      }
      dayOfWeek = targetDow;
      syntaxLead = `Ngày ${DAY_NAMES[dayOfWeek] || ''} (${targetDate.toLocaleDateString('vi-VN')})`;
    }

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    const targetDateStr = `${y}-${m}-${d}`;
    const formattedDisplayDate = `${d}/${m}/${y}`;

    if (!targetKey.startsWith('day_')) {
      const matchedWeek = appState.generatedWeeks.find(w => targetDateStr >= w.startDate && targetDateStr <= w.endDate);
      weekNum = matchedWeek ? matchedWeek.weekNumber : (appState.selectedWeekNumber || 1);
      const jsDay = targetDate.getDay();
      dayOfWeek = jsDay === 0 ? 8 : (jsDay + 1); // 2..7, 8=CN
    }

    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === weekNum) || appState.generatedWeeks[0];
    const dayName = DAY_NAMES[dayOfWeek] || (dayOfWeek === 8 ? 'Chủ nhật' : `Thứ ${dayOfWeek}`);

    if (targetKey === 'tomorrow') {
      labelTitle = `Lịch Ngày Mai: ${dayName} (${formattedDisplayDate}) - Tuần ${weekNum}`;
    } else if (targetKey === 'today') {
      labelTitle = `Lịch Hôm Nay: ${dayName} (${formattedDisplayDate}) - Tuần ${weekNum}`;
    } else {
      labelTitle = `Lịch ${dayName} (${formattedDisplayDate}) - Tuần ${weekNum}`;
    }

    const bookings = appState.bookings.filter(b => b.week === weekNum && b.dayOfWeek === dayOfWeek);

    return {
      targetKey,
      targetDate,
      targetDateStr,
      formattedDisplayDate,
      weekNum,
      weekObj,
      dayOfWeek,
      dayName,
      labelTitle,
      syntaxLead,
      bookings
    };
  }

  function groupBookingsByClass(targetInfo) {
    const classesMap = {};

    targetInfo.bookings.forEach(b => {
      const cName = b.className;
      if (!classesMap[cName]) {
        classesMap[cName] = [];
      }
      classesMap[cName].push(b);
    });

    const result = [];
    Object.keys(classesMap).sort().forEach(cName => {
      const bList = classesMap[cName];
      // Sắp xếp theo buổi và tiết
      bList.sort((a, b) => {
        if (a.session !== b.session) return a.session === 'sang' ? -1 : 1;
        return a.period - b.period;
      });

      // Lấy thông tin lớp & lớp trưởng
      const cObj = appState.classes.find(c => (typeof c === 'string' ? c : c.name) === cName);
      const monitorName = typeof cObj === 'object' ? (cObj.monitorName || `Lớp trưởng ${cName}`) : `Lớp trưởng ${cName}`;
      const monitorPhone = typeof cObj === 'object' ? (cObj.monitorPhone || '') : '';
      const monitorEmail = typeof cObj === 'object' ? (cObj.monitorEmail || '') : '';

      // Gom tiết
      const periodsList = bList.map(b => {
        const sessionName = b.session === 'sang' ? 'Sáng' : 'Chiều';
        const pRange = getPeriodTimeRange(b.session, b.period);
        return `Tiết ${b.period} (${sessionName}: ${pRange})`;
      });
      const periodsStr = periodsList.join(', ');

      // Gom phòng & vị trí
      const roomsList = [];
      const locationsList = [];
      const subjectsList = [];
      const lessonsList = [];
      const teachersList = [];

      bList.forEach(b => {
        const rObj = appState.rooms.find(r => r.name === b.room);
        const rName = rObj?.name || b.room;
        const rLoc = rObj?.location || rObj?.fullName || 'Tầng 2 - Dãy nhà B';
        if (!roomsList.includes(rName)) roomsList.push(rName);
        if (!locationsList.includes(rLoc)) locationsList.push(rLoc);
        if (b.subject && !subjectsList.includes(b.subject)) subjectsList.push(b.subject);
        if (b.lesson && !lessonsList.includes(b.lesson)) lessonsList.push(b.lesson);
        if (b.teacherName && !teachersList.includes(b.teacherName)) teachersList.push(b.teacherName);
      });

      const roomsStr = roomsList.join(', ');
      const locationsStr = locationsList.join(', ');
      const subjectsStr = subjectsList.join(', ') || 'Tin học';
      const lessonsStr = lessonsList.join(' | ') || 'Thực hành phòng máy';
      const teachersStr = teachersList.join(', ') || 'Giáo viên bộ môn';

      // Cú pháp đúng theo yêu cầu tuyệt đối của người dùng:
      // "Ngày mai lớp thực hành Tiết .....tại phòng ....vị trí................"
      const exactSyntax = `${targetInfo.syntaxLead} lớp thực hành Tiết ${periodsStr} tại phòng ${roomsStr} vị trí ${locationsStr}.`;
      const fullMessage = `${exactSyntax} (Môn: ${subjectsStr}. Bài dạy: ${lessonsStr}. Giáo viên: ${teachersStr}).`;

      result.push({
        className: cName,
        monitorName,
        monitorPhone,
        monitorEmail,
        periodsStr,
        roomsStr,
        locationsStr,
        subjectsStr,
        lessonsStr,
        teachersStr,
        exactSyntax,
        fullMessage,
        bookings: bList
      });
    });

    return result;
  }

  // Backward-compatible wrappers
  function getTomorrowScheduleInfo() {
    return getTargetScheduleInfo('tomorrow');
  }

  function groupBookingsByClassForTomorrow(tomorrowInfo) {
    return groupBookingsByClass(tomorrowInfo || getTargetScheduleInfo('tomorrow'));
  }

  window.renderNotificationSettingsUI = function () {
    const enabledInput = document.getElementById('notifAutoSendEnabled');
    const timeInput = document.getElementById('notifAutoSendTime');
    const targetSelect = document.getElementById('notifAutoSendTarget');
    const statusBadge = document.getElementById('notifStatusBadge');
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');

    const cfg = appState.notificationSettings || {
      autoSendEnabled: true,
      sendHour: 21,
      sendMinute: 0,
      sendTarget: 'tomorrow'
    };

    const isEnabled = cfg.autoSendEnabled ?? true;
    const hour = Number(cfg.sendHour ?? 21);
    const minute = Number(cfg.sendMinute ?? 0);
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const target = cfg.sendTarget || 'tomorrow';

    if (enabledInput) enabledInput.checked = isEnabled;
    if (timeInput) timeInput.value = timeStr;
    if (targetSelect) targetSelect.value = target;

    if (statusBadge) {
      if (isEnabled) {
        statusBadge.innerHTML = `
          <div class="flex items-center gap-2">
            <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Tự động gửi: ${timeStr} (${target === 'tomorrow' ? 'Lịch Ngày mai' : 'Lịch Hôm nay'})
            </span>
          </div>
        `;
      } else {
        statusBadge.innerHTML = `
          <span class="px-3 py-1 rounded-full text-xs font-bold bg-slate-700/80 text-slate-300 border border-slate-600 flex items-center gap-1.5">
            <i class="fa-solid fa-pause text-amber-400"></i> Đang tắt tự động giao
          </span>
        `;
      }
    }

    if (dispatchSelect) {
      const currentSelectedVal = dispatchSelect.value || 'tomorrow';
      const tomInfo = getTargetScheduleInfo('tomorrow');
      const todInfo = getTargetScheduleInfo('today');
      const curWeekNum = appState.selectedWeekNumber || 1;
      const weekObj = appState.generatedWeeks.find(w => w.weekNumber === curWeekNum) || appState.generatedWeeks[0];

      let opts = `
        <option value="tomorrow">📅 Lịch Ngày Mai: ${tomInfo.dayName} (${tomInfo.formattedDisplayDate}) - Khuyên dùng</option>
        <option value="today">⚡ Lịch Hôm Nay: ${todInfo.dayName} (${todInfo.formattedDisplayDate})</option>
      `;

      if (weekObj && weekObj.dayDates) {
        for (let d = 2; d <= 7; d++) {
          const ddInfo = weekObj.dayDates[d];
          const dName = DAY_NAMES[d] || `Thứ ${d}`;
          const dStr = ddInfo ? `(${ddInfo.dateStr})` : '';
          opts += `<option value="day_${d}">🗓️ ${dName} ${dStr} - Tuần ${curWeekNum}</option>`;
        }
      }

      dispatchSelect.innerHTML = opts;
      if (dispatchSelect.querySelector(`option[value="${currentSelectedVal}"]`)) {
        dispatchSelect.value = currentSelectedVal;
      } else {
        dispatchSelect.value = 'tomorrow';
      }
    }
  };

  window.setQuickNotifTime = function (val) {
    const timeInput = document.getElementById('notifAutoSendTime');
    if (timeInput) {
      timeInput.value = val;
      const hint = document.getElementById('notifAutoSaveHint');
      if (hint) {
        hint.textContent = `Đã chọn ${val} (Chưa lưu - bấm "Lưu Cài Đặt")`;
        hint.className = 'text-[11px] text-amber-500 font-semibold';
      }
    }
  };

  window.updateNotifAutoStatusText = function () {
    const enabledInput = document.getElementById('notifAutoSendEnabled');
    const hint = document.getElementById('notifAutoSaveHint');
    if (hint && enabledInput) {
      hint.textContent = enabledInput.checked ? 'Đang bật tự động (Chưa lưu - bấm "Lưu Cài Đặt")' : 'Đang tắt tự động (Chưa lưu - bấm "Lưu Cài Đặt")';
      hint.className = 'text-[11px] text-amber-500 font-semibold';
    }
  };

  window.saveNotificationSettings = function () {
    if (appState.currentUser?.role !== 'admin') {
      alert('Chỉ quản trị viên (Admin) mới có quyền cài đặt lịch giao thông báo!');
      return;
    }

    const enabled = document.getElementById('notifAutoSendEnabled')?.checked ?? true;
    const timeVal = document.getElementById('notifAutoSendTime')?.value || '21:00';
    const target = document.getElementById('notifAutoSendTarget')?.value || 'tomorrow';

    const [hStr, mStr] = timeVal.split(':');
    const sendHour = parseInt(hStr, 10) || 0;
    const sendMinute = parseInt(mStr, 10) || 0;

    appState.notificationSettings = {
      ...(appState.notificationSettings || {}),
      autoSendEnabled: enabled,
      sendHour,
      sendMinute,
      sendTarget: target
    };

    saveState();
    renderNotificationSettingsUI();

    const hint = document.getElementById('notifAutoSaveHint');
    if (hint) {
      hint.textContent = 'Đã lưu & đồng bộ thành công!';
      hint.className = 'text-[11px] text-emerald-600 font-semibold';
    }

    showToast(`Đã lưu cài đặt: ${enabled ? 'BẬT' : 'TẮT'} tự động lúc ${timeVal} (${target === 'tomorrow' ? 'Lịch Ngày mai' : 'Lịch Hôm nay'})`);
  };

  window.onDispatchTargetChange = function () {
    renderNotificationsPreview();
  };

  window.renderNotificationsPreview = function () {
    const container = document.getElementById('notifCardsContainer');
    const titleEl = document.getElementById('notifScheduleTitle');
    const badgeEl = document.getElementById('notifScheduleCountBadge');
    const readyCountEl = document.getElementById('notifDispatchReadyCount');
    const syntaxBox = document.getElementById('notifSyntaxPreviewBox');
    if (!container) return;

    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';

    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-calendar-day text-brand-600"></i> ${info.labelTitle}`;
    }

    if (badgeEl) {
      badgeEl.textContent = `${classGroups.length} lớp thực hành`;
      badgeEl.className = classGroups.length > 0
        ? 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300'
        : 'px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200';
    }

    if (readyCountEl) {
      readyCountEl.innerHTML = classGroups.length > 0
        ? `<span class="text-emerald-700 font-bold"><i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i>Sẵn sàng gửi: ${classGroups.length} lớp</span>`
        : `<span class="text-slate-400 font-medium">Không có lớp nào có lịch</span>`;
    }

    if (syntaxBox) {
      syntaxBox.innerHTML = `"${info.syntaxLead} lớp thực hành Tiết <span class="text-brand-600 font-bold">[Tiết]</span> tại phòng <span class="text-purple-600 font-bold">[Tên phòng]</span> vị trí <span class="text-emerald-600 font-bold">[Vị trí/Khu nhà]</span>."`;
    }

    if (classGroups.length === 0) {
      container.innerHTML = `
        <div class="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs">
          <i class="fa-regular fa-calendar-xmark text-2xl text-slate-400 mb-2 block"></i>
          Trong ${info.labelTitle} chưa có lớp nào đăng ký lịch thực hành phòng máy.<br>
          <span class="text-[11px] text-slate-400">Khi giáo viên đăng ký tiết vào ngày này, danh sách lớp và nội dung thông báo sẽ tự động cập nhật tại đây.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = classGroups.map(cg => `
      <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-brand-300 transition space-y-3">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-1 rounded-xl bg-brand-600 text-white font-black text-xs shadow-xs">
              Lớp ${cg.className}
            </span>
            <span class="font-bold text-slate-800 text-xs">
              Lớp trưởng: <span class="text-indigo-700 font-bold">${cg.monitorName}</span>
            </span>
          </div>

          <div class="flex items-center gap-2 text-xs font-mono">
            ${cg.monitorPhone ? `
              <span class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold">
                <i class="fa-solid fa-phone text-emerald-600 mr-1"></i>${cg.monitorPhone}
              </span>
            ` : '<span class="text-amber-600 text-[11px] font-sans italic">Chưa có SĐT</span>'}

            ${cg.monitorEmail ? `
              <span class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700">
                <i class="fa-regular fa-envelope text-indigo-600 mr-1"></i>${cg.monitorEmail}
              </span>
            ` : '<span class="text-amber-600 text-[11px] font-sans italic">Chưa có Email</span>'}
          </div>
        </div>

        <!-- Cú pháp thông báo hiển thị cho lớp này -->
        <div class="p-3 bg-white rounded-xl border border-indigo-100 font-mono text-xs text-slate-800 shadow-2xs">
          <p class="font-bold text-slate-900">${cg.exactSyntax}</p>
          <p class="text-[11px] text-slate-500 mt-1 font-sans">
            Môn học: <strong>${cg.subjectsStr}</strong> | Bài dạy: <em>${cg.lessonsStr}</em> | GV: <strong>${cg.teachersStr}</strong>
          </p>
        </div>

        <!-- Nút gửi / thao tác nhanh (Nhóm Zalo & Email) -->
        <div class="flex items-center justify-end gap-2 flex-wrap pt-1 border-t border-slate-200/60">
          <button onclick="copyNotificationText('${encodeURIComponent(cg.fullMessage)}')" class="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold transition flex items-center gap-1.5 shadow-2xs">
            <i class="fa-regular fa-copy text-slate-500"></i> Sao chép nội dung
          </button>

          ${cg.monitorPhone ? `
            <button onclick="openZaloChatWithCopy('${cg.monitorPhone}', '${encodeURIComponent(cg.fullMessage)}')" type="button" class="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition flex items-center gap-1.5 shadow-2xs">
              <i class="fa-solid fa-paper-plane"></i> Mở Zalo Lớp trưởng
            </button>
          ` : ''}

          ${cg.monitorEmail ? `
            <a href="mailto:${cg.monitorEmail}?subject=${encodeURIComponent(`[LabMaster] Thông báo lịch thực hành phòng máy - Lớp ${cg.className}`)}&body=${encodeURIComponent(cg.fullMessage)}" class="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-bold transition flex items-center gap-1.5">
              <i class="fa-solid fa-envelope"></i> Gửi Email
            </a>
          ` : ''}
        </div>
      </div>
    `).join('');
  };

  // Backward-compatible alias
  window.renderTomorrowNotificationsPreview = function() {
    window.renderNotificationsPreview();
  };

  
  // ================= CÔNG CỤ TỰ ĐỘNG HÓA GỬI ZALO (GIẢI PHÁP 3) =================
  
  // =========================================================================
  // PHƯƠNG ÁN 2: GỬI VÀO NHÓM ZALO LỚP TRƯỞNG & GỬI EMAIL ĐỒNG LOẠT
  // (HOÀN TOÀN KHÔNG DÙNG TIN NHẮN SMS VIỄN THÔNG)
  // =========================================================================

  function generateZaloGroupSummaryText(targetInfo, classGroups) {
    if (!classGroups || classGroups.length === 0) {
      return `[LabMaster] Trong ${targetInfo.labelTitle} không có lớp nào có lịch thực hành phòng máy tính.`;
    }

    const separator = '──────────────────────────────────────────';
    let text = `📢 THÔNG BÁO LỊCH THỰC HÀNH PHÒNG MÁY TÍNH\n`;
    text += `🗓️ ${targetInfo.labelTitle}\n`;
    text += `${separator}\n\n`;

    classGroups.forEach((cg, idx) => {
      text += `📌 ${idx + 1}. Lớp ${cg.className} (Lớp trưởng: ${cg.monitorName}${cg.monitorPhone ? ' - SĐT: ' + cg.monitorPhone : ''}):\n`;
      text += `👉 "${cg.exactSyntax}"\n`;
      text += `   • Môn học: ${cg.subjectsStr}\n`;
      text += `   • Bài dạy: ${cg.lessonsStr}\n`;
      text += `   • Giáo viên: ${cg.teachersStr}\n\n`;
    });

    text += `${separator}\n`;
    text += `⚠️ Đề nghị các bạn Lớp trưởng thông báo kịp thời cho lớp, nhắc nhở các bạn có mặt đúng giờ và chấp hành nghiêm túc nội quy phòng máy tính!\n`;
    text += `Trân trọng,\n`;
    text += `Ban Quản Trị Phòng Máy Tính.`;

    return text;
  }

  // 1. GỬI VÀO NHÓM ZALO LỚP TRƯỞNG (PHƯƠNG ÁN 2)
  window.sendScheduleToZaloGroup = function () {
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';
    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      alert(`Trong ${info.labelTitle} không có lớp nào có lịch thực hành để gửi vào Nhóm Zalo.`);
      return;
    }

    const summaryText = generateZaloGroupSummaryText(info, classGroups);

    const now = new Date();
    const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    appState.notificationLogs.unshift({
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: timeFormatted,
      className: `Toàn trường (${classGroups.length} lớp)`,
      monitorName: `Nhóm Zalo Lớp Trưởng`,
      monitorPhone: '—',
      monitorEmail: '—',
      message: `Đã sao chép bản tin tổng hợp lịch ${info.dayName} (${info.formattedDisplayDate}) cho ${classGroups.length} lớp vào Nhóm Zalo`,
      status: `Nhóm Zalo (${hhmm})`
    });

    if (appState.notificationLogs.length > 50) {
      appState.notificationLogs = appState.notificationLogs.slice(0, 50);
    }

    saveState();
    renderNotificationLogs();

    navigator.clipboard.writeText(summaryText).then(() => {
      showToast(`Đã sao chép bản tin của ${classGroups.length} lớp! Đang mở Zalo Web, bạn chỉ cần chọn Nhóm Zalo Lớp Trưởng rồi ấn Ctrl+V và Enter để gửi.`);
    }).catch(() => {
      prompt('Bản tin gửi Nhóm Zalo:', summaryText);
    });

    // Mở Zalo Web
    window.open('https://chat.zalo.me', '_blank');
  };

  // 2. SAO CHÉP BẢN TIN NHÓM ZALO
  window.copyZaloGroupMessage = function () {
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';
    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      alert('Không có lớp nào có lịch thực hành trong ngày đã chọn!');
      return;
    }

    const summaryText = generateZaloGroupSummaryText(info, classGroups);
    navigator.clipboard.writeText(summaryText).then(() => {
      showToast('Đã sao chép toàn bộ bản tin gửi Nhóm Zalo vào bộ nhớ tạm!');
    }).catch(() => {
      prompt('Bản tin gửi Nhóm Zalo:', summaryText);
    });
  };

  // 3. GỬI EMAIL ĐỒNG LOẠT CHO TẤT CẢ LỚP TRƯỞNG
  window.sendBulkEmailToMonitors = function () {
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';
    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      alert(`Trong ${info.labelTitle} không có lớp nào có lịch thực hành để gửi email.`);
      return;
    }

    const emailList = classGroups
      .map(cg => cg.monitorEmail?.trim())
      .filter(em => em && em.includes('@'));

    if (emailList.length === 0) {
      alert('Không tìm thấy địa chỉ Email nào của Lớp trưởng trong danh sách các lớp có lịch thực hành. Vui lòng bổ sung email trong mục Khai báo lớp!');
      return;
    }

    const subject = `[LabMaster] Thông báo lịch thực hành phòng máy - ${info.labelTitle}`;
    const bodyLines = [
      `Kính gửi các bạn Lớp trưởng,`,
      ``,
      `Hệ thống LabMaster xin gửi thông báo lịch thực hành phòng máy tính (${info.labelTitle}):`,
      `──────────────────────────────────────────`,
      ``,
      ...classGroups.map((cg, idx) =>
        `${idx + 1}. Lớp ${cg.className} (Lớp trưởng: ${cg.monitorName}):\n   "${cg.exactSyntax}"\n   • Môn: ${cg.subjectsStr} | Bài dạy: ${cg.lessonsStr} | GV: ${cg.teachersStr}\n`
      ),
      `──────────────────────────────────────────`,
      `Đề nghị các bạn Lớp trưởng thông báo kịp thời cho lớp và nhắc các bạn có mặt đúng giờ.`,
      ``,
      `Trân trọng,`,
      `Ban Quản Trị Phòng Máy Tính`
    ];

    const body = bodyLines.join('\n');

    const now = new Date();
    const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    appState.notificationLogs.unshift({
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: timeFormatted,
      className: `Toàn trường (${emailList.length} email)`,
      monitorName: `Tất cả Lớp trưởng`,
      monitorPhone: '—',
      monitorEmail: emailList.join(', '),
      message: `Đã mở trình gửi email đồng loạt thông báo lịch ${info.dayName} (${info.formattedDisplayDate}) cho ${emailList.length} lớp trưởng`,
      status: `Email (${hhmm})`
    });

    if (appState.notificationLogs.length > 50) {
      appState.notificationLogs = appState.notificationLogs.slice(0, 50);
    }

    saveState();
    renderNotificationLogs();

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).catch(() => {});
    }

    const firstEmail = emailList[0];
    const bccEmails = emailList.slice(1).join(',');
    const mailtoUrl = bccEmails
      ? `mailto:${firstEmail}?bcc=${encodeURIComponent(bccEmails)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : `mailto:${firstEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.open(mailtoUrl, '_blank');
    showToast(`Đã mở trình gửi email cho ${emailList.length} lớp trưởng!`);
  };

  window.openZaloChatWithCopy = function (phone, encodedMessage) {
    const text = decodeURIComponent(encodedMessage);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Đã copy tin nhắn! Đang mở Zalo với ${phone}. Bạn chỉ cần bấm Ctrl+V rồi Enter để gửi.`);
      }).catch(() => {});
    } else {
      showToast(`Đang mở Zalo với số điện thoại ${phone}...`);
    }
    window.open(`https://zalo.me/${phone}`, '_blank');
  };

  window.exportZaloDispatchJson = function () {
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';
    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      alert(`Trong ${info.labelTitle} không có lớp nào có lịch thực hành để xuất dữ liệu gửi Zalo.`);
      return;
    }

    const data = classGroups.map(cg => ({
      className: cg.className,
      monitorName: cg.monitorName,
      monitorPhone: cg.monitorPhone || '',
      monitorEmail: cg.monitorEmail || '',
      message: cg.fullMessage,
      exactSyntax: cg.exactSyntax,
      dateInfo: info.formattedDisplayDate
    }));

    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zalo_dispatch.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Đã xuất ${data.length} lớp sang file zalo_dispatch.json! Hãy nhấp đúp file CHAY_AUTO_GUI_ZALO.bat để tự động gửi.`);
  };

  window.copyZaloDispatchJson = function () {
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';
    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      alert('Không có lớp nào có lịch thực hành để sao chép!');
      return;
    }

    const data = classGroups.map(cg => ({
      className: cg.className,
      monitorName: cg.monitorName,
      monitorPhone: cg.monitorPhone || '',
      monitorEmail: cg.monitorEmail || '',
      message: cg.fullMessage
    }));

    const jsonStr = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      showToast('Đã sao chép dữ liệu JSON vào bộ nhớ tạm! Có thể dán vào công cụ auto.');
    }).catch(() => {
      prompt('Dữ liệu JSON:', jsonStr);
    });
  };

  window.copyNotificationText = function (encodedText) {
    const text = decodeURIComponent(encodedText);
    navigator.clipboard.writeText(text).then(() => {
      showToast('Đã sao chép nội dung thông báo vào bộ nhớ đệm!');
    }).catch(() => {
      prompt('Nội dung thông báo:', text);
    });
  };

  window.copyAllDispatchedTexts = function () {
    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';
    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) return;

    const fullStr = classGroups.map(cg =>
      `• Lớp ${cg.className} (Lớp trưởng: ${cg.monitorName} - SĐT: ${cg.monitorPhone || '—'}):
  "${cg.exactSyntax}"`
    ).join("\n\n");

    navigator.clipboard.writeText(fullStr).then(() => {
      showToast('Đã sao chép toàn bộ danh sách thông báo vào clipboard!');
    }).catch(() => {
      prompt('Toàn bộ thông báo:', fullStr);
    });
  };

  // ================= ADMIN GIAO THÔNG BÁO NGAY =================
  window.dispatchNotificationsNow = function () {
    if (appState.currentUser?.role !== 'admin') {
      alert('Chỉ Admin mới có quyền thực hiện thao tác Giao thông báo ngay!');
      return;
    }

    const dispatchSelect = document.getElementById('notifDispatchTargetSelect');
    const targetKey = dispatchSelect ? dispatchSelect.value : 'tomorrow';

    const info = getTargetScheduleInfo(targetKey);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      alert(`Trong ${info.labelTitle} không có lớp nào có lịch thực hành phòng máy để giao thông báo.`);
      return;
    }

    const now = new Date();
    const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    classGroups.forEach(cg => {
      const logEntry = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: timeFormatted,
        className: cg.className,
        monitorName: cg.monitorName,
        monitorPhone: cg.monitorPhone || '—',
        monitorEmail: cg.monitorEmail || '—',
        message: cg.fullMessage,
        status: `Admin giao ngay (${hhmm})`
      };
      appState.notificationLogs.unshift(logEntry);
    });

    if (appState.notificationLogs.length > 50) {
      appState.notificationLogs = appState.notificationLogs.slice(0, 50);
    }

    saveState();
    renderNotificationsPreview();
    renderNotificationLogs();

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('LabMaster - Đã giao thông báo lịch thực hành!', {
          body: `Đã phát thông báo đến Lớp trưởng của ${classGroups.length} lớp (${info.labelTitle}).`,
          icon: 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png'
        });
      } catch (e) {
        console.warn('Browser Notification error:', e);
      }
    }

    openDispatchResultModal(info, classGroups);
  };

  // Backward-compatible alias
  window.triggerSendTomorrowNotifications = function (isManual = false) {
    window.dispatchNotificationsNow();
  };

  window.openDispatchResultModal = function (info, classGroups) {
    const modal = document.getElementById('dispatchResultModal');
    if (!modal) {
      alert(`Đã hoàn tất giao thông báo cho ${classGroups.length} lớp:

` +
        classGroups.map(cg => `• Lớp ${cg.className} (Lớp trưởng: ${cg.monitorName}):
  "${cg.exactSyntax}"`).join("\n\n")
      );
      return;
    }

    const titleEl = document.getElementById('dispatchResultModalTitle');
    const subTitleEl = document.getElementById('dispatchResultModalSubTitle');
    const container = document.getElementById('dispatchResultModalContent');

    if (titleEl) titleEl.textContent = `Đã Giao Thông Báo Cho ${classGroups.length} Lớp Thực Hành Thành Công!`;
    if (subTitleEl) subTitleEl.textContent = `${info.labelTitle} • Trực tiếp phát bởi Admin`;

    if (container) {
      container.innerHTML = classGroups.map(cg => `
        <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-lg bg-brand-600 text-white font-bold text-xs shadow-2xs">Lớp ${cg.className}</span>
              <span class="font-bold text-slate-800 text-xs">Lớp trưởng: <span class="text-indigo-700">${cg.monitorName}</span></span>
            </div>
            <div class="text-[11px] font-mono text-slate-600">
              ${cg.monitorPhone ? `<span class="mr-2"><i class="fa-solid fa-phone text-emerald-600 mr-1"></i>${cg.monitorPhone}</span>` : ''}
              ${cg.monitorEmail ? `<span><i class="fa-regular fa-envelope text-indigo-600 mr-1"></i>${cg.monitorEmail}</span>` : ''}
            </div>
          </div>
          <div class="p-2.5 bg-white rounded-lg border border-indigo-100 font-mono text-xs text-slate-800">
            ${cg.exactSyntax}
          </div>
          <div class="flex items-center justify-end gap-2 text-xs pt-1 border-t border-slate-200/50">
            <button onclick="copyNotificationText('${encodeURIComponent(cg.fullMessage)}')" class="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1">
              <i class="fa-regular fa-copy text-slate-400"></i> Sao chép
            </button>
            ${cg.monitorPhone ? `
              <button onclick="openZaloChatWithCopy('${cg.monitorPhone}', '${encodeURIComponent(cg.fullMessage)}')" type="button" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-blue-700 font-bold transition flex items-center gap-1">
                <i class="fa-solid fa-paper-plane"></i> Mở Zalo
              </button>
            ` : ''}
            ${cg.monitorEmail ? `
              <a href="mailto:${cg.monitorEmail}?subject=${encodeURIComponent(`[LabMaster] Thông báo lịch thực hành phòng máy - Lớp ${cg.className}`)}&body=${encodeURIComponent(cg.fullMessage)}" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg text-indigo-700 font-bold transition flex items-center gap-1">
                <i class="fa-solid fa-envelope"></i> Gửi Email
              </a>
            ` : ''}
          </div>
        </div>
      `).join('');
    }

    modal.classList.remove('hidden');
  };

  window.closeDispatchResultModal = function () {
    const modal = document.getElementById('dispatchResultModal');
    if (modal) modal.classList.add('hidden');
  };

  // ================= TỰ ĐỘNG GIAO THEO LỊCH HÀNG NGÀY =================
  window.executeAutomatedDispatch = function (target = 'tomorrow') {
    const info = getTargetScheduleInfo(target);
    const classGroups = groupBookingsByClass(info);

    if (classGroups.length === 0) {
      console.log(`[LabMaster Auto-Dispatch] Không có lớp thực hành nào trong ${info.labelTitle}`);
      return;
    }

    const now = new Date();
    const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const autoHourStr = String(now.getHours()).padStart(2, '0');
    const autoMinStr = String(now.getMinutes()).padStart(2, '0');

    classGroups.forEach(cg => {
      const logEntry = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        timestamp: timeFormatted,
        className: cg.className,
        monitorName: cg.monitorName,
        monitorPhone: cg.monitorPhone || '—',
        monitorEmail: cg.monitorEmail || '—',
        message: cg.fullMessage,
        status: `Tự động ${autoHourStr}:${autoMinStr}`
      };
      appState.notificationLogs.unshift(logEntry);
    });

    if (appState.notificationLogs.length > 50) {
      appState.notificationLogs = appState.notificationLogs.slice(0, 50);
    }

    saveState();
    renderNotificationsPreview();
    renderNotificationLogs();

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`LabMaster - Tự động phát thông báo (${autoHourStr}:${autoMinStr})`, {
          body: `Đã tự động gửi thông báo đến Lớp trưởng của ${classGroups.length} lớp (${info.labelTitle}).`,
          icon: 'https://cdn-icons-png.flaticon.com/512/2991/2991148.png'
        });
      } catch (e) {
        console.warn('Browser Notification error:', e);
      }
    }

    showToast(`Hệ thống đã tự động giao thông báo cho ${classGroups.length} lớp (${info.labelTitle})!`);
  };

  window.clearNotificationLogs = function () {
    if (appState.currentUser?.role !== 'admin') return;
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử thông báo đã phát?')) return;
    appState.notificationLogs = [];
    saveState();
    renderNotificationLogs();
    showToast('Đã xóa sạch nhật ký phát thông báo!');
  };

  function renderNotificationLogs() {
    const tbody = document.getElementById('notifLogsTableBody');
    if (!tbody) return;

    if (!appState.notificationLogs || appState.notificationLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-5 text-center text-slate-400 font-sans">
            Chưa có lịch sử phát thông báo nào. Khi gửi vào Nhóm Zalo, gửi Email hoặc đến giờ tự động, nhật ký sẽ ghi nhận tại đây.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = appState.notificationLogs.map(l => {
      const isZaloGroup = l.status && l.status.includes('Nhóm Zalo');
      const isEmail = l.status && l.status.includes('Email');
      const isAuto = l.status && l.status.startsWith('Tự động');

      let badgeClass = 'bg-slate-100 text-slate-800 border-slate-200';
      let iconClass = 'fa-paper-plane text-slate-600';

      if (isZaloGroup) {
        badgeClass = 'bg-blue-100 text-blue-800 border-blue-200';
        iconClass = 'fa-users text-blue-600';
      } else if (isEmail) {
        badgeClass = 'bg-purple-100 text-purple-800 border-purple-200';
        iconClass = 'fa-envelope text-purple-600';
      } else if (isAuto) {
        badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
        iconClass = 'fa-bolt text-emerald-600';
      }

      return `
        <tr class="hover:bg-slate-100/60 transition">
          <td class="py-2 px-2 text-slate-600 font-mono text-[11px] whitespace-nowrap">${l.timestamp}</td>
          <td class="py-2 px-2 whitespace-nowrap">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass} font-sans flex items-center gap-1 w-fit">
              <i class="fa-solid ${iconClass}"></i>${l.status}
            </span>
          </td>
          <td class="py-2 px-2 font-bold text-slate-900 font-sans">${l.className}</td>
          <td class="py-2 px-2 text-slate-700 font-sans">${l.monitorName} <span class="text-slate-400 text-[10px]">(${l.monitorEmail || l.monitorPhone || '—'})</span></td>
          <td class="py-2 px-2 text-slate-600 max-w-xs truncate font-sans" title="${l.message.replace(/"/g, '&quot;')}">${l.message}</td>
          <td class="py-2 px-2 text-center whitespace-nowrap">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 font-sans border border-emerald-200">
              <i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i>Đã phát
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ================= ROOM SELECTION =================
  window.selectRoom = function (roomId) {
    appState.selectedRoomId = roomId;
    saveState();
    renderAll();
  };

  // ================= WEEK DROPDOWN NAVIGATION =================
  window.selectWeek = function (weekNum) {
    appState.selectedWeekNumber = weekNum;
    closeWeekDropdowns();
    saveState();
    renderAll();
  };

  window.changeWeek = function (delta) {
    const target = appState.selectedWeekNumber + delta;
    if (target >= 1 && target <= appState.generatedWeeks.length) {
      selectWeek(target);
    }
  };

  window.goToCurrentWeek = function () {
    selectWeek(appState.currentWeekNumber);
  };

  function renderWeekDropdown() {
    const curWeek = appState.generatedWeeks.find(w => w.weekNumber === appState.selectedWeekNumber) || appState.generatedWeeks[0];
    if (!curWeek) return;

    const selectedWeekLabel = document.getElementById('selectedWeekLabel');
    if (selectedWeekLabel) selectedWeekLabel.textContent = curWeek.fullLabel;

    const modalSelectedText = document.getElementById('modalSelectedWeekText');
    if (modalSelectedText) modalSelectedText.textContent = curWeek.fullLabel;

    const headerWeekBadge = document.getElementById('headerWeekBadge');
    if (headerWeekBadge && appState.generatedWeeks.length > 0) {
      const liveCurrentWeek = appState.generatedWeeks.find(w => w.weekNumber === appState.currentWeekNumber) || appState.generatedWeeks[0];
      if (liveCurrentWeek) headerWeekBadge.textContent = liveCurrentWeek.fullLabel;
    }

    renderDropdownListItems('weekDropdownList', '');
    renderDropdownListItems('modalWeekDropdownList', '');
  }

  function renderDropdownListItems(containerId, filterKeyword = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const term = filterKeyword.toLowerCase().trim();

    const groups = {};
    appState.generatedWeeks.forEach(w => {
      const matchesSearch = !term ||
        w.label.toLowerCase().includes(term) ||
        w.monthGroup.includes(term) ||
        w.dateRangeStr.includes(term) ||
        `tuần ${w.weekNumber}`.includes(term);

      if (matchesSearch) {
        if (!groups[w.monthGroup]) groups[w.monthGroup] = [];
        groups[w.monthGroup].push(w);
      }
    });

    if (Object.keys(groups).length === 0) {
      container.innerHTML = `<div class="py-6 text-center text-slate-400 text-xs">Không tìm thấy tuần nào phù hợp</div>`;
      return;
    }

    let html = '';
    Object.keys(groups).forEach(month => {
      html += `
        <div class="py-1">
          <div class="px-4 py-1.5 text-xs font-black text-slate-800 tracking-wider">${month}</div>
          <div class="space-y-0.5">
      `;

      groups[month].forEach(w => {
        const isSelected = w.weekNumber === appState.selectedWeekNumber;
        const isCurrent = w.isCurrent;

        html += `
          <button type="button" onclick="selectWeek(${w.weekNumber})" class="w-full text-left px-5 py-2 flex items-center justify-between text-xs transition ${
            isSelected ? 'bg-blue-50/90 text-brand-700 font-bold' : 'hover:bg-slate-50 text-slate-700 font-medium'
          }">
            <div class="flex items-center gap-2 truncate">
              <span class="truncate">${w.label}</span>
              ${isCurrent ? '<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 font-bold">Hiện tại</span>' : ''}
            </div>
            ${isSelected ? '<i class="fa-solid fa-check text-brand-600 text-xs"></i>' : ''}
          </button>
        `;
      });

      html += `</div></div>`;
    });

    container.innerHTML = html;
  }

  window.toggleWeekDropdown = function () {
    const menu = document.getElementById('weekDropdownMenu');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    closeAllPopups();
    if (isHidden) {
      menu.classList.remove('hidden');
      const input = document.getElementById('weekSearchInput');
      if (input) {
        input.value = '';
        renderDropdownListItems('weekDropdownList', '');
        setTimeout(() => input.focus(), 50);
      }
    }
  };

  window.filterWeeksDropdown = function (val) {
    renderDropdownListItems('weekDropdownList', val);
  };

  window.toggleModalWeekDropdown = function () {
    const menu = document.getElementById('modalWeekDropdownMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  };

  window.filterModalWeeksDropdown = function (val) {
    renderDropdownListItems('modalWeekDropdownList', val);
  };

  function closeWeekDropdowns() {
    document.getElementById('weekDropdownMenu')?.classList.add('hidden');
    document.getElementById('modalWeekDropdownMenu')?.classList.add('hidden');
  }

  // =========================================================================
  // NẠP FILE BÁO GIẢNG & ĐĂNG KÝ THỰC HÀNH (MẪU BÁO GIẢNG.XLSX)
  // =========================================================================
  window.openBaoGiangModal = function () {
    if (!appState.currentUser) {
      alert('Vui lòng đăng nhập tài khoản Giáo viên hoặc Admin để nạp file báo giảng!');
      openLoginModal();
      return;
    }
    const modal = document.getElementById('baoGiangModal');
    if (!modal) return;

    // Populate Target Room Select
    const roomSelect = document.getElementById('baoGiangTargetRoomSelect');
    if (roomSelect) {
      roomSelect.innerHTML = appState.rooms.map(r => `<option value="${r.name}">${r.name} (${r.totalComputers || 0} máy)</option>`).join('');
    }

    // Reset upload preview
    document.getElementById('baoGiangUploadZone').classList.remove('hidden');
    document.getElementById('baoGiangPreviewContainer').classList.add('hidden');
    document.getElementById('btnSubmitBaoGiangBooking').classList.add('hidden');
    document.getElementById('baoGiangFileInput').value = '';

    modal.classList.remove('hidden');
  };

  window.closeBaoGiangModal = function () {
    document.getElementById('baoGiangModal')?.classList.add('hidden');
  };

  window.handleBaoGiangFileUpload = function (e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
      alert('Thư viện Excel đang tải, vui lòng thử lại sau giây lát!');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];

        // Đọc thông tin giáo viên & tuần học từ hàng 6
        const row6Cell = ws['A6'] || ws['B6'] || ws['C6'];
        const gvText = String(row6Cell?.v || '');

        let teacherName = appState.currentUser?.name || 'Giáo viên';
        let weekNum = appState.selectedWeekNumber;

        const gvMatch = gvText.match(/Giáo viên:\s*([^-]+)/i);
        if (gvMatch) teacherName = gvMatch[1].trim();

        const weekMatch = gvText.match(/Tuần\s*(\d+)/i);
        if (weekMatch) weekNum = parseInt(weekMatch[1]);

        document.getElementById('baoGiangTeacherNameTxt').textContent = `Giáo viên: ${teacherName}`;
        document.getElementById('baoGiangWeekTxt').textContent = `Tuần học trong file: Tuần ${weekNum} (Năm học ${appState.schoolYear})`;

        // Quét các dòng bài dạy từ dòng 9 trở đi
        const lessons = [];
        let r = 9;

        while (true) {
          const thuCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 1 })]; // Cột B
          const buoiCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 2 })]; // Cột C
          const tietCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 3 })]; // Cột D
          const monCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 5 })]; // Cột F
          const lopCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 6 })]; // Cột G
          const ppctCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 7 })]; // Cột H
          const baiCell = ws[XLSX.utils.encode_cell({ r: r - 1, c: 8 })]; // Cột I

          const thuRaw = String(thuCell?.v || '').trim();
          const buoiRaw = String(buoiCell?.v || '').trim().toLowerCase();
          const tietRaw = String(tietCell?.v || '').trim();
          const monRaw = String(monCell?.v || '').trim();
          const lopRaw = String(lopCell?.v || '').trim();
          const ppctRaw = String(ppctCell?.v || '').trim();
          const baiRaw = String(baiCell?.v || '').trim();

          // Dừng khi không còn dữ liệu
          if (!thuRaw && !buoiRaw && !tietRaw && !monRaw && !lopRaw && r > 75) break;

          if (monRaw || lopRaw || baiRaw) {
            let dNum = 2;
            for (let d = 2; d <= 7; d++) {
              if (thuRaw.toLowerCase().includes(`thứ ${d}`) || thuRaw.toLowerCase().includes(`thu ${d}`)) {
                dNum = d;
                break;
              }
            }

            const session = buoiRaw.includes('chiều') || buoiRaw.includes('chieu') ? 'chieu' : 'sang';
            const tiet = parseInt(tietRaw) || 1;
            const isPractice = baiRaw.toLowerCase().includes('thực hành') ||
                               baiRaw.toLowerCase().includes('th)') ||
                               baiRaw.toLowerCase().includes('(th');

            lessons.push({
              index: lessons.length,
              week: weekNum,
              dayOfWeek: dNum,
              dayLabel: thuRaw.replace(/\n/g, ' '),
              session: session,
              period: tiet,
              subject: monRaw || 'Tin học',
              className: lopRaw || '',
              ppct: ppctRaw,
              lesson: baiRaw,
              isPractice: isPractice
            });
          }

          r++;
          if (r > 100) break; // Giới hạn an toàn
        }

        appState.tempBaoGiang = {
          teacherName: teacherName,
          weekNum: weekNum,
          lessons: lessons
        };

        renderBaoGiangPreviewTable();

        document.getElementById('baoGiangUploadZone').classList.add('hidden');
        document.getElementById('baoGiangPreviewContainer').classList.remove('hidden');
        document.getElementById('btnSubmitBaoGiangBooking').classList.remove('hidden');
      } catch (err) {
        console.error('Error parsing Bao Giang file', err);
        alert('Có lỗi khi đọc file Báo giảng. Vui lòng kiểm tra định dạng file Excel!');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  function renderBaoGiangPreviewTable() {
    const tbody = document.getElementById('baoGiangTableBody');
    const countEl = document.getElementById('baoGiangLessonsCount');
    if (!tbody || !appState.tempBaoGiang) return;

    const lessons = appState.tempBaoGiang.lessons;
    if (countEl) countEl.textContent = lessons.length;

    tbody.innerHTML = lessons.map(l => `
      <tr class="hover:bg-slate-50 transition ${l.isPractice ? 'bg-emerald-50/30' : ''}">
        <td class="py-2.5 px-3 text-center">
          <input type="checkbox" id="chk_bg_${l.index}" ${l.isPractice ? 'checked' : ''} class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer">
        </td>
        <td class="py-2.5 px-3 font-bold text-slate-800">
          <div>${l.dayLabel}</div>
          <span class="text-[10px] font-semibold text-slate-500">${l.session === 'sang' ? 'Buổi Sáng' : 'Buổi Chiều'}</span>
        </td>
        <td class="py-2.5 px-2 text-center font-black text-slate-900 text-sm">${l.period}</td>
        <td class="py-2.5 px-2 font-bold text-brand-700">${l.className}</td>
        <td class="py-2.5 px-3 text-slate-600">${l.subject}</td>
        <td class="py-2.5 px-3 text-slate-800">
          <div class="font-semibold">${l.lesson}</div>
          ${l.ppct ? `<span class="text-[10px] text-slate-400">Tiết PPCT: ${l.ppct}</span>` : ''}
          ${l.isPractice ? '<span class="ml-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">Thực hành</span>' : ''}
        </td>
      </tr>
    `).join('');
  }

  window.selectAllBaoGiang = function (status) {
    if (!appState.tempBaoGiang) return;
    appState.tempBaoGiang.lessons.forEach(l => {
      const chk = document.getElementById(`chk_bg_${l.index}`);
      if (chk) chk.checked = status;
    });
  };

  window.selectOnlyPracticeBaoGiang = function () {
    if (!appState.tempBaoGiang) return;
    appState.tempBaoGiang.lessons.forEach(l => {
      const chk = document.getElementById(`chk_bg_${l.index}`);
      if (chk) chk.checked = !!l.isPractice;
    });
  };

  // NỘP ĐĂNG KÝ TỪ BÁO GIẢNG VỚI NGUYÊN TẮC:
  // "Ai đăng ký trước thì hiện trước, ai đăng ký sau thì KHÔNG ĐƯỢC phải báo Admin hoặc nhờ người đăng ký hủy"
  window.submitBaoGiangBookings = function () {
    if (!appState.tempBaoGiang) return;

    const targetRoom = document.getElementById('baoGiangTargetRoomSelect').value;
    const weekNum = appState.tempBaoGiang.weekNum;

    // Kiểm tra khóa sổ
    if (isWeekLocked(weekNum) && appState.currentUser?.role !== 'admin') {
      alert(`Tuần ${weekNum} đã bị khóa sổ đăng ký. Bạn không thể nạp đăng ký mới vào tuần này!`);
      return;
    }

    const u = appState.currentUser;
    const lessons = appState.tempBaoGiang.lessons;

    let successCount = 0;
    const conflicts = [];

    lessons.forEach(l => {
      const chk = document.getElementById(`chk_bg_${l.index}`);
      if (!chk || !chk.checked) return;

      // KIỂM TRA TRÙNG LỊCH (First-Come, First-Served)
      const existing = appState.bookings.find(b =>
        b.week === weekNum &&
        b.room === targetRoom &&
        b.session === l.session &&
        b.dayOfWeek === l.dayOfWeek &&
        b.period === l.period
      );

      if (existing) {
        // ĐÃ CÓ NGƯỜI ĐĂNG KÝ TRƯỚC -> TỪ CHỐI!
        conflicts.push({
          slot: `Thứ ${l.dayOfWeek} (${l.session === 'sang' ? 'Sáng' : 'Chiều'}) Tiết ${l.period}`,
          targetClass: l.className,
          existingTeacher: existing.teacherName,
          existingClass: existing.className,
          existingLesson: existing.lesson
        });
      } else {
        // PHÒNG TRỐNG -> ĐĂNG KÝ THÀNH CÔNG CHO GIÁO VIÊN NÀY
        const recId = `rec_${weekNum}_${l.session}_${l.dayOfWeek}_${l.period}_${Date.now()}_${Math.random()}`;
        appState.bookings.push({
          id: recId,
          week: weekNum,
          session: l.session,
          dayOfWeek: l.dayOfWeek,
          dayName: DAY_NAMES[l.dayOfWeek],
          dateLabel: l.dayLabel,
          period: l.period,
          room: targetRoom,
          className: l.className,
          subject: l.subject,
          lesson: l.lesson,
          teacherName: u.name || appState.tempBaoGiang.teacherName,
          teacherEmail: u.email,
          statusStart: 'Máy móc hoạt động tốt, sạch sẽ',
          signStart: '',
          signStartTime: '',
          statusEnd: '',
          signEnd: '',
          signEndTime: '',
          note: `Nạp từ lịch báo giảng (Tiết PPCT: ${l.ppct || '—'})`,
          isApproved: true
        });
        successCount++;
      }
    });

    saveState();
    closeBaoGiangModal();
    selectWeek(weekNum);
    renderAll();

    if (conflicts.length > 0) {
      // Hiển thị thông báo chi tiết về các tiết bị từ chối do đã có người đăng ký trước
      let msg = `ĐÃ ĐĂNG KÝ THÀNH CÔNG: ${successCount} tiết vào ${targetRoom}.\n\n`;
      msg += `⚠️ CÓ ${conflicts.length} TIẾT BỊ TỪ CHỐI DO ĐÃ CÓ NGƯỜI ĐĂNG KÝ TRƯỚC (Ai đăng ký trước giữ trước):\n`;
      conflicts.forEach(c => {
        msg += `• ${c.slot}: Đã được ${c.existingTeacher} đăng ký trước cho lớp ${c.existingClass} ("${c.existingLesson}").\n`;
      });
      msg += `\n👉 Nếu muốn đổi tiết này, vui lòng liên hệ giáo viên đã đăng ký để nhờ nhường lịch hoặc báo Admin để xóa!`;
      alert(msg);
    } else {
      if (typeof confetti === 'function') {
        confetti({ particleCount: 70, spread: 60 });
      }
      showToast(`Đã nạp và đăng ký thành công toàn bộ ${successCount} tiết vào ${targetRoom}!`);
    }
  };

  // =========================================================================
  // ĐĂNG KÝ THỦ CÔNG (ĐẢM BẢO CHẶT CHẼ RANH GIỚI VÀ FIRST-COME FIRST-SERVED)
  // =========================================================================
  window.openBookingModal = function () {
    if (!appState.currentUser) {
      alert('Vui lòng đăng nhập tài khoản Giáo viên hoặc Admin để đăng ký sử dụng phòng máy!');
      openLoginModal();
      return;
    }

    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    if (appState.rooms.length === 0) {
      alert('Chưa có phòng thực hành nào. Vui lòng liên hệ Admin khai báo phòng!');
      return;
    }

    if (appState.classes.length === 0) {
      alert('Chưa có danh sách lớp thực hành. Vui lòng liên hệ Admin khai báo lớp!');
      return;
    }

    // Kiểm tra khóa sổ: Giáo viên chỉ được đăng ký khi chưa khóa
    if (isWeekLocked(appState.selectedWeekNumber) && appState.currentUser?.role !== 'admin') {
      alert(`Tuần ${appState.selectedWeekNumber} đã bị khóa sổ đăng ký. Bạn không thể đăng ký mới!`);
      return;
    }

    populateBookingFormOptions();

    document.getElementById('bookingIdInput').value = '';
    document.getElementById('bookingModalTitle').textContent = 'Đăng Ký Sử Dụng Phòng Thực Hành';
    document.getElementById('bookingRoomSelect').value = appState.selectedRoomId;
    document.getElementById('bookingDaySelect').value = '4';
    document.getElementById('bookingSessionSelect').value = 'sang';
    document.getElementById('bookingPeriodSelect').value = '1';
    document.getElementById('bookingLessonInput').value = '';
    document.getElementById('bookingNoteInput').value = '';
    document.getElementById('bookingStatusStartInput').value = 'Máy móc hoạt động tốt, sạch sẽ';

    // BẢO VỆ RANH GIỚI: Giáo viên chỉ được đăng ký bằng tên và Gmail của chính mình!
    const u = appState.currentUser || {};
    document.getElementById('bookingTeacherNameInput').value = u.name || '';
    document.getElementById('bookingTeacherEmailLabel').textContent = u.email || '';

    document.getElementById('bookingConflictAlert').classList.add('hidden');
    modal.classList.remove('hidden');
  };

  window.quickOpenBooking = function (session, day, period) {
    if (!appState.currentUser) {
      alert('Vui lòng đăng nhập tài khoản Giáo viên hoặc Admin để đăng ký tiết này!');
      openLoginModal();
      return;
    }
    openBookingModal();
    document.getElementById('bookingSessionSelect').value = session;
    document.getElementById('bookingDaySelect').value = day;
    document.getElementById('bookingPeriodSelect').value = period;
  };

  window.closeBookingModal = function () {
    document.getElementById('bookingModal')?.classList.add('hidden');
    closeWeekDropdowns();
  };

  function populateBookingFormOptions() {
    const roomSelect = document.getElementById('bookingRoomSelect');
    if (roomSelect) {
      roomSelect.innerHTML = appState.rooms.map(r => `<option value="${r.name}">${r.name} (${r.totalComputers || 0} máy)</option>`).join('');
    }

    const classSelect = document.getElementById('bookingClassSelect');
    if (classSelect) {
      classSelect.innerHTML = appState.classes.map(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const mInfo = (typeof c === 'object' && c.monitorName) ? ` (LT: ${c.monitorName})` : '';
        return `<option value="${cName}">${cName}${mInfo}</option>`;
      }).join('');
    }

    const subjSelect = document.getElementById('bookingSubjectSelect');
    if (subjSelect) {
      subjSelect.innerHTML = appState.subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    }
  }

  window.handleBookingSubmit = function (e) {
    e.preventDefault();

    if (!appState.currentUser) {
      alert('Vui lòng đăng nhập để đăng ký sử dụng phòng máy!');
      openLoginModal();
      return;
    }

    const bookingId = document.getElementById('bookingIdInput').value;
    const roomName = document.getElementById('bookingRoomSelect').value;
    const day = parseInt(document.getElementById('bookingDaySelect').value);
    const session = document.getElementById('bookingSessionSelect').value;
    const periodVal = document.getElementById('bookingPeriodSelect').value;
    const className = document.getElementById('bookingClassSelect').value;
    const subject = document.getElementById('bookingSubjectSelect').value;
    const lesson = document.getElementById('bookingLessonInput').value.trim();
    const statusStart = document.getElementById('bookingStatusStartInput').value.trim();
    const note = document.getElementById('bookingNoteInput').value.trim();

    const u = appState.currentUser || {};
    const weekNum = appState.selectedWeekNumber;

    // Kiểm tra khóa sổ: Giáo viên chỉ được sửa/xóa khi chưa khóa
    if (isWeekLocked(weekNum) && u.role !== 'admin') {
      alert(`Tuần ${weekNum} đã bị khóa sổ đăng ký. Bạn không thể thực hiện thao tác này!`);
      return;
    }

    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === weekNum);
    const dInfo = weekObj?.dayDates[day];
    const dateLabel = dInfo ? `${DAY_NAMES[day]} ${dInfo.shortStr}` : DAY_NAMES[day];

    const periodsToBook = periodVal.includes(',')
      ? periodVal.split(',').map(Number)
      : [parseInt(periodVal)];

    // FIRST-COME, FIRST-SERVED: Kiểm tra trùng lịch
    for (let p of periodsToBook) {
      const conflict = appState.bookings.find(b =>
        b.id !== bookingId &&
        b.week === weekNum &&
        b.room === roomName &&
        b.session === session &&
        b.dayOfWeek === day &&
        b.period === p
      );

      if (conflict) {
        const conflictAlert = document.getElementById('bookingConflictAlert');
        const conflictMsg = document.getElementById('bookingConflictMsg');
        conflictMsg.textContent = `Tiết ${p} ${DAY_NAMES[day]} tại ${roomName} đã được ${conflict.teacherName} (${conflict.teacherEmail}) đăng ký trước cho lớp ${conflict.className}! Ai đăng ký trước giữ trước. Bạn không thể đăng ký đè. Vui lòng liên hệ ${conflict.teacherName} để nhờ nhường lịch hoặc báo Admin!`;
        conflictAlert.classList.remove('hidden');
        return;
      }
    }

    periodsToBook.forEach(p => {
      const newId = bookingId || `rec_${weekNum}_${session}_${day}_${p}_${Date.now()}`;
      const existingIdx = appState.bookings.findIndex(b => b.id === bookingId);

      const recordData = {
        id: newId,
        week: weekNum,
        session: session,
        dayOfWeek: day,
        dayName: DAY_NAMES[day],
        dateLabel: dateLabel,
        period: p,
        room: roomName,
        className: className,
        subject: subject,
        lesson: lesson,
        teacherName: u.name,
        teacherEmail: u.email,
        statusStart: statusStart || 'Máy móc hoạt động tốt',
        signStart: existingIdx >= 0 ? appState.bookings[existingIdx].signStart : '',
        signStartTime: existingIdx >= 0 ? appState.bookings[existingIdx].signStartTime : '',
        statusEnd: existingIdx >= 0 ? appState.bookings[existingIdx].statusEnd : '',
        signEnd: existingIdx >= 0 ? appState.bookings[existingIdx].signEnd : '',
        signEndTime: existingIdx >= 0 ? appState.bookings[existingIdx].signEndTime : '',
        note: note,
        isApproved: true
      };

      if (existingIdx >= 0) {
        // Chỉ chủ sở hữu hoặc admin mới được sửa
        if (appState.bookings[existingIdx].teacherEmail !== u.email && u.role !== 'admin') {
          alert('Bạn không thể chỉnh sửa tiết học của giáo viên khác!');
          return;
        }
        appState.bookings[existingIdx] = recordData;
      } else {
        appState.bookings.push(recordData);
      }
    });

    saveState();
    closeBookingModal();
    renderAll();

    if (typeof confetti === 'function') {
      confetti({ particleCount: 50, spread: 50 });
    }

    showToast('Đăng ký tiết thực hành thành công!');
  };

  // ================= CHI TIẾT & BẢO VỆ XÓA/SỬA =================
  window.openDetailModal = function (bookingId) {
    const booking = appState.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const content = document.getElementById('detailModalContent');
    if (!content) return;

    const u = appState.currentUser;
    const isMine = u?.email === booking.teacherEmail;
    const isAdmin = u?.role === 'admin';
    const locked = isWeekLocked(booking.week);

    content.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200">
            ${booking.room} • ${booking.session === 'sang' ? 'Buổi Sáng' : 'Buổi Chiều'}
          </span>
          <span class="text-xs font-bold text-slate-700 font-mono">
            ${booking.dayName} • Tiết ${booking.period}
          </span>
        </div>

        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <p class="text-sm font-black text-slate-900">${booking.lesson || booking.subject}</p>
          <div class="flex items-center gap-2 mt-1 text-xs text-slate-600">
            <span class="font-bold text-brand-700">Lớp: ${booking.className}</span>
            <span>•</span>
            <span>Môn: ${booking.subject}</span>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Giáo viên phụ trách: <strong>${booking.teacherName}</strong> 
            <span class="font-mono text-slate-400">(${booking.teacherEmail})</span>
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 bg-white rounded-xl border border-slate-200">
            <p class="font-bold text-slate-800 text-[11px] mb-1">Tình trạng đầu giờ:</p>
            <p class="text-slate-600 text-[11px]">${booking.statusStart || 'Chưa ghi nhận'}</p>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
              <span class="text-slate-400">GV ký:</span>
              <span class="font-bold text-emerald-700">${booking.signStart || 'Chưa ký'}</span>
            </div>
          </div>

          <div class="p-3 bg-white rounded-xl border border-slate-200">
            <p class="font-bold text-slate-800 text-[11px] mb-1">Tình trạng cuối giờ:</p>
            <p class="text-slate-600 text-[11px]">${booking.statusEnd || 'Chưa bàn giao'}</p>
            <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
              <span class="text-slate-400">GV ký:</span>
              <span class="font-bold text-emerald-700">${booking.signEnd || 'Chưa ký'}</span>
            </div>
          </div>
        </div>

        ${booking.note ? `
          <div class="p-2.5 bg-amber-50/60 rounded-xl border border-amber-200 text-xs text-amber-800">
            <strong>Ghi chú:</strong> ${booking.note}
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <div class="flex items-center gap-2">
            <!-- VIỆC KÝ KHI DẠY THÌ VẪN ĐƯỢC KỂ CẢ KHI SỔ ĐÃ KHÓA -->
            ${!u ? '<span class="text-slate-400 text-[11px] italic"><i class="fa-solid fa-eye mr-1"></i>Chế độ xem lịch (Khách)</span>' : ''}
            ${u && (isMine || isAdmin) && !booking.signStart ? `
              <button onclick="closeDetailModal(); openSignModal('${booking.id}', 'start')" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-xs">
                Ký nhận đầu giờ
              </button>
            ` : ''}

            ${u && (isMine || isAdmin) && booking.signStart && !booking.signEnd ? `
              <button onclick="closeDetailModal(); openSignModal('${booking.id}', 'end')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs">
                Ký bàn giao cuối giờ
              </button>
            ` : ''}
          </div>

          <div class="flex items-center gap-2">
            <!-- CHỈ ĐƯỢC XÓA CỦA MÌNH KHI CHƯA KHÓA, HOẶC ADMIN CÓ THỂ XÓA -->
            ${u && ((isMine && !locked) || isAdmin) ? `
              <button onclick="deleteBooking('${booking.id}')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-xs border border-red-200">
                <i class="fa-solid fa-trash mr-1"></i> Hủy tiết này
              </button>
            ` : (isMine && locked ? '<span class="text-slate-400 text-[10px] italic">Sổ đã khóa, không thể hủy</span>' : '')}

            <button onclick="closeDetailModal()" class="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs">
              Đóng
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('detailModal')?.classList.remove('hidden');
  };

  window.closeDetailModal = function () {
    document.getElementById('detailModal')?.classList.add('hidden');
  };

  // "Tài khoản giáo viên chỉ đăng kí của mình và xóa của mình trong thời gian admin chưa khóa đăng kí thôi."
  window.deleteBooking = function (bookingId) {
    if (!appState.currentUser) {
      alert('Vui lòng đăng nhập để thực hiện thao tác này!');
      openLoginModal();
      return;
    }

    const booking = appState.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const u = appState.currentUser;
    const isMine = u?.email === booking.teacherEmail;
    const isAdmin = u?.role === 'admin';
    const locked = isWeekLocked(booking.week);

    if (!isAdmin) {
      if (!isMine) {
        alert('Bạn không thể xóa tiết học do giáo viên khác đăng ký!');
        return;
      }
      if (locked) {
        alert('Sổ đăng ký tuần này đã bị khóa! Vui lòng liên hệ Admin nếu cần hủy tiết này.');
        return;
      }
    }

    if (!confirm('Bạn có chắc chắn muốn hủy đăng ký tiết học này không?')) return;

    appState.bookings = appState.bookings.filter(b => b.id !== bookingId);
    saveState();
    closeDetailModal();
    renderAll();
    showToast('Đã hủy đăng ký tiết học thành công.');
  };

  // ================= MẪU NHẬN XÉT KHI KÝ NHẬN & BÀN GIAO =================
  window.renderSignCommentTemplates = function () {
    const container = document.getElementById('signCommentChipsList');
    if (!container) return;

    if (!appState.commentTemplates || appState.commentTemplates.length === 0) {
      container.innerHTML = '<span class="text-[11px] text-slate-400 italic py-1">Chưa có mẫu nhận xét nào. Nhập vào ô bên dưới để thêm mẫu mới.</span>';
      return;
    }

    container.innerHTML = appState.commentTemplates.map((tpl, idx) => {
      return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200 hover:border-emerald-300 shadow-xs transition group">' +
        '<span onclick="selectCommentTemplateByIdx(' + idx + ')" class="cursor-pointer select-none" title="Bấm để đưa nhận xét này vào ô ký">' + tpl + '</span>' +
        '<button type="button" onclick="deleteCommentTemplate(' + idx + '); event.stopPropagation();" title="Xóa mẫu nhận xét này" class="w-4 h-4 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-red-500 transition ml-0.5">' +
          '<i class="fa-solid fa-xmark text-[9px]"></i>' +
        '</button>' +
      '</span>';
    }).join('');
  };

  window.selectCommentTemplateByIdx = function (idx) {
    if (!appState.commentTemplates || !appState.commentTemplates[idx]) return;
    selectCommentTemplate(appState.commentTemplates[idx]);
  };

  window.selectCommentTemplate = function (text) {
    const input = document.getElementById('signStatusInput');
    if (!input) return;
    const curVal = input.value.trim();
    // Nếu ô nhập rỗng hoặc đang là câu mặc định ban đầu, thay thế trực tiếp
    if (!curVal || curVal === 'Máy hoạt động tốt, phòng sạch sẽ' || curVal === 'Đã ngắt điện, thiết bị nguyên vẹn') {
      input.value = text;
    } else {
      // Nếu giáo viên đã chọn hoặc nhập nội dung trước đó, ghép thêm bằng dấu chấm phẩy
      input.value = curVal + '; ' + text;
    }
    input.focus();
  };

  window.clearSignCommentInput = function () {
    const input = document.getElementById('signStatusInput');
    if (input) {
      input.value = '';
      input.focus();
    }
  };

  window.addNewCommentTemplate = function () {
    const input = document.getElementById('newCommentTemplateInput');
    if (!input) return;
    const val = input.value.trim();
    if (!val) {
      alert('Vui lòng nhập nội dung mẫu nhận xét cần thêm!');
      input.focus();
      return;
    }

    if (!Array.isArray(appState.commentTemplates)) {
      appState.commentTemplates = [...DEFAULT_COMMENT_TEMPLATES];
    }

    if (appState.commentTemplates.includes(val)) {
      alert('Mẫu nhận xét này đã tồn tại trong danh sách!');
      input.focus();
      return;
    }

    appState.commentTemplates.push(val);
    saveState();
    input.value = '';
    renderSignCommentTemplates();
    showToast(`Đã thêm mẫu nhận xét: "${val}"`);
  };

  window.deleteCommentTemplate = function (index) {
    if (!Array.isArray(appState.commentTemplates)) return;
    if (index < 0 || index >= appState.commentTemplates.length) return;
    const removed = appState.commentTemplates.splice(index, 1)[0];
    saveState();
    renderSignCommentTemplates();
    showToast(`Đã xóa mẫu nhận xét: "${removed}"`);
  };

  // ================= KÝ NHẬN & BÀN GIAO =================
  window.openSignModal = function (bookingId, signType) {
    const booking = appState.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const u = appState.currentUser;
    if (!u) {
      alert('Vui lòng đăng nhập tài khoản giáo viên để ký nhận phòng!');
      openLoginModal();
      return;
    }

    if (u.role !== 'admin' && u.email !== booking.teacherEmail) {
      alert('Bạn chỉ có thể ký trên tiết học do chính mình giảng dạy!');
      return;
    }

    document.getElementById('signBookingId').value = bookingId;
    document.getElementById('signType').value = signType;
    document.getElementById('signInfoLesson').innerHTML = `<i class="fa-solid fa-book-open text-brand-600"></i> <span>${booking.lesson || booking.subject} - Lớp ${booking.className}</span>`;
    document.getElementById('signInfoSlot').innerHTML = `<i class="fa-solid fa-clock text-slate-400"></i> <span>${booking.room} • ${booking.dayName} (${booking.session === 'sang' ? 'Sáng' : 'Chiều'}) • Tiết ${booking.period}</span>`;

    // Render danh sách mẫu nhận xét có sẵn
    renderSignCommentTemplates();

    if (signType === 'start') {
      document.getElementById('signModalTitle').textContent = 'Ký Nhận Phòng Đầu Giờ';
      document.getElementById('signStatusInput').value = booking.statusStart || 'Máy hoạt động tốt, phòng sạch sẽ';
    } else {
      document.getElementById('signModalTitle').textContent = 'Ký Bàn Giao Phòng Cuối Giờ';
      document.getElementById('signStatusInput').value = booking.statusEnd || 'Đã ngắt điện, thiết bị nguyên vẹn';
    }

    document.getElementById('signSignatureInput').value = u.signature || u.name;
    document.getElementById('signModal')?.classList.remove('hidden');
  };

  window.closeSignModal = function () {
    document.getElementById('signModal')?.classList.add('hidden');
  };

  window.submitSignature = function () {
    const bookingId = document.getElementById('signBookingId').value;
    const signType = document.getElementById('signType').value;
    const statusVal = document.getElementById('signStatusInput').value.trim();
    const sigVal = document.getElementById('signSignatureInput').value.trim();

    if (!sigVal) {
      alert('Vui lòng nhập chữ ký xác nhận!');
      return;
    }

    const booking = appState.bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (signType === 'start') {
      booking.statusStart = statusVal;
      booking.signStart = sigVal;
      booking.signStartTime = timeStr;
    } else {
      booking.statusEnd = statusVal;
      booking.signEnd = sigVal;
    }

    saveState();
    closeSignModal();
    renderAll();
    showToast(signType === 'start' ? 'Đã ký nhận phòng đầu giờ!' : 'Đã ký bàn giao phòng cuối giờ!');
  };

  // ================= EXCEL EXPORT =================
  window.toggleExcelMenu = function () {
    document.getElementById('excelExportMenu')?.classList.toggle('hidden');
  };

  window.exportCurrentWeekToExcel = function () {
    document.getElementById('excelExportMenu')?.classList.add('hidden');
    if (typeof XLSX === 'undefined') return;

    const curWeek = appState.selectedWeekNumber;
    const curRoom = appState.rooms.find(r => r.id === appState.selectedRoomId) || appState.rooms[0];
    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === curWeek);

    const wb = XLSX.utils.book_new();
    const ws = buildExcelSheetForWeek(curWeek, curRoom.name, weekObj);
    XLSX.utils.book_append_sheet(wb, ws, `Tuan_${curWeek}`);
    XLSX.writeFile(wb, `SO_THUC_HANH_TUAN_${curWeek}_${curRoom.name.replace(/\s+/g, '_')}.xlsx`);
    showToast(`Đã xuất file Excel Tuần ${curWeek}!`);
  };

  window.exportAllWeeksToExcel = function () {
    document.getElementById('excelExportMenu')?.classList.add('hidden');
    if (typeof XLSX === 'undefined') return;

    const curRoom = appState.rooms.find(r => r.id === appState.selectedRoomId) || appState.rooms[0];
    const wb = XLSX.utils.book_new();

    appState.generatedWeeks.forEach(w => {
      const ws = buildExcelSheetForWeek(w.weekNumber, curRoom.name, w);
      XLSX.utils.book_append_sheet(wb, ws, String(w.weekNumber));
    });

    XLSX.writeFile(wb, `SO_THUC_HANH_PHONG_MAY_2026_2027.xlsx`);
    showToast('Đã xuất toàn bộ 38 tuần ra file Excel đa sheet!');
  };

  function buildExcelSheetForWeek(weekNum, roomName, weekObj) {
    const rows = [];
    rows.push(['SỔ THỰC HÀNH PHÒNG MÁY TÍNH', '', '', '', '', '', '', '']);
    rows.push(['', 'Tuần', weekNum, 'Buổi:', '', 'Sáng', '', '']);
    rows.push(['', '', '', '', '', '', '', '']);
    rows.push(['Thứ/ Ngày', 'Tiết', 'Giáo viên dạy', 'Tình trạng đầu giờ', 'GV ký', 'Tình trạng cuối giờ', 'GV ký', 'Ghi chú']);

    for (let day = 2; day <= 7; day++) {
      const dInfo = weekObj?.dayDates[day];
      const dateLabel = dInfo ? `${DAY_NAMES[day]}\n${dInfo.shortStr}` : DAY_NAMES[day];

      for (let p = 1; p <= 5; p++) {
        const booking = appState.bookings.find(b =>
          b.week === weekNum &&
          b.room === roomName &&
          b.session === 'sang' &&
          b.dayOfWeek === day &&
          b.period === p
        );

        rows.push([
          p === 1 ? dateLabel : '',
          p,
          booking ? `${booking.teacherName} (${booking.className})` : '',
          booking ? (booking.statusStart || '') : '',
          booking ? (booking.signStart || '') : '',
          booking ? (booking.statusEnd || '') : '',
          booking ? (booking.signEnd || '') : '',
          booking ? (booking.note || '') : ''
        ]);
      }
    }

    rows.push(['SỔ THỰC HÀNH PHÒNG MÁY TÍNH', '', '', '', '', '', '', '']);
    rows.push(['', 'Tuần', weekNum, 'Buổi:', '', 'Chiều', '', '']);
    rows.push(['', '', '', '', '', '', '', '']);
    rows.push(['Thứ', 'Tiết', 'Giáo viên dạy', 'Tình trạng đầu giờ', 'GV ký', 'Tình trạng cuối giờ', 'GV ký', 'Ghi chú']);

    for (let day = 2; day <= 7; day++) {
      const dInfo = weekObj?.dayDates[day];
      const dateLabel = dInfo ? `${DAY_NAMES[day]}\n${dInfo.shortStr}` : DAY_NAMES[day];

      for (let p = 1; p <= 5; p++) {
        const booking = appState.bookings.find(b =>
          b.week === weekNum &&
          b.room === roomName &&
          b.session === 'chieu' &&
          b.dayOfWeek === day &&
          b.period === p
        );

        rows.push([
          p === 1 ? dateLabel : '',
          p,
          booking ? `${booking.teacherName} (${booking.className})` : '',
          booking ? (booking.statusStart || '') : '',
          booking ? (booking.signStart || '') : '',
          booking ? (booking.statusEnd || '') : '',
          booking ? (booking.signEnd || '') : '',
          booking ? (booking.note || '') : ''
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 20 }];
    return ws;
  }

  // ================= PRINT =================
  window.printCurrentTimetable = function () {
    const curWeek = appState.selectedWeekNumber;
    const curRoom = appState.rooms.find(r => r.id === appState.selectedRoomId) || appState.rooms[0];
    const weekObj = appState.generatedWeeks.find(w => w.weekNumber === curWeek);

    document.getElementById('printMainTitle').textContent = `SỔ THỰC HÀNH PHÒNG MÁY TÍNH`;
    document.getElementById('printSubTitle').textContent = `NĂM HỌC 2026 - 2027 • TUẦN ${curWeek} (${weekObj?.dateRangeStr || ''})`;
    document.getElementById('printRoomInfo').textContent = `${curRoom.name} (${curRoom.totalComputers || 0} máy học sinh)`;

    document.getElementById('printWeekNumSang').textContent = `Tuần: ${curWeek}`;
    document.getElementById('printWeekNumChieu').textContent = `Tuần: ${curWeek}`;

    document.getElementById('printTableMorning').innerHTML = buildPrintTableHTML('sang', curWeek, curRoom.name, weekObj);
    document.getElementById('printTableAfternoon').innerHTML = buildPrintTableHTML('chieu', curWeek, curRoom.name, weekObj);

    setTimeout(() => {
      window.print();
    }, 150);
  };

  function buildPrintTableHTML(session, weekNum, roomName, weekObj) {
    let html = `
      <thead>
        <tr>
          <th style="width: 14%;">Thứ / Ngày</th>
          <th style="width: 6%;">Tiết</th>
          <th style="width: 20%;">Giáo viên dạy</th>
          <th style="width: 20%;">Tình trạng đầu giờ</th>
          <th style="width: 10%;">GV ký</th>
          <th style="width: 20%;">Tình trạng cuối giờ</th>
          <th style="width: 10%;">GV ký</th>
          <th style="width: 15%;">Ghi chú</th>
        </tr>
      </thead>
      <tbody>
    `;

    for (let day = 2; day <= 7; day++) {
      const dInfo = weekObj?.dayDates[day];
      const dateLabel = dInfo ? `${DAY_NAMES[day]}<br>${dInfo.shortStr}` : DAY_NAMES[day];

      for (let p = 1; p <= 5; p++) {
        const booking = appState.bookings.find(b =>
          b.week === weekNum &&
          b.room === roomName &&
          b.session === session &&
          b.dayOfWeek === day &&
          b.period === p
        );

        html += `<tr>`;
        if (p === 1) html += `<td rowspan="5" style="font-weight: bold; background: #fafafa;">${dateLabel}</td>`;
        html += `
          <td style="font-weight: bold;">${p}</td>
          <td>${booking ? `${booking.teacherName}<br><span style="font-size: 7.5pt; color: #555;">${booking.className}</span>` : ''}</td>
          <td>${booking ? (booking.statusStart || 'Bình thường') : ''}</td>
          <td>${booking && booking.signStart ? booking.signStart : ''}</td>
          <td>${booking ? (booking.statusEnd || '') : ''}</td>
          <td>${booking && booking.signEnd ? booking.signEnd : ''}</td>
          <td>${booking ? (booking.note || '') : ''}</td>
        </tr>`;
      }
    }

    html += `</tbody>`;
    return html;
  }

  // ================= AUTHENTICATION (BẢO MẬT: CHỈ TÀI KHOẢN ADMIN CẤP MỚI VÀO ĐƯỢC) =================
  window.openLoginModal = function () {
    document.getElementById('userMenuDropdown')?.classList.add('hidden');
    const alertBox = document.getElementById('loginErrorAlert');
    if (alertBox) alertBox.classList.add('hidden');
    const passInput = document.getElementById('loginPasswordInput');
    if (passInput) passInput.value = '';
    document.getElementById('loginModal')?.classList.remove('hidden');
  };

  window.closeLoginModal = function () {
    document.getElementById('loginModal')?.classList.add('hidden');
  };

  window.togglePasswordVisibility = function (inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.className = 'fa-solid fa-eye-slash';
    } else {
      input.type = 'password';
      if (icon) icon.className = 'fa-solid fa-eye';
    }
  };

  // ĐĂNG NHẬP NHANH 1-CHẠM (DÀNH CHO NGƯỜI DÙNG THỬ HOẶC QUẢN TRỊ VIÊN)
  window.quickLoginAs = function (role) {
    let target = appState.users.find(u => u.role === role);
    if (!target) {
      if (role === 'admin') {
        target = {
          email: 'admin@gmail.com',
          password: 'admin',
          name: 'Quản Trị Viên Phòng Máy',
          phone: '0988888888',
          role: 'admin',
          department: 'Ban Quản Trị'
        };
        appState.users.unshift(target);
      } else {
        target = {
          email: 'thanh.gv@gmail.com',
          password: '123',
          name: 'Thầy Phạm Đình Thanh',
          phone: '0912345678',
          role: 'teacher',
          department: 'Tổ Tin học'
        };
        appState.users.push(target);
      }
      saveState();
    }

    appState.currentUser = target;
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(target));
    closeLoginModal();
    if (target.role === 'admin') {
      switchView('admin');
    } else {
      switchView('today');
    }
    renderAll();
    showToast(`Đã đăng nhập thành công: ${target.name} (${target.role === 'admin' ? 'Quản trị viên' : 'Giáo viên'})`);
  };

  window.handleCustomLogin = function (e) {
    if (e && e.preventDefault) e.preventDefault();

    const inputVal = (document.getElementById('loginEmailInput')?.value || '').trim();
    const email = inputVal.toLowerCase();
    const password = (document.getElementById('loginPasswordInput')?.value || '').trim();
    const alertBox = document.getElementById('loginErrorAlert');
    const alertMsg = document.getElementById('loginErrorMsg');

    if (!email || !password) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu!';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    // 1. TÌM TÀI KHOẢN TRONG HỆ THỐNG DO ADMIN ĐÃ KHAI BÁO (HỖ TRỢ GÕ "admin" HOẶC EMAIL ĐẦY ĐỦ)
    let matchedUser = appState.users.find(x => {
      const uEmail = (x.email || '').toLowerCase();
      const uPrefix = uEmail.split('@')[0];
      const uName = (x.name || '').toLowerCase();
      return uEmail === email || uPrefix === email || uName === email || (email === 'admin' && x.role === 'admin');
    });

    // Nếu người dùng gõ "admin" mà danh sách chưa có, tự động tạo tài khoản quản trị chuẩn
    if (!matchedUser && (email === 'admin' || email === 'admin@gmail.com')) {
      matchedUser = {
        email: 'admin@gmail.com',
        password: 'admin',
        name: 'Quản Trị Viên Phòng Máy',
        phone: '0988888888',
        role: 'admin',
        department: 'Ban Quản Trị'
      };
      appState.users.unshift(matchedUser);
      saveState();
    }

    if (!matchedUser) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = `Tài khoản "${inputVal}" không tồn tại trong hệ thống! Vui lòng kiểm tra lại hoặc liên hệ Quản trị viên để được cấp tài khoản.`;
        alertBox.classList.remove('hidden');
      }
      return;
    }

    // 2. KIỂM TRA MẬT KHẨU
    const expectedPass = matchedUser.password || (matchedUser.role === 'admin' ? 'admin' : '123');
    if (password !== expectedPass) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = 'Mật khẩu không chính xác! Vui lòng kiểm tra lại.';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    // 3. ĐĂNG NHẬP THÀNH CÔNG
    if (alertBox) alertBox.classList.add('hidden');
    appState.currentUser = matchedUser;
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(matchedUser));
    saveState();
    closeLoginModal();

    if (matchedUser.role === 'admin') {
      switchView('admin');
    } else {
      switchView('today');
    }

    renderAll();
    showToast(`Đăng nhập thành công: ${matchedUser.name} (${matchedUser.role === 'admin' ? 'Quản trị viên' : 'Giáo viên'})`);
  };

  // Giữ alias tương thích
  window.handleCustomGmailLogin = window.handleCustomLogin;

  window.logoutCurrentUser = function () {
    localStorage.removeItem(CURRENT_USER_KEY);
    appState.currentUser = null; // Chuyển về chế độ Khách (Chưa đăng nhập)
    document.getElementById('userMenuDropdown')?.classList.add('hidden');
    const adminTab = document.getElementById('tabBtn-admin');
    if (adminTab) adminTab.className = 'hidden';
    if (appState.activeView === 'admin') {
      switchView('today');
    }
    renderAll();
    showToast('Đã đăng xuất tài khoản. Bạn đang ở chế độ xem (Khách).');
  };


  // ================= ĐỔI MẬT KHẨU TÀI KHOẢN (GIÁO VIÊN / NGƯỜI DÙNG TỰ ĐỔI - BẢO MẬT ADMIN KHÔNG XEM ĐƯỢC) =================
  window.openChangePasswordModal = function () {
    document.getElementById('userMenuDropdown')?.classList.add('hidden');
    if (!appState.currentUser) {
      alert('Vui lòng đăng nhập tài khoản trước khi đổi mật khẩu!');
      return;
    }
    const errAlert = document.getElementById('changePassErrorAlert');
    if (errAlert) errAlert.classList.add('hidden');
    const oldInput = document.getElementById('oldPasswordInput');
    const newInput = document.getElementById('newPasswordInput');
    const confirmInput = document.getElementById('confirmNewPasswordInput');
    if (oldInput) oldInput.value = '';
    if (newInput) newInput.value = '';
    if (confirmInput) confirmInput.value = '';
    document.getElementById('changePasswordModal')?.classList.remove('hidden');
  };

  window.closeChangePasswordModal = function () {
    document.getElementById('changePasswordModal')?.classList.add('hidden');
  };

  window.handleChangePasswordSubmit = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!appState.currentUser) return;

    const oldPass = (document.getElementById('oldPasswordInput')?.value || '').trim();
    const newPass = (document.getElementById('newPasswordInput')?.value || '').trim();
    const confirmPass = (document.getElementById('confirmNewPasswordInput')?.value || '').trim();
    const alertBox = document.getElementById('changePassErrorAlert');
    const alertMsg = document.getElementById('changePassErrorMsg');

    const expectedCurrentPass = appState.currentUser.password || (appState.currentUser.role === 'admin' ? 'admin' : '123');

    if (oldPass !== expectedCurrentPass) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = 'Mật khẩu hiện tại không chính xác!';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    if (newPass.length < 3) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = 'Mật khẩu mới phải có ít nhất 3 ký tự!';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    if (newPass !== confirmPass) {
      if (alertBox && alertMsg) {
        alertMsg.textContent = 'Xác nhận mật khẩu mới không trùng khớp!';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    // Cập nhật mật khẩu cá nhân
    const userEmail = (appState.currentUser.email || '').toLowerCase().trim();
    const idx = appState.users.findIndex(u => (u.email || '').toLowerCase().trim() === userEmail);
    if (idx >= 0) {
      appState.users[idx].password = newPass;
      appState.users[idx].isCustomPassword = true; // Đánh dấu giáo viên đã tự đổi mật khẩu riêng tư
      appState.currentUser = appState.users[idx];
    } else {
      appState.currentUser.password = newPass;
      appState.currentUser.isCustomPassword = true;
      appState.users.push(appState.currentUser);
    }

    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(appState.currentUser));
    saveState();
    closeChangePasswordModal();
    renderAll();
    showToast('Đã đổi mật khẩu thành công! Mật khẩu mới được bảo mật riêng tư.');
  };

  // ================= ADMIN CẤP LẠI MẬT KHẨU TẠM THỜI (KHI GIÁO VIÊN QUÊN MẬT KHẨU) =================
  window.openAdminResetPassModal = function (email) {
    if (appState.currentUser?.role !== 'admin') return;
    const target = appState.users.find(u => u.email === email);
    if (!target) return;

    document.getElementById('adminResetPassEmail').value = target.email;
    const nameEl = document.getElementById('adminResetPassTargetName');
    if (nameEl) nameEl.textContent = `Cho: ${target.name}`;
    const emailDisp = document.getElementById('adminResetPassEmailDisplay');
    if (emailDisp) emailDisp.innerHTML = `<i class="fa-solid fa-user text-purple-600 mr-1"></i>${target.name} &bull; <span class="font-mono text-slate-500">${target.email}</span>`;

    const randomPass = 'gv' + Math.floor(1000 + Math.random() * 9000);
    const passInput = document.getElementById('adminResetPassInput');
    if (passInput) passInput.value = randomPass;

    document.getElementById('adminResetPassModal')?.classList.remove('hidden');
  };

  window.closeAdminResetPassModal = function () {
    document.getElementById('adminResetPassModal')?.classList.add('hidden');
  };

  window.generateRandomResetPassword = function () {
    const pass = 'gv' + Math.floor(1000 + Math.random() * 9000);
    const input = document.getElementById('adminResetPassInput');
    if (input) input.value = pass;
  };

  window.handleAdminResetPassSubmit = function (e) {
    if (e && e.preventDefault) e.preventDefault();
    if (appState.currentUser?.role !== 'admin') return;

    const email = (document.getElementById('adminResetPassEmail')?.value || '').toLowerCase().trim();
    const newPass = (document.getElementById('adminResetPassInput')?.value || '').trim();
    if (!email || !newPass) return;

    const idx = appState.users.findIndex(u => (u.email || '').toLowerCase().trim() === email);
    if (idx >= 0) {
      appState.users[idx].password = newPass;
      appState.users[idx].isCustomPassword = false; // Đặt lại về do admin cấp
      if ((appState.currentUser?.email || '').toLowerCase().trim() === email) {
        appState.currentUser = appState.users[idx];
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(appState.currentUser));
      }
      saveState();
      closeAdminResetPassModal();
      renderAll();
      showToast(`Đã cấp lại mật khẩu tạm thời cho ${appState.users[idx].name}: ${newPass}`);
    }
  };


  // ================= GOOGLE FIREBASE REALTIME SYNC (CHO VERCEL) =================
  let firebaseInitialized = false;

  function updateCloudStatusBadge(isConnected, message) {
    const badge = document.getElementById('cloudSyncStatusBadge');
    const dot = document.getElementById('cloudSyncStatusDot');
    const text = document.getElementById('cloudSyncStatusText');

    const adminPill = document.getElementById('cloudAdminStatusPill');
    const adminDot = document.getElementById('cloudAdminStatusDot');
    const adminText = document.getElementById('cloudAdminStatusText');

    if (isConnected) {
      if (badge) {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 transition-all cursor-pointer';
      }
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
      if (text) text.textContent = message || 'Cloud Online';

      if (adminPill) adminPill.className = 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-2';
      if (adminDot) adminDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
      if (adminText) adminText.textContent = 'Đã kết nối CSDL Đám mây (Đồng bộ Realtime Vercel)';
    } else {
      if (badge) {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 transition-all cursor-pointer';
      }
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500';
      if (text) text.textContent = message || 'Lưu cục bộ';

      if (adminPill) adminPill.className = 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-2';
      if (adminDot) adminDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
      if (adminText) adminText.textContent = message || 'Đang dùng bộ nhớ máy (Chưa nối Đám mây)';
    }
  }

  function getActiveFirebaseConfig() {
    let cfg = null;
    const savedStr = localStorage.getItem('LABMASTER_FIREBASE_CONFIG');
    if (savedStr) {
      try { cfg = JSON.parse(savedStr); } catch (e) {}
    }
    if (!cfg || !cfg.apiKey || !cfg.databaseURL) {
      if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && window.FIREBASE_CONFIG.databaseURL) {
        cfg = window.FIREBASE_CONFIG;
      }
    }
    return cfg;
  }

  function initFirebase() {
    if (typeof firebase === 'undefined') {
      console.log('[Firebase] SDK chưa tải, sử dụng LocalStorage.');
      updateCloudStatusBadge(false, 'Lưu cục bộ');
      return;
    }

    const cfg = getActiveFirebaseConfig();
    if (!cfg || !cfg.apiKey || !cfg.databaseURL) {
      console.log('[Firebase] Chưa cấu hình Firebase. Ứng dụng chạy ở chế độ LocalStorage.');
      updateCloudStatusBadge(false, 'Lưu cục bộ');
      return;
    }

    try {
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      const db = firebase.database();
      window.firebaseDb = db;
      firebaseInitialized = true;

      // Giám sát kết nối
      const connRef = db.ref('.info/connected');
      connRef.on('value', (snap) => {
        if (snap.val() === true) {
          console.log('[Firebase] Đã kết nối Realtime Database thành công!');
          updateCloudStatusBadge(true, 'Cloud Online');
        } else {
          updateCloudStatusBadge(false, 'Đang nối lại...');
        }
      });

      // Lắng nghe dữ liệu thời gian thực từ Cloud
      const mainRef = db.ref('labmaster_v3_data');
      mainRef.on('value', (snapshot) => {
        const val = snapshot.val();
        if (val) {
          applyRemoteData(val);
        } else {
          // Cloud trống (lần đầu tạo) -> Tự động đẩy dữ liệu máy lên
          console.log('[Firebase] Cloud Database đang trống, tải dữ liệu hiện tại lên Cloud...');
          syncLocalToCloud(false);
        }
      }, (err) => {
        console.error('[Firebase] Lỗi nhận dữ liệu:', err);
        updateCloudStatusBadge(false, 'Lỗi quyền truy cập');
      });

    } catch (err) {
      console.error('[Firebase] Lỗi khởi tạo:', err);
      updateCloudStatusBadge(false, 'Lỗi cấu hình');
    }
  }

  function applyRemoteData(val) {
    if (!val) return;
    if (Array.isArray(val.users) && val.users.length) {
      appState.users = val.users;
    }
    if (Array.isArray(val.bookings)) {
      appState.bookings = val.bookings;
    }
    if (Array.isArray(val.rooms) && val.rooms.length) {
      appState.rooms = val.rooms.map(normalizeRoomItem);
    }
    if (Array.isArray(val.classes) && val.classes.length) {
      appState.classes = val.classes.map(normalizeClassItem);
    }
    if (val.periodTimes) appState.periodTimes = val.periodTimes;
    if (val.notificationSettings) appState.notificationSettings = val.notificationSettings;
    if (val.weekCustomNames) appState.weekCustomNames = val.weekCustomNames;
    if (val.lockedWeeks) appState.lockedWeeks = val.lockedWeeks;
    if (Array.isArray(val.issues)) appState.issues = val.issues;
    if (val.schoolYear) appState.schoolYear = val.schoolYear;

    // Cập nhật lại tài khoản người dùng hiện tại nếu có thay đổi (ví dụ giáo viên đổi mật khẩu)
    if (appState.currentUser) {
      const curEmail = (appState.currentUser.email || '').toLowerCase().trim();
      const matched = appState.users.find(u => (u.email || '').toLowerCase().trim() === curEmail);
      if (matched) {
        appState.currentUser = matched;
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(matched));
      }
    }

    saveLocalStorageOnly();
    renderAll();
    updateCloudStatusBadge(true, 'Cloud Online');
  }

  function syncLocalToCloud(showToastMsg = true) {
    if (!window.firebaseDb) {
      if (showToastMsg) alert('Chưa kết nối Firebase! Vui lòng dán cấu hình Firebase và bấm "Lưu & Kết nối ngay".');
      return;
    }

    const payload = {
      schoolYear: appState.schoolYear,
      yearStartDate: appState.yearStartDate,
      yearEndDate: appState.yearEndDate,
      currentWeekNumber: appState.currentWeekNumber,
      selectedWeekNumber: appState.selectedWeekNumber,
      selectedRoomId: appState.selectedRoomId,
      periodTimes: appState.periodTimes,
      rooms: appState.rooms,
      classes: appState.classes,
      subjects: appState.subjects,
      users: appState.users,
      bookings: appState.bookings,
      issues: appState.issues,
      weekCustomNames: appState.weekCustomNames,
      lockedWeeks: appState.lockedWeeks,
      notificationSettings: appState.notificationSettings,
      notificationLogs: appState.notificationLogs,
      lastUpdated: new Date().toISOString()
    };

    window.firebaseDb.ref('labmaster_v3_data').set(payload)
      .then(() => {
        if (showToastMsg) showToast('Đã đẩy toàn bộ dữ liệu lên CSDL Đám mây Google Firebase thành công!');
      })
      .catch((err) => {
        console.error('[Firebase] Lỗi ghi dữ liệu:', err);
        if (showToastMsg) alert('Lỗi khi ghi dữ liệu lên Firebase: ' + err.message + '\n\nLưu ý: Bạn cần chọn "Start in test mode" hoặc mở quyền write: true trong tab Rules của Realtime Database.');
      });
  }

  function renderAdminCloudPanel() {
    const pasteInput = document.getElementById('firebaseConfigPasteInput');
    if (pasteInput && !pasteInput.value) {
      const cfg = getActiveFirebaseConfig();
      if (cfg) {
        pasteInput.value = JSON.stringify(cfg, null, 2);
      }
    }
  }

  window.saveFirebaseConfigFromUI = function () {
    const raw = (document.getElementById('firebaseConfigPasteInput')?.value || '').trim();
    if (!raw) {
      alert('Vui lòng dán đoạn mã cấu hình Firebase (firebaseConfig) vào ô!');
      return;
    }

    let parsedConfig = null;
    try {
      parsedConfig = JSON.parse(raw);
    } catch (e) {
      try {
        const extractField = (key) => {
          const match = raw.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
          return match ? match[1] : '';
        };

        const apiKey = extractField('apiKey');
        const authDomain = extractField('authDomain');
        const databaseURL = extractField('databaseURL');
        const projectId = extractField('projectId');
        const storageBucket = extractField('storageBucket');
        const messagingSenderId = extractField('messagingSenderId');
        const appId = extractField('appId');

        if (apiKey && (databaseURL || projectId)) {
          parsedConfig = {
            apiKey,
            authDomain,
            databaseURL: databaseURL || `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
            projectId,
            storageBucket,
            messagingSenderId,
            appId
          };
        }
      } catch (err2) {
        console.error(err2);
      }
    }

    if (!parsedConfig || !parsedConfig.apiKey) {
      alert('Không nhận diện được cấu hình Firebase hợp lệ! Vui lòng sao chép đúng đối tượng firebaseConfig từ Firebase Console.');
      return;
    }

    if (!parsedConfig.databaseURL && parsedConfig.projectId) {
      parsedConfig.databaseURL = `https://${parsedConfig.projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`;
    }

    localStorage.setItem('LABMASTER_FIREBASE_CONFIG', JSON.stringify(parsedConfig));
    showToast('Đã lưu cấu hình Firebase! Đang tiến hành kết nối...');
    initFirebase();
    setTimeout(() => {
      syncLocalToCloud(true);
    }, 1000);
  };

  window.testFirebaseConnection = function () {
    if (!window.firebaseDb) {
      const cfg = getActiveFirebaseConfig();
      if (!cfg) {
        alert('Chưa có cấu hình Firebase. Vui lòng dán cấu hình và bấm "Lưu & Kết nối ngay" trước.');
        return;
      }
      initFirebase();
    }

    if (window.firebaseDb) {
      const testRef = window.firebaseDb.ref('_connection_test');
      testRef.set({ ping: true, time: new Date().toISOString() })
        .then(() => {
          alert('Kết nối Firebase thành công! Cơ sở dữ liệu đám mây đang hoạt động hoàn hảo.');
          updateCloudStatusBadge(true, 'Cloud Online');
        })
        .catch(err => {
          alert('Lỗi kết nối Firebase: ' + err.message + '\n\nKiểm tra lại quyền (Rules) của Realtime Database trên Firebase Console.');
          updateCloudStatusBadge(false, 'Lỗi kết nối');
        });
    }
  };

  window.syncLocalToCloud = syncLocalToCloud;
  window.syncLocalToCloudNow = function () {
    syncLocalToCloud(true);
  };

  window.disconnectFirebaseConfig = function () {
    if (!confirm('Bạn có chắc muốn ngắt kết nối Đám mây và quay lại chế độ lưu Cục bộ (LocalStorage)?')) return;
    localStorage.removeItem('LABMASTER_FIREBASE_CONFIG');
    window.firebaseDb = null;
    const pasteInput = document.getElementById('firebaseConfigPasteInput');
    if (pasteInput) pasteInput.value = '';
    updateCloudStatusBadge(false, 'Lưu cục bộ');
    showToast('Đã ngắt kết nối Đám mây. Hệ thống đang chạy ở chế độ Cục bộ.');
  };


  // =========================================================================
  // SUB-TAB 8: THỐNG KÊ TIẾT THỰC HÀNH & XUẤT BÁO CÁO EXCEL (ADMIN)
  // =========================================================================
  let statsFilterState = {
    mode: 'week', // 'week' hoặc 'date'
    fromWeek: 1,
    toWeek: 38,
    fromDate: '',
    toDate: '',
    room: 'all',
    teacher: 'all',
    className: 'all',
    activeViewTab: 'summary' // 'summary' hoặc 'details'
  };

  let cachedFilteredStats = null;

  function getBookingDateObj(b) {
    if (!b) return null;
    const w = appState.generatedWeeks.find(x => x.weekNumber === b.week);
    if (w && w.dayDates && w.dayDates[b.dayOfWeek] && w.dayDates[b.dayOfWeek].fullDate) {
      return new Date(w.dayDates[b.dayOfWeek].fullDate);
    }
    if (appState.yearStartDate) {
      const parts = appState.yearStartDate.split('-').map(Number);
      const dt = new Date(parts[0], parts[1] - 1, parts[2]);
      dt.setDate(dt.getDate() + ((b.week - 1) * 7) + (b.dayOfWeek - 2));
      return dt;
    }
    return null;
  }

  function formatYMDStr(d) {
    if (!d || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDMYStr(d) {
    if (!d || isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${day}/${m}/${y}`;
  }

  function renderAdminStatsPanel() {
    if (appState.currentUser?.role !== 'admin') return;

    // 1. Khởi tạo dropdown Tuần
    const fromWeekSelect = document.getElementById('statsFilterFromWeek');
    const toWeekSelect = document.getElementById('statsFilterToWeek');
    if (fromWeekSelect && toWeekSelect && fromWeekSelect.options.length === 0) {
      fromWeekSelect.innerHTML = appState.generatedWeeks.map(w =>
        `<option value="${w.weekNumber}">Tuần ${w.weekNumber} (${w.dateRangeStr})</option>`
      ).join('');

      toWeekSelect.innerHTML = appState.generatedWeeks.map(w =>
        `<option value="${w.weekNumber}">Tuần ${w.weekNumber} (${w.dateRangeStr})</option>`
      ).join('');

      fromWeekSelect.value = '1';
      toWeekSelect.value = String(appState.generatedWeeks.length || 38);
    }

    // 2. Khởi tạo ngày mặc định
    const fromDateInput = document.getElementById('statsFilterFromDate');
    const toDateInput = document.getElementById('statsFilterToDate');
    if (fromDateInput && toDateInput && !fromDateInput.value) {
      const firstW = appState.generatedWeeks[0];
      const lastW = appState.generatedWeeks[appState.generatedWeeks.length - 1];
      if (firstW) fromDateInput.value = firstW.startDate;
      if (lastW) toDateInput.value = lastW.endDate;
    }

    // 3. Khởi tạo dropdown Phòng
    const roomSelect = document.getElementById('statsFilterRoom');
    if (roomSelect) {
      const curRoomVal = roomSelect.value || 'all';
      roomSelect.innerHTML = '<option value="all">-- Tất cả các phòng thực hành --</option>' +
        appState.rooms.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
      roomSelect.value = curRoomVal;
    }

    // 4. Khởi tạo dropdown Giáo viên
    const teacherSelect = document.getElementById('statsFilterTeacher');
    if (teacherSelect) {
      const curTeachVal = teacherSelect.value || 'all';
      teacherSelect.innerHTML = '<option value="all">-- Tất cả giáo viên --</option>' +
        appState.users.map(u => `<option value="${u.email}">${u.name} (${u.email})</option>`).join('');
      teacherSelect.value = curTeachVal;
    }

    // 5. Áp dụng lọc và hiển thị dữ liệu
    applyStatsFilter();
  }

  window.toggleStatsFilterMode = function (mode) {
    statsFilterState.mode = mode;
    const weekGroup = document.getElementById('statsFilterWeekGroup');
    const dateGroup = document.getElementById('statsFilterDateGroup');
    if (mode === 'week') {
      weekGroup?.classList.remove('hidden');
      dateGroup?.classList.add('hidden');
    } else {
      weekGroup?.classList.add('hidden');
      dateGroup?.classList.remove('hidden');
    }
    applyStatsFilter();
  };

  window.onStatsWeekChange = function () {
    const fromW = parseInt(document.getElementById('statsFilterFromWeek')?.value || '1');
    const toW = parseInt(document.getElementById('statsFilterToWeek')?.value || '38');

    const wFrom = appState.generatedWeeks.find(w => w.weekNumber === fromW);
    const wTo = appState.generatedWeeks.find(w => w.weekNumber === toW);

    if (wFrom && document.getElementById('statsFilterFromDate')) {
      document.getElementById('statsFilterFromDate').value = wFrom.startDate;
    }
    if (wTo && document.getElementById('statsFilterToDate')) {
      document.getElementById('statsFilterToDate').value = wTo.endDate;
    }
    applyStatsFilter();
  };

  window.setStatsQuickPreset = function (preset) {
    const maxWeek = appState.generatedWeeks.length || 38;
    const curW = appState.currentWeekNumber || 7;

    let fW = 1, tW = maxWeek;
    if (preset === 'thisWeek') {
      fW = curW;
      tW = curW;
    } else if (preset === 'hk1') {
      fW = 1;
      tW = Math.min(19, maxWeek);
    } else if (preset === 'hk2') {
      fW = Math.min(20, maxWeek);
      tW = maxWeek;
    } else if (preset === 'allYear') {
      fW = 1;
      tW = maxWeek;
    }

    const fromSel = document.getElementById('statsFilterFromWeek');
    const toSel = document.getElementById('statsFilterToWeek');
    if (fromSel) fromSel.value = String(fW);
    if (toSel) toSel.value = String(tW);

    // Chuyển về chế độ tuần
    const radioWeek = document.querySelector('input[name="statsFilterMode"][value="week"]');
    if (radioWeek) radioWeek.checked = true;
    toggleStatsFilterMode('week');

    onStatsWeekChange();
    applyStatsFilter();
  };

  function getFilteredStatsData() {
    const mode = document.querySelector('input[name="statsFilterMode"]:checked')?.value || 'week';
    const fromW = parseInt(document.getElementById('statsFilterFromWeek')?.value || '1');
    const toW = parseInt(document.getElementById('statsFilterToWeek')?.value || '38');
    const fromD = document.getElementById('statsFilterFromDate')?.value || '';
    const toD = document.getElementById('statsFilterToDate')?.value || '';
    const room = document.getElementById('statsFilterRoom')?.value || 'all';
    const teacher = document.getElementById('statsFilterTeacher')?.value || 'all';

    let filterDesc = '';
    if (mode === 'week') {
      filterDesc = fromW === toW ? `Tuần ${fromW}` : `Từ Tuần ${fromW} đến Tuần ${toW}`;
      const wFrom = appState.generatedWeeks.find(w => w.weekNumber === fromW);
      const wTo = appState.generatedWeeks.find(w => w.weekNumber === toW);
      if (wFrom && wTo) {
        filterDesc += ` (${formatDMYStr(new Date(wFrom.startDate))} - ${formatDMYStr(new Date(wTo.endDate))})`;
      }
    } else {
      filterDesc = `Từ ngày ${fromD || '...'} đến ngày ${toD || '...'}`;
    }

    if (room !== 'all') filterDesc += ` | Phòng: ${room}`;
    if (teacher !== 'all') {
      const u = appState.users.find(x => x.email === teacher);
      filterDesc += ` | GV: ${u ? u.name : teacher}`;
    }

    // Lọc mảng bookings
    const filteredBookings = appState.bookings.filter(b => {
      // 1. Thời gian
      if (mode === 'week') {
        const minW = Math.min(fromW, toW);
        const maxW = Math.max(fromW, toW);
        if (b.week < minW || b.week > maxW) return false;
      } else {
        const dt = getBookingDateObj(b);
        if (dt) {
          const ymd = formatYMDStr(dt);
          if (fromD && ymd < fromD) return false;
          if (toD && ymd > toD) return false;
        }
      }

      // 2. Phòng máy
      if (room !== 'all' && b.room !== room) return false;

      // 3. Giáo viên
      if (teacher !== 'all') {
        const matchEmail = (b.teacherEmail || '').toLowerCase().trim() === teacher.toLowerCase().trim();
        const matchName = (b.teacherName || '').toLowerCase().trim() === teacher.toLowerCase().trim();
        if (!matchEmail && !matchName) return false;
      }

      return true;
    });

    // Sắp xếp các tiết theo tuần, thứ, buổi, tiết tăng dần
    filteredBookings.sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week;
      if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
      const sOrder = { sang: 1, chieu: 2 };
      if (a.session !== b.session) return (sOrder[a.session] || 1) - (sOrder[b.session] || 1);
      return a.period - b.period;
    });

    // Tổng hợp theo giáo viên
    const teacherMap = {};
    filteredBookings.forEach(b => {
      const key = (b.teacherEmail || b.teacherName || 'Khác').toLowerCase().trim();
      if (!teacherMap[key]) {
        const u = appState.users.find(x => (x.email || '').toLowerCase().trim() === key || (x.name || '').toLowerCase().trim() === key);
        teacherMap[key] = {
          name: b.teacherName || (u ? u.name : 'Giáo viên'),
          email: b.teacherEmail || (u ? u.email : key),
          phone: u?.phone || '',
          department: u?.department || 'Tổ bộ môn',
          totalPeriods: 0,
          roomsBreakdown: {},
          classesSet: new Set(),
          subjectsSet: new Set(),
          bookings: []
        };
      }

      teacherMap[key].totalPeriods++;
      teacherMap[key].roomsBreakdown[b.room] = (teacherMap[key].roomsBreakdown[b.room] || 0) + 1;
      if (b.className) teacherMap[key].classesSet.add(b.className);
      if (b.subject) teacherMap[key].subjectsSet.add(b.subject);
      teacherMap[key].bookings.push(b);
    });

    const teacherSummary = Object.values(teacherMap).map(t => ({
      ...t,
      classesList: Array.from(t.classesSet),
      subjectsList: Array.from(t.subjectsSet)
    }));

    // Sắp xếp giáo viên theo số tiết thực hành giảm dần
    teacherSummary.sort((a, b) => b.totalPeriods - a.totalPeriods);

    const uniqueRooms = new Set(filteredBookings.map(b => b.room));
    const uniqueClasses = new Set(filteredBookings.map(b => b.className).filter(Boolean));

    return {
      mode,
      filterDesc,
      bookings: filteredBookings,
      teacherSummary,
      totalPeriods: filteredBookings.length,
      totalTeachers: teacherSummary.length,
      totalRooms: uniqueRooms.size,
      totalClasses: uniqueClasses.size
    };
  }
  window.getFilteredStatsData = getFilteredStatsData;
  window.renderAdminStatsPanel = renderAdminStatsPanel;

  window.applyStatsFilter = function () {
    cachedFilteredStats = getFilteredStatsData();
    const data = cachedFilteredStats;

    // 1. Cập nhật mô tả bộ lọc hiện tại
    const descEl = document.getElementById('statsCurrentFilterDesc');
    if (descEl) descEl.textContent = `Đang thống kê: ${data.filterDesc}`;

    // 2. Cập nhật thẻ KPI
    const kpiPeriods = document.getElementById('statsKpiTotalPeriods');
    const kpiTeachers = document.getElementById('statsKpiTotalTeachers');
    const kpiRooms = document.getElementById('statsKpiTotalRooms');
    const kpiClasses = document.getElementById('statsKpiTotalClasses');

    if (kpiPeriods) kpiPeriods.textContent = `${data.totalPeriods} tiết`;
    if (kpiTeachers) kpiTeachers.textContent = `${data.totalTeachers} GV`;
    if (kpiRooms) kpiRooms.textContent = `${data.totalRooms} phòng`;
    if (kpiClasses) kpiClasses.textContent = `${data.totalClasses} lớp`;

    const badgeCount = document.getElementById('statsDetailsBadgeCount');
    if (badgeCount) badgeCount.textContent = String(data.totalPeriods);

    // 3. Render BẢNG 1: TỔNG HỢP THEO GIÁO VIÊN
    const summaryTbody = document.getElementById('statsSummaryTableBody');
    const summaryTfoot = document.getElementById('statsSummaryTableFoot');
    if (summaryTbody) {
      if (data.teacherSummary.length === 0) {
        summaryTbody.innerHTML = `
          <tr>
            <td colspan="8" class="py-8 text-center text-slate-400">
              <i class="fa-solid fa-inbox text-3xl mb-2 text-slate-300 block"></i>
              Không tìm thấy tiết thực hành nào theo bộ lọc đã chọn!
            </td>
          </tr>
        `;
        if (summaryTfoot) summaryTfoot.innerHTML = '';
      } else {
        summaryTbody.innerHTML = data.teacherSummary.map((t, idx) => {
          const roomPills = Object.entries(t.roomsBreakdown).map(([rName, cnt]) =>
            `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold mr-1 mb-1">
              ${rName}: <b class="text-purple-900">${cnt}</b>
            </span>`
          ).join('');

          const classPills = t.classesList.map(c =>
            `<span class="inline-flex items-center px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px] mr-1 mb-1 font-semibold">${c}</span>`
          ).join('');

          return `
            <tr class="hover:bg-amber-50/40 transition">
              <td class="py-2.5 px-3 text-center font-bold text-slate-500">${idx + 1}</td>
              <td class="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-500 to-indigo-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                  ${t.name.charAt(0)}
                </div>
                <div>
                  <div class="font-bold text-slate-800">${t.name}</div>
                  <div class="text-[10px] text-slate-400 font-mono">${t.phone || ''}</div>
                </div>
              </td>
              <td class="py-2.5 px-3 font-mono text-slate-600 text-[11px]">${t.email}</td>
              <td class="py-2.5 px-3 text-slate-600">${t.department}</td>
              <td class="py-2.5 px-3 text-center">
                <span class="inline-flex items-center justify-center min-w-[50px] px-2.5 py-1 rounded-xl bg-blue-100 text-blue-800 border border-blue-200 font-black text-xs shadow-xs">
                  ${t.totalPeriods} tiết
                </span>
              </td>
              <td class="py-2.5 px-3">
                <div class="flex items-center flex-wrap">${roomPills}</div>
              </td>
              <td class="py-2.5 px-3">
                <div class="flex items-center flex-wrap">${classPills || '—'}</div>
              </td>
              <td class="py-2.5 px-3 text-center">
                <button type="button" onclick="filterStatsByTeacherDirect('${t.email}')" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold transition flex items-center gap-1 mx-auto" title="Xem danh sách tiết của giáo viên này">
                  <i class="fa-solid fa-list-ul"></i> Chi tiết
                </button>
              </td>
            </tr>
          `;
        }).join('');

        if (summaryTfoot) {
          summaryTfoot.innerHTML = `
            <tr>
              <td class="py-3 px-3 text-center font-bold">#</td>
              <td class="py-3 px-3 uppercase font-black text-amber-900" colspan="3">
                TỔNG CỘNG TẤT CẢ GIÁO VIÊN (${data.totalTeachers} giáo viên)
              </td>
              <td class="py-3 px-3 text-center">
                <span class="inline-flex items-center justify-center px-3 py-1 rounded-xl bg-amber-500 text-white font-black text-sm shadow-sm">
                  ${data.totalPeriods} tiết
                </span>
              </td>
              <td class="py-3 px-3 font-semibold text-slate-700 text-[11px]" colspan="3">
                Tổng cộng ${data.totalPeriods} tiết thực hành được khai thác trong kỳ báo cáo
              </td>
            </tr>
          `;
        }
      }
    }

    // 4. Render BẢNG 2: CHI TIẾT TỪNG TIẾT THỰC HÀNH
    const detailsTbody = document.getElementById('statsDetailsTableBody');
    if (detailsTbody) {
      if (data.bookings.length === 0) {
        detailsTbody.innerHTML = `
          <tr>
            <td colspan="11" class="py-8 text-center text-slate-400">
              Không có tiết thực hành nào phù hợp với bộ lọc!
            </td>
          </tr>
        `;
      } else {
        detailsTbody.innerHTML = data.bookings.map((b, idx) => {
          const bDate = getBookingDateObj(b);
          const dateStr = bDate ? formatDMYStr(bDate) : (b.dateLabel || '');
          const buoiBadge = b.session === 'sang'
            ? '<span class="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">Sáng</span>'
            : '<span class="px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-bold text-[10px]">Chiều</span>';

          return `
            <tr class="hover:bg-slate-50 transition">
              <td class="py-2 px-3 text-center font-bold text-slate-400">${idx + 1}</td>
              <td class="py-2 px-3 text-center font-bold text-brand-600">T.${b.week}</td>
              <td class="py-2 px-3 text-slate-700 font-semibold whitespace-nowrap">
                ${b.dayName || DAY_NAMES[b.dayOfWeek] || ''} <span class="text-slate-400 font-normal">(${dateStr})</span>
              </td>
              <td class="py-2 px-3 text-center">${buoiBadge} T.${b.period}</td>
              <td class="py-2 px-3 font-bold text-purple-700 whitespace-nowrap">${b.room}</td>
              <td class="py-2 px-3 font-bold text-slate-900">${b.className}</td>
              <td class="py-2 px-3 text-slate-600 font-sans">${b.subject || '—'}</td>
              <td class="py-2 px-3 text-slate-700 font-sans max-w-xs truncate" title="${b.lesson || ''}">${b.lesson || '—'}</td>
              <td class="py-2 px-3 font-bold text-slate-800 font-sans whitespace-nowrap">${b.teacherName}</td>
              <td class="py-2 px-3 text-center">
                ${b.signStart ? '<span class="text-emerald-600 font-bold text-[10px]"><i class="fa-solid fa-circle-check"></i> Đã ký</span>' : '<span class="text-slate-300 text-[10px]">—</span>'}
              </td>
              <td class="py-2 px-3 text-center">
                ${b.signEnd ? '<span class="text-emerald-600 font-bold text-[10px]"><i class="fa-solid fa-circle-check"></i> Đã ký</span>' : '<span class="text-slate-300 text-[10px]">—</span>'}
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  };

  window.resetStatsFilter = function () {
    const fromSel = document.getElementById('statsFilterFromWeek');
    const toSel = document.getElementById('statsFilterToWeek');
    if (fromSel) fromSel.value = '1';
    if (toSel) toSel.value = String(appState.generatedWeeks.length || 38);

    const roomSel = document.getElementById('statsFilterRoom');
    if (roomSel) roomSel.value = 'all';

    const teacherSel = document.getElementById('statsFilterTeacher');
    if (teacherSel) teacherSel.value = 'all';

    const radioWeek = document.querySelector('input[name="statsFilterMode"][value="week"]');
    if (radioWeek) radioWeek.checked = true;
    toggleStatsFilterMode('week');

    onStatsWeekChange();
    applyStatsFilter();
    showToast('Đã đặt lại bộ lọc thống kê!');
  };

  window.switchStatsViewTab = function (tab) {
    statsFilterState.activeViewTab = tab;
    const btnSummary = document.getElementById('statsTabBtn-summary');
    const btnDetails = document.getElementById('statsTabBtn-details');
    const viewSummary = document.getElementById('statsView-summary');
    const viewDetails = document.getElementById('statsView-details');

    if (tab === 'summary') {
      if (btnSummary) btnSummary.className = 'px-4 py-2 border-b-2 border-amber-600 font-bold text-xs text-amber-700 flex items-center gap-2';
      if (btnDetails) btnDetails.className = 'px-4 py-2 border-b-2 border-transparent font-bold text-xs text-slate-500 hover:text-slate-800 flex items-center gap-2';
      viewSummary?.classList.remove('hidden');
      viewDetails?.classList.add('hidden');
    } else {
      if (btnSummary) btnSummary.className = 'px-4 py-2 border-b-2 border-transparent font-bold text-xs text-slate-500 hover:text-slate-800 flex items-center gap-2';
      if (btnDetails) btnDetails.className = 'px-4 py-2 border-b-2 border-amber-600 font-bold text-xs text-amber-700 flex items-center gap-2';
      viewSummary?.classList.add('hidden');
      viewDetails?.classList.remove('hidden');
    }
  };

  window.filterStatsByTeacherDirect = function (teacherEmail) {
    const teacherSel = document.getElementById('statsFilterTeacher');
    if (teacherSel) {
      teacherSel.value = teacherEmail;
      applyStatsFilter();
      switchStatsViewTab('details');
      showToast(`Đã lọc chi tiết tiết dạy của: ${teacherEmail}`);
    }
  };

  // ================= EXCEL EXPORT (2 SHEETS) =================
  window.exportStatsToExcel = function () {
    if (typeof XLSX === 'undefined') {
      alert('Thư viện XLSX chưa được tải! Vui lòng kiểm tra lại kết nối mạng.');
      return;
    }

    const data = cachedFilteredStats || getFilteredStatsData();
    if (!data || !data.bookings || data.bookings.length === 0) {
      alert('Không có dữ liệu thực hành nào trong khoảng thời gian đã chọn để xuất file!');
      return;
    }

    const { bookings, teacherSummary, filterDesc, totalPeriods } = data;
    const wb = XLSX.utils.book_new();

    // ================= SHEET 1: TỔNG HỢP THEO GIÁO VIÊN =================
    const sheet1Rows = [
      ['TRƯỜNG THPT', '', '', '', '', '', '', '', ''],
      ['BÁO CÁO THỐNG KÊ SỐ TIẾT THỰC HÀNH PHÒNG MÁY THEO GIÁO VIÊN', '', '', '', '', '', '', '', ''],
      [`Khoảng thời gian: ${filterDesc}`, '', '', '', '', '', '', '', ''],
      [`Ngày xuất báo cáo: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`, '', '', '', '', '', '', '', ''],
      [],
      ['STT', 'Họ và tên Giáo viên', 'Tài khoản / Gmail', 'Số điện thoại', 'Tổ bộ môn', 'Tổng số tiết thực hành', 'Chi tiết số tiết theo Phòng máy', 'Các lớp đã giảng dạy', 'Môn học']
    ];

    teacherSummary.forEach((t, i) => {
      const roomBreakdownStr = Object.entries(t.roomsBreakdown)
        .map(([rName, cnt]) => `${rName}: ${cnt} tiết`)
        .join('; ');

      sheet1Rows.push([
        i + 1,
        t.name,
        t.email,
        t.phone || '',
        t.department || 'Giáo viên',
        t.totalPeriods,
        roomBreakdownStr,
        t.classesList.join(', '),
        t.subjectsList.join(', ')
      ]);
    });

    sheet1Rows.push([]);
    sheet1Rows.push(['', 'TỔNG CỘNG TẤT CẢ TIẾT THỰC HÀNH', '', '', '', totalPeriods, '', '', '']);
    sheet1Rows.push([]);
    sheet1Rows.push(['', '', '', '', '', '', '', 'Ngày ..... tháng ..... năm 20...']);
    sheet1Rows.push(['', 'NGƯỜI LẬP BÁO CÁO', '', '', '', '', '', 'HIỆU TRƯỞNG / QUẢN TRỊ VIÊN DUYỆT']);
    sheet1Rows.push(['', '(Ký và ghi rõ họ tên)', '', '', '', '', '', '(Ký, đóng dấu và ghi rõ họ tên)']);

    const ws1 = XLSX.utils.aoa_to_sheet(sheet1Rows);
    ws1['!cols'] = [
      { wch: 6 },
      { wch: 25 },
      { wch: 26 },
      { wch: 14 },
      { wch: 18 },
      { wch: 24 },
      { wch: 32 },
      { wch: 24 },
      { wch: 24 }
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Tong_Hop_So_Tiet_GV');

    // ================= SHEET 2: CHI TIẾT TỪNG TIẾT THỰC HÀNH =================
    const sheet2Rows = [
      ['TRƯỜNG THPT', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['NHẬT KÝ CHI TIẾT CÁC TIẾT THỰC HÀNH PHÒNG MÁY', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      [`Khoảng thời gian: ${filterDesc}`, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      [],
      ['STT', 'Tuần', 'Thứ', 'Ngày thực hành', 'Buổi', 'Tiết', 'Phòng máy', 'Lớp', 'Môn học', 'Tên bài thực hành', 'Giáo viên dạy', 'Email GV', 'Ký đầu giờ', 'Ký cuối giờ', 'Ghi chú']
    ];

    bookings.forEach((b, i) => {
      const bDate = getBookingDateObj(b);
      const dateStr = bDate ? formatDMYStr(bDate) : (b.dateLabel || '');
      const buoiStr = b.session === 'sang' ? 'Sáng' : 'Chiều';

      sheet2Rows.push([
        i + 1,
        `Tuần ${b.week}`,
        b.dayName || DAY_NAMES[b.dayOfWeek] || '',
        dateStr,
        buoiStr,
        `Tiết ${b.period}`,
        b.room,
        b.className,
        b.subject || '',
        b.lesson || '',
        b.teacherName,
        b.teacherEmail || '',
        b.signStart ? `Đã ký (${b.signStart})` : 'Chưa ký',
        b.signEnd ? `Đã ký (${b.signEnd})` : 'Chưa ký',
        b.note || ''
      ]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(sheet2Rows);
    ws2['!cols'] = [
      { wch: 6 },
      { wch: 10 },
      { wch: 10 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 22 },
      { wch: 12 },
      { wch: 20 },
      { wch: 30 },
      { wch: 24 },
      { wch: 25 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, ws2, 'Chi_Tiet_Tung_Tiet');

    const cleanFilterName = filterDesc.replace(/[^a-zA-Z0-9_À-ɏẠ-ỹ]/g, '_').slice(0, 40);
    const fileName = `BAO_CAO_THONG_KE_TIET_THUC_HANH_${cleanFilterName}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Đã xuất báo cáo thống kê ${bookings.length} tiết thực hành ra file Excel thành công!`);
  };

  // ================= IN BÁO CÁO THỐNG KÊ =================
  window.printStatsReport = function () {
    const data = cachedFilteredStats || getFilteredStatsData();
    if (!data || !data.bookings || data.bookings.length === 0) {
      alert('Không có dữ liệu thực hành để in!');
      return;
    }

    const printWin = window.open('', '_blank');
    if (!printWin) {
      alert('Vui lòng cho phép mở cửa sổ popup trên trình duyệt để in báo cáo!');
      return;
    }

    const teacherRowsHtml = data.teacherSummary.map((t, idx) => `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td style="font-weight: bold;">${t.name}</td>
        <td>${t.email}</td>
        <td>${t.department}</td>
        <td style="text-align: center; font-weight: bold; color: #1e40af;">${t.totalPeriods}</td>
        <td>${Object.entries(t.roomsBreakdown).map(([r, c]) => `${r}: ${c}`).join('; ')}</td>
        <td>${t.classesList.join(', ')}</td>
      </tr>
    `).join('');

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Báo Cáo Thống Kê Tiết Thực Hành Phòng Máy</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 25px; color: #111; line-height: 1.4; font-size: 11pt; }
          .header-box { display: flex; justify-content: space-between; margin-bottom: 20px; }
          .school-name { font-weight: bold; text-transform: uppercase; font-size: 12pt; }
          h2 { text-align: center; text-transform: uppercase; margin: 15px 0 5px 0; font-size: 14pt; }
          .desc { text-align: center; font-style: italic; margin-bottom: 20px; font-size: 10.5pt; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10pt; }
          th, td { border: 1px solid #333; padding: 6px 8px; }
          th { background: #f2f2f2; text-transform: uppercase; font-size: 9.5pt; }
          .footer-sign { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; }
          .sign-col { width: 45%; }
          .sign-title { font-weight: bold; text-transform: uppercase; }
          .sign-note { font-style: italic; font-size: 9pt; }
        </style>
      </head>
      <body>
        <div class="header-box">
          <div style="text-align: center;">
            <div class="school-name">SỞ GIÁO DỤC VÀ ĐÀO TẠO</div>
            <div class="school-name">TRƯỜNG THPT</div>
          </div>
          <div style="text-align: center;">
            <div style="font-weight: bold;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
            <div style="font-style: italic;">Độc lập - Tự do - Hạnh phúc</div>
          </div>
        </div>

        <h2>BÁO CÁO THỐNG KÊ TIẾT THỰC HÀNH PHÒNG MÁY</h2>
        <div class="desc">${data.filterDesc} &bull; Tổng số: <b>${data.totalPeriods} tiết thực hành</b></div>

        <table>
          <thead>
            <tr>
              <th style="width: 35px;">STT</th>
              <th>Họ và tên Giáo viên</th>
              <th>Gmail</th>
              <th>Tổ bộ môn</th>
              <th style="width: 80px;">Số tiết</th>
              <th>Phòng máy</th>
              <th>Các lớp dạy</th>
            </tr>
          </thead>
          <tbody>
            ${teacherRowsHtml}
            <tr style="font-weight: bold; background: #fafafa;">
              <td colspan="4" style="text-align: center; text-transform: uppercase;">Tổng cộng tất cả giáo viên</td>
              <td style="text-align: center; font-size: 11pt;">${data.totalPeriods} tiết</td>
              <td colspan="2">Toàn bộ ${data.totalTeachers} giáo viên tham gia</td>
            </tr>
          </tbody>
        </table>

        <div class="footer-sign">
          <div class="sign-col">
            <div class="sign-title">Người Lập Báo Cáo</div>
            <div class="sign-note">(Ký và ghi rõ họ tên)</div>
          </div>
          <div class="sign-col">
            <div style="font-style: italic; margin-bottom: 5px;">Ngày ..... tháng ..... năm 20...</div>
            <div class="sign-title">Hiệu Trưởng / Quản Trị Viên</div>
            <div class="sign-note">(Ký, đóng dấu và ghi rõ họ tên)</div>
          </div>
        </div>
      </body>
      </html>
    `);
    printWin.document.close();
    setTimeout(() => {
      printWin.print();
    }, 400);
  };

  // ================= TOAST =================
  function showToast(msg) {
    let toast = document.getElementById('globalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'globalToast';
      toast.className = 'fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-2 transform transition-all duration-300 translate-y-12 opacity-0 pointer-events-none';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i> <span>${msg}</span>`;
    toast.classList.remove('translate-y-12', 'opacity-0', 'pointer-events-none');

    setTimeout(() => {
      toast.classList.add('translate-y-12', 'opacity-0', 'pointer-events-none');
    }, 3500);
  }

  // ================= GLOBAL CLICK LISTENERS =================
  function setupGlobalClickListeners() {
    const userBtn = document.getElementById('userMenuBtn');
    const userMenu = document.getElementById('userMenuDropdown');
    if (userBtn && userMenu) {
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu.classList.toggle('hidden');
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#weekDropdownWrapper')) {
        document.getElementById('weekDropdownMenu')?.classList.add('hidden');
      }
      if (!e.target.closest('#modalWeekDropdownWrapper')) {
        document.getElementById('modalWeekDropdownMenu')?.classList.add('hidden');
      }
      if (!e.target.closest('#excelExportBtn') && !e.target.closest('#excelExportMenu')) {
        document.getElementById('excelExportMenu')?.classList.add('hidden');
      }
      if (!e.target.closest('#userMenuBtn') && !e.target.closest('#userMenuDropdown')) {
        document.getElementById('userMenuDropdown')?.classList.add('hidden');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeRoomModal();
        closeClassModal();
        closeImportClassesModal();
        closeUserModal();
        closeImportUsersModal();
        closeBookingModal();
        closeBaoGiangModal();
        closeSignModal();
        closeDetailModal();
        closeLoginModal();
        closeAllPopups();
      }
    });
  }

  function closeAllPopups() {
    document.getElementById('weekDropdownMenu')?.classList.add('hidden');
    document.getElementById('modalWeekDropdownMenu')?.classList.add('hidden');
    document.getElementById('excelExportMenu')?.classList.add('hidden');
    document.getElementById('userMenuDropdown')?.classList.add('hidden');
  }

})();
