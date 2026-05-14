@echo off
setlocal
title Tirmata POS - Python Kurulum
color 0B

cd /d "%~dp0"

echo =====================================================
echo Tirmata POS - Python Kurulum Araci
echo =====================================================
echo.

net session >nul 2>&1
if errorlevel 1 (
    echo HATA: Bu dosya yonetici izniyle calistirilmalidir.
    echo.
    echo Cozum:
    echo 1. Bu pencereyi kapatin.
    echo 2. install_prerequisites.bat dosyasina sag tiklayin.
    echo 3. "Yonetici olarak calistir" secenegini secin.
    echo.
    goto end
)

python --version >nul 2>&1
if not errorlevel 1 (
    echo [OK] Python zaten yuklu.
    echo.
    goto success
)

where curl >nul 2>&1
if errorlevel 1 (
    echo HATA: Windows bu bilgisayarda curl komutunu bulamadi.
    echo.
    echo Cozum:
    echo Python 3.11'i manuel kurun:
    echo https://www.python.org/downloads/release/python-3118/
    echo.
    echo Kurarken "Add python.exe to PATH" secenegini isaretleyin.
    echo Sonra start.bat dosyasini calistirin.
    echo.
    goto end
)

echo [1/2] Python 3.11 indiriliyor...
curl -L --fail -o python_installer.exe "https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe"
if errorlevel 1 (
    echo.
    echo HATA: Python indirilemedi.
    echo Internet baglantisini, antivirusu veya ag kisitlamalarini kontrol edin.
    echo.
    goto end
)

if not exist python_installer.exe (
    echo.
    echo HATA: python_installer.exe olusmadi.
    echo Indirme basarisiz olmus olabilir.
    echo.
    goto end
)

echo.
echo [2/2] Python sessizce kuruluyor...
start /wait python_installer.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 Include_doc=0
if errorlevel 1 (
    echo.
    echo HATA: Python kurulumu basarisiz oldu.
    echo Kurulum dosyasini manuel calistirmayi deneyin: python_installer.exe
    echo.
    goto end
)

del python_installer.exe >nul 2>&1

:success
echo =====================================================
echo KURULUM BASARIYLA TAMAMLANDI
echo =====================================================
echo.
echo Simdi bu pencereyi kapatin.
echo Ardindan start.bat dosyasini calistirin.
echo.

:end
echo =====================================================
pause
endlocal
