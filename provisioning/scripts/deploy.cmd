@echo off
cls
echo.
echo  ===============================================
echo       Octofleet Zero-Touch Deployment
echo       Host: TEST-VM-01
echo  ===============================================
echo.

set SMBSERVER=192.168.0.5
set SMBSHARE=images

echo  [1/6] Netzwerk initialisieren...
wpeinit
ping -n 5 %SMBSERVER% >nul 2>&1

echo  [2/6] SMB Share mounten...
net use Z: \\%SMBSERVER%\%SMBSHARE% /user:guest ""
if errorlevel 1 (
    echo        Retry ohne Credentials...
    net use Z: \\%SMBSERVER%\%SMBSHARE%
)

if not exist Z:\win2025\install.wim (
    echo  FEHLER: install.wim nicht gefunden!
    echo  Pruefe: \\%SMBSERVER%\%SMBSHARE%\win2025\install.wim
    pause
    exit /b 1
)

echo  [3/6] Disk partitionieren (UEFI GPT)...
diskpart /s X:\diskpart.txt

echo  [4/6] Windows Image anwenden...
echo        Quelle: Z:\win2025\install.wim
echo        Ziel: W:\
echo        Das dauert ca. 5-10 Minuten...
echo.
dism /apply-image /imagefile:Z:\win2025\install.wim /index:4 /applydir:W:\

if errorlevel 1 (
    echo  FEHLER bei DISM!
    pause
    exit /b 1
)

echo  [5/6] Bootloader konfigurieren...
bcdboot W:\Windows /s S: /f UEFI

echo  [6/6] Unattend.xml kopieren...
mkdir W:\Windows\Panther 2>nul
copy X:\Autounattend.xml W:\Windows\Panther\unattend.xml >nul

echo.
echo  ===============================================
echo       Installation abgeschlossen!
echo       System startet in 10 Sekunden neu...
echo  ===============================================
echo.

net use Z: /delete /y 2>nul
wpeutil shutdown
