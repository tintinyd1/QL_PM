@echo off
title LabMaster - Tu Dong Gui Tin Nhan Zalo Cho Lop Truong
chcp 65001 >nul
cd /d "%~dp0"
echo ======================================================================
echo    LABMASTER: DANG KHOI DONG CONG CU TU DONG GUI ZALO...
echo ======================================================================
python tu_dong_gui_zalo.py
pause
