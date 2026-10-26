# -*- coding: utf-8 -*-
"""
================================================================================
LABMASTER 2026-2027: CÔNG CỤ TỰ ĐỘNG GỬI TIN NHẮN ZALO CHO LỚP TRƯỞNG
================================================================================
Chức năng:
1. Đọc danh sách lớp thực hành (SĐT, tên lớp, tên lớp trưởng, nội dung thông báo)
2. Tự động tìm kiếm số điện thoại trên Zalo (Zalo Web hoặc Zalo PC)
3. Tự động điền nội dung thông báo chuẩn và bấm Gửi
================================================================================
"""

import os
import sys
import time
import json
import traceback

# Cấu hình UTF-8 cho Windows Console để không bị lỗi font tiếng Việt
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import pyperclip
except ImportError:
    pyperclip = None

try:
    import pyautogui
except ImportError:
    pyautogui = None


def print_banner():
    print("=" * 70)
    print("      LABMASTER - CÔNG CỤ TỰ ĐỘNG GỬI TIN NHẮN ZALO CHO LỚP TRƯỞNG")
    print("=" * 70)


def load_recipients():
    """Đọc dữ liệu người nhận từ zalo_dispatch.json hoặc fallback sang data.js"""
    json_path = os.path.join(os.path.dirname(__file__), "zalo_dispatch.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    print(f"[*] Đã nạp thành công {len(data)} lớp từ file 'zalo_dispatch.json'.")
                    return data
        except Exception as e:
            print(f"[!] Lỗi đọc file zalo_dispatch.json: {e}")

    # Nếu chưa có file zalo_dispatch.json, kiểm tra clipboard
    if pyperclip:
        try:
            clip = pyperclip.paste().strip()
            if clip.startswith("[") and clip.endswith("]"):
                data = json.loads(clip)
                if isinstance(data, list) and len(data) > 0:
                    print(f"[*] Đã nhận diện {len(data)} lớp từ bộ nhớ tạm (Clipboard)!")
                    return data
        except Exception:
            pass

    # Dữ liệu mặc định để người dùng có thể chạy thử ngay
    print("[*] Chưa tìm thấy file 'zalo_dispatch.json'. Sử dụng danh sách mẫu để chạy thử nghiệm.")
    print("    (Mẹo: Bạn có thể vào Web -> Thẻ Quản Trị -> 'Tải Dữ Liệu Gửi Zalo' để lấy danh sách thật)")
    sample = [
        {
            "className": "10A1",
            "monitorName": "Nguyễn Văn An",
            "monitorPhone": "0383102552",
            "message": "Ngày mai lớp thực hành Tiết 1, 2 (Sáng: 07:00 - 08:35) tại phòng Phòng Máy 1 vị trí Tầng 2 - Dãy nhà B."
        }
    ]
    return sample


# ==============================================================================
# CHẾ ĐỘ 1: TỰ ĐỘNG QUA ZALO WEB (SELENIUM CHROME)
# ==============================================================================
def send_via_zalo_web(recipients):
    print("\n--- BẮT ĐẦU CHẾ ĐỘ 1: TỰ ĐỘNG QUA ZALO WEB (CHROME) ---")
    try:
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
    except ImportError:
        print("[!] Chưa cài đặt selenium. Vui lòng cài: pip install selenium")
        return

    # Đường dẫn lưu session để không cần quét mã QR nhiều lần
    profile_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "chrome_zalo_profile"))
    os.makedirs(profile_dir, exist_ok=True)

    opts = Options()
    opts.add_argument(f"--user-data-dir={profile_dir}")
    opts.add_argument("--disable-notifications")
    opts.add_argument("--start-maximized")

    print("[*] Đang khởi động trình duyệt Chrome...")
    try:
        driver = webdriver.Chrome(options=opts)
    except Exception as e:
        print(f"[!] Không thể mở Chrome: {e}")
        print("    Vui lòng đóng tất cả các cửa sổ Chrome đang mở rồi thử lại!")
        return

    try:
        driver.get("https://chat.zalo.me")
        print("\n[*] Đang mở Zalo Web (https://chat.zalo.me)...")
        print("[!] HƯỚNG DẪN: Nếu chưa đăng nhập, vui lòng dùng điện thoại QUÉT MÃ QR để đăng nhập vào Zalo.")
        print("[*] Hệ thống sẽ tự động chờ đến khi bạn đăng nhập thành công...")

        # Chờ ô tìm kiếm xuất hiện (chứng tỏ đã đăng nhập thành công)
        search_box = None
        for _ in range(60):
            try:
                # Các selector tìm kiếm trên Zalo Web
                candidates = driver.find_elements(By.CSS_SELECTOR, "#contact-search-input, input[placeholder*='Tìm kiếm'], input[data-id='contact-search-input']")
                for c in candidates:
                    if c.is_displayed():
                        search_box = c
                        break
                if search_box:
                    break
            except Exception:
                pass
            time.sleep(2)

        if not search_box:
            print("[!] Quá thời gian chờ đăng nhập (2 phút). Vui lòng thử lại sau!")
            return

        print("\n[V] ĐĂNG NHẬP ZALO THÀNH CÔNG! Bắt đầu tiến trình gửi tin nhắn...")
        time.sleep(2)

        total = len(recipients)
        success_count = 0

        for idx, item in enumerate(recipients, 1):
            phone = str(item.get("monitorPhone", "")).strip()
            name = item.get("monitorName", "Lớp trưởng")
            cname = item.get("className", "")
            msg = item.get("message", "")

            if not phone or len(phone) < 9:
                print(f"\n[{idx}/{total}] Bỏ qua lớp {cname}: Số điện thoại không hợp lệ ('{phone}').")
                continue

            print(f"\n[{idx}/{total}] Đang xử lý: Lớp {cname} - Lớp trưởng: {name} (SĐT: {phone})...")

            try:
                # 1. Tìm và xóa nội dung cũ trong ô tìm kiếm
                search_box = driver.find_element(By.CSS_SELECTOR, "#contact-search-input, input[placeholder*='Tìm kiếm']")
                search_box.click()
                time.sleep(0.5)
                search_box.send_keys(Keys.CONTROL + "a")
                search_box.send_keys(Keys.BACKSPACE)
                time.sleep(0.3)

                # 2. Nhập số điện thoại
                search_box.send_keys(phone)
                time.sleep(1.5)  # Chờ Zalo tìm kiếm

                # 3. Chọn kết quả tìm kiếm đầu tiên
                # Thử nhấn phím Enter hoặc phím Down + Enter
                search_box.send_keys(Keys.ARROW_DOWN)
                time.sleep(0.5)
                search_box.send_keys(Keys.ENTER)
                time.sleep(1.5)

                # 4. Tìm ô nhập tin nhắn
                msg_inputs = driver.find_elements(By.CSS_SELECTOR, "#richInput, div[contenteditable='true'], div[data-slate-editor='true']")
                msg_box = None
                for mi in msg_inputs:
                    if mi.is_displayed():
                        msg_box = mi
                        break

                if not msg_box:
                    # Thử lại click vào giữa vùng chat
                    print(f"    [?] Đang định vị ô nhập chat...")
                    time.sleep(1)
                    msg_inputs = driver.find_elements(By.CSS_SELECTOR, "#richInput, div[contenteditable='true']")
                    if msg_inputs:
                        msg_box = msg_inputs[0]

                if msg_box:
                    msg_box.click()
                    time.sleep(0.5)

                    # Dùng Clipboard để paste tiếng Việt chuẩn không bị lỗi gõ Telex
                    if pyperclip:
                        pyperclip.copy(msg)
                        msg_box.send_keys(Keys.CONTROL + "v")
                    else:
                        msg_box.send_keys(msg)

                    time.sleep(0.5)
                    # Gửi tin nhắn bằng phím Enter
                    msg_box.send_keys(Keys.ENTER)
                    time.sleep(1)

                    print(f"    [V] THÀNH CÔNG: Đã gửi thông báo đến Lớp {cname} (SĐT: {phone})!")
                    success_count += 1
                else:
                    print(f"    [X] Không tìm thấy người dùng hoặc ô nhập tin nhắn cho SĐT: {phone}")

            except Exception as ex:
                print(f"    [X] Lỗi khi gửi cho {cname} ({phone}): {ex}")

            # Nghỉ 2 giây giữa các lần gửi để tránh spam
            time.sleep(2)

        print("\n" + "=" * 50)
        print(f"HOÀN TẤT: Đã gửi thành công {success_count}/{total} lớp qua Zalo Web!")
        print("=" * 50)

    finally:
        input("\nBấm Enter để đóng trình duyệt...")
        driver.quit()


