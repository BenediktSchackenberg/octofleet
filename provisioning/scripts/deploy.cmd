@echo off
REM Load the export from Settings > Provisioning.
if exist "%~dp0octofleet-config.cmd" call "%~dp0octofleet-config.cmd"
if exist "X:\Windows\System32\octofleet-config.cmd" call "X:\Windows\System32\octofleet-config.cmd"
cls
echo.
echo  ===============================================
echo       Octofleet Zero-Touch Deployment
echo       Host: TEST-VM-01
echo  ===============================================
echo.

if not defined SMB_IMAGES_SHARE (echo Missing SMB_IMAGES_SHARE in octofleet-config.cmd. & exit /b 1)

echo  [1/6] Netzwerk initialisieren...
wpeinit
ping -n 5 127.0.0.1 >nul 2>&1

echo  [2/6] SMB Share mounten...
net use Z: "%SMB_IMAGES_SHARE%" /user:guest ""
if errorlevel 1 (
    echo        Retry ohne Credentials...
    net use Z: "%SMB_IMAGES_SHARE%"
)

if not exist Z:\win2025\install.wim (
    echo  FEHLER: install.wim nicht gefunden!
    echo  Pruefe: %SMB_IMAGES_SHARE%\win2025\install.wim
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
