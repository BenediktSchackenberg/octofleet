@echo off
cls
echo ========================================================
echo       OCTOFLEET ZERO-TOUCH DEPLOYMENT
echo       Image: Windows Server 2025 Standard (Desktop)
echo ========================================================

echo [1/8] Initializing network...
wpeinit
wpeutil initializenetwork

:WAITNET
ping -n 2 192.168.0.5 >nul 2>&1
if not %errorlevel%==0 goto WAITNET
echo      Network OK!

echo [2/8] Partitioning disk...
diskpart /s X:\Windows\System32\deploypart.txt

echo [3/8] Downloading Windows image...
X:\Windows\System32\curl.exe -# -o W:\install.wim http://192.168.0.5:9080/images/win2025/install.wim

echo [4/8] Applying Windows image (Index 2 = Desktop)...
dism.exe /apply-image /imagefile:W:\install.wim /index:2 /applydir:W:\

echo [5/8] Deleting temp file...
del W:\install.wim

echo [6/8] Downloading unattend.xml...
mkdir W:\Windows\Panther
X:\Windows\System32\curl.exe -s -o W:\Windows\Panther\unattend.xml http://192.168.0.5:9080/answers/unattend.xml

echo [7/8] Downloading post-install script...
mkdir W:\Windows\Setup\Scripts
X:\Windows\System32\curl.exe -s -o W:\Windows\Setup\Scripts\SetupComplete.cmd http://192.168.0.5:9080/scripts/SetupComplete.cmd

echo [8/8] Configuring boot loader...
bcdboot.exe W:\Windows /s S: /f UEFI

echo ========================================================
echo      SUCCESS! Rebooting in 10 seconds...
echo ========================================================
ping -n 11 127.0.0.1 >nul
wpeutil reboot