# ==============================================================================
# CHẾ ĐỘ 2: TỰ ĐỘNG QUA PHẦN MỀM ZALO PC
# ==============================================================================
def send_via_zalo_pc(recipients):
    print("\n--- BẮT ĐẦU CHẾ ĐỘ 2: TỰ ĐỘNG QUA ZALO PC (PHẦN MỀM CÀI TRÊN MÁY) ---")
    if not pyautogui or not pyperclip:
        print("[!] Chế độ này cần thư viện pyautogui và pyperclip.")
        print("    Vui lòng chạy lệnh: pip install pyautogui pyperclip")
        return

    print("\n[!] HƯỚNG DẪN QUAN TRỌNG:")
    print("1. Hãy mở sẵn phần mềm ZALO trên máy tính và đăng nhập sẵn.")
    print("2. Khi bấm bắt đầu, hệ thống sẽ đếm ngược 5 giây.")
    print("3. Trong 5 giây đó, bạn chỉ cần bấm chuột vào cửa sổ ZALO để kích hoạt.")
    print("4. Máy tính sẽ tự động: Tìm SĐT -> Mở chat -> Dán tin nhắn -> Bấm Enter gửi!")

    choice = input("\nBạn đã sẵn sàng chưa? (Bấm Enter để bắt đầu, nhập 'q' để hủy): ")
    if choice.strip().lower() == 'q':
        return

    for s in range(5, 0, -1):
        print(f"[*] Bắt đầu sau {s} giây... (HÃY CLICK VÀO CỬA SỔ ZALO NGAY BÂY GIỜ!)")
        time.sleep(1)

    print("\n[*] Đang thực hiện gửi tự động...")
    total = len(recipients)
    success_count = 0

    for idx, item in enumerate(recipients, 1):
        phone = str(item.get("monitorPhone", "")).strip()
        name = item.get("monitorName", "Lớp trưởng")
        cname = item.get("className", "")
        msg = item.get("message", "")

        if not phone or len(phone) < 9:
            print(f"[{idx}/{total}] Bỏ qua lớp {cname} (SĐT không hợp lệ).")
            continue

        print(f"[{idx}/{total}] Đang gửi: Lớp {cname} - {name} ({phone})...")

        try:
            # 1. Phím tắt tìm kiếm trong Zalo PC: Ctrl + F
            pyautogui.hotkey('ctrl', 'f')
            time.sleep(0.5)

            # 2. Xóa tìm kiếm cũ
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            time.sleep(0.3)

            # 3. Dán số điện thoại
            pyperclip.copy(phone)
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(1.2)  # Đợi Zalo hiển thị kết quả tìm kiếm

            # 4. Nhấn Enter để chọn người nhận
            pyautogui.press('enter')
            time.sleep(1.0)

            # 5. Dán nội dung tin nhắn tiếng Việt
            pyperclip.copy(msg)
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(0.5)

            # 6. Nhấn Enter để gửi
            pyautogui.press('enter')
            time.sleep(1.5)

            print(f"    [V] Đã gửi xong cho {cname}!")
            success_count += 1

        except Exception as e:
            print(f"    [X] Lỗi gửi cho {cname}: {e}")

        # Nghỉ 2.5 giây giữa các lượt gửi
        time.sleep(2.5)

    print("\n" + "=" * 50)
    print(f"HOÀN TẤT: Đã tự động gửi {success_count}/{total} tin nhắn trên Zalo PC!")
    print("=" * 50)


# ==============================================================================
# HÀM CHÍNH (MAIN MENU)
# ==============================================================================
def main():
    print_banner()
    recipients = load_recipients()

    print("\nDANH SÁCH LỚP SẼ GỬI TIN NHẮN:")
    for i, r in enumerate(recipients, 1):
        print(f"  {i}. Lớp {r.get('className')} - LT: {r.get('monitorName')} (SĐT: {r.get('monitorPhone')})")

    print("\nCHỌN HÌNH THỨC TỰ ĐỘNG GỬI:")
    print("  1. Tự động qua ZALO WEB (Dùng trình duyệt Chrome - Khuyên dùng)")
    print("  2. Tự động qua ZALO PC (Phần mềm Zalo cài sẵn trên máy)")
    print("  0. Thoát")

    try:
        opt = input("\nNhập lựa chọn của bạn (1 hoặc 2) [Mặc định: 1]: ").strip()
        if not opt:
            opt = "1"

        if opt == "1":
            send_via_zalo_web(recipients)
        elif opt == "2":
            send_via_zalo_pc(recipients)
        else:
            print("[*] Đã thoát chương trình.")
    except KeyboardInterrupt:
        print("\n[*] Đã hủy thao tác.")


if __name__ == "__main__":
    main()
