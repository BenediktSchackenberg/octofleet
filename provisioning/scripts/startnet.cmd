@echo off
wpeinit
echo.
echo ===============================================
echo    Octofleet Zero-Touch Deployment
echo ===============================================
echo.

set SMBSERVER=192.168.0.5
set SMBSHARE=images

echo [1/6] Netzwerk wird konfiguriert...
ping -n 3 %SMBSERVER% >nul 2>&1

echo [2/6] SMB Share mounten...
net use Z: \\%SMBSERVER%\%SMBSHARE% /user:guest "" 2>nul
if errorlevel 1 net use Z: \\%SMBSERVER%\%SMBSHARE%

echo [3/6] Disk partitionieren (UEFI GPT)...
diskpart /s X:\diskpart.txt

echo [4/6] Windows Image anwenden...
echo      Das dauert ca. 5-10 Minuten...
dism /apply-image /imagefile:Z:\win2025\install.wim /index:4 /applydir:W:\

echo [5/6] Bootloader konfigurieren...
bcdboot W:\Windows /s S: /f UEFI

echo [6/6] Unattend kopieren...
mkdir W:\Windows\Panther 2>nul
copy X:\Autounattend.xml W:\Windows\Panther\unattend.xml >nul

echo.
echo ===============================================
echo    Fertig! Neustart in 5 Sekunden...
echo ===============================================

net use Z: /delete /y 2>nul
wpeutil reboot
