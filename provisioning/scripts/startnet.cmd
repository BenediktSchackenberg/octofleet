@echo off
REM Load the export from Settings > Provisioning.
if exist "%~dp0octofleet-config.cmd" call "%~dp0octofleet-config.cmd"
if exist "X:\Windows\System32\octofleet-config.cmd" call "X:\Windows\System32\octofleet-config.cmd"
if not defined PXE_SERVER_URL (echo Missing PXE_SERVER_URL. Embed octofleet-config.cmd in WinPE. & exit /b 1)
cls
echo ========================================================
echo       OCTOFLEET ZERO-TOUCH DEPLOYMENT
echo       Image: Windows Server 2025 Standard (Desktop)
echo ========================================================

echo [1/8] Initializing network...
wpeinit
wpeutil initializenetwork

:WAITNET
X:\Windows\System32\curl.exe -fsS --connect-timeout 5 "%PXE_SERVER_URL%/health" >nul 2>&1
if not %errorlevel%==0 goto WAITNET
echo      Network OK!

echo [2/8] Partitioning disk...
diskpart /s X:\Windows\System32\deploypart.txt

echo [3/8] Downloading Windows image...
X:\Windows\System32\curl.exe -# -o W:\install.wim %PXE_SERVER_URL%/images/win2025/install.wim

echo [4/8] Applying Windows image (Index 2 = Desktop)...
dism.exe /apply-image /imagefile:W:\install.wim /index:2 /applydir:W:\

echo [5/8] Deleting temp file...
del W:\install.wim

echo [6/8] Downloading unattend.xml...
mkdir W:\Windows\Panther
X:\Windows\System32\curl.exe -s -o W:\Windows\Panther\unattend.xml %PXE_SERVER_URL%/answers/unattend.xml

echo [7/8] Downloading post-install script...
mkdir W:\Windows\Setup\Scripts
if exist "X:\Windows\System32\octofleet-config.cmd" copy "X:\Windows\System32\octofleet-config.cmd" "W:\Windows\Setup\Scripts\octofleet-config.cmd"
if exist "%~dp0octofleet-config.cmd" copy "%~dp0octofleet-config.cmd" "W:\Windows\Setup\Scripts\octofleet-config.cmd"
X:\Windows\System32\curl.exe -s -o W:\Windows\Setup\Scripts\SetupComplete.cmd %PXE_SERVER_URL%/scripts/SetupComplete.cmd

echo [8/8] Configuring boot loader...
bcdboot.exe W:\Windows /s S: /f UEFI

echo ========================================================
echo      SUCCESS! Rebooting in 10 seconds...
echo ========================================================
ping -n 11 127.0.0.1 >nul
wpeutil reboot
