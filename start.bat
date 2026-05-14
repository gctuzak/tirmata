@echo off
title Tirmata Restaurant POS
color 0A

cd /d "%~dp0"

echo Tirmata Restaurant POS - Windows Baslatici
echo ==========================================
echo.

echo [1/2] Sanal ortam hazirlaniyor...
if exist "venv\" goto skip_venv
echo Sanal ortam (venv) olusturuluyor...
python -m venv venv
:skip_venv

echo Sanal ortam aktif ediliyor...
call venv\Scripts\activate.bat

echo Gerekli Python kutuphaneleri yukleniyor...
pip install -r requirements.txt

echo.
echo [2/2] Sunucu baslatiliyor...
echo.
echo SISTEM HAZIR! 
echo.
echo Ana Bilgisayar Icin Link:
echo http://localhost:8000/ui/
echo.
echo Diger Cihazlar Icin:
echo http://[Bu_Bilgisayarin_IP_Adresi]:8000/ui/
echo ==========================================
echo.

python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
