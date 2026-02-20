@echo off
setlocal enabledelayedexpansion
echo ========================================================
echo       OCTOFLEET ZERO-TOUCH DEPLOYMENT
echo ========================================================

echo [1/9] Loading VirtIO drivers...
drvload X:\Windows\System32\drivers\vioscsi.inf
if errorlevel 1 (
    echo ERROR: Failed to load vioscsi driver!
    goto :error
)
drvload X:\Windows\System32\drivers\netkvm.inf
if errorlevel 1 (
    echo ERROR: Failed to load netkvm driver!
    goto :error
)
echo Drivers loaded OK

echo [2/9] Initializing WinPE...
wpeinit

echo [3/9] Initializing network...
wpeutil initializenetwork

echo [4/9] Waiting for IP address (max 60s)...
set /a count=0
:wait_ip
ping -n 2 127.0.0.1 >nul
ipconfig | find "192.168" >nul
if not errorlevel 1 goto ip_ok
set /a count+=1
if !count! gtr 30 (
    echo ERROR: No IP address after 60 seconds!
    ipconfig
    goto :error
)
goto wait_ip
:ip_ok
echo IP acquired:
ipconfig | find "IPv4"

echo [5/9] Starting SMB services...
net start lanmanworkstation

echo [6/9] Mounting SMB share (max 5 retries)...
set /a retry=0
:smb_retry
net use Z: \\192.168.0.5\images 2>nul
if not errorlevel 1 goto smb_ok
set /a retry+=1
echo SMB retry !retry!/5...
if !retry! gtr 5 (
    echo ERROR: SMB mount failed after 5 retries!
    goto :error
)
ping -n 10 127.0.0.1 >nul
goto smb_retry
:smb_ok
echo SMB mounted OK
dir Z:\

echo [7/9] Checking disk...
echo list disk > X:\dp.txt
diskpart /s X:\dp.txt
echo.
echo select disk 0 > X:\dp.txt
echo clean >> X:\dp.txt
echo convert gpt >> X:\dp.txt
echo create partition efi size=100 >> X:\dp.txt
echo format fs=fat32 quick label=System >> X:\dp.txt
echo assign letter=S >> X:\dp.txt
echo create partition msr size=16 >> X:\dp.txt
echo create partition primary >> X:\dp.txt
echo format fs=ntfs quick label=Windows >> X:\dp.txt
echo assign letter=W >> X:\dp.txt
echo list volume >> X:\dp.txt
echo exit >> X:\dp.txt
diskpart /s X:\dp.txt
if errorlevel 1 (
    echo ERROR: Diskpart failed!
    goto :error
)
echo Disk partitioned OK

echo [8/9] Applying Windows image (5-10 min)...
dism /apply-image /imagefile:Z:\win2025\install.wim /index:4 /applydir:W:\
if errorlevel 1 (
    echo ERROR: DISM apply failed!
    goto :error
)
echo Image applied OK

echo [8b/9] Injecting VirtIO drivers into installed Windows...
dism /image:W:\ /add-driver /driver:X:\Windows\System32\drivers\vioscsi.inf
dism /image:W:\ /add-driver /driver:X:\Windows\System32\drivers\netkvm.inf
echo Drivers injected OK

echo [9/9] Configuring bootloader...
bcdboot W:\Windows /s S: /f UEFI
if errorlevel 1 (
    echo ERROR: bcdboot failed!
    goto :error
)

echo ========================================================
echo       SUCCESS - REBOOTING IN 10 SECONDS
echo ========================================================
ping -n 10 127.0.0.1 >nul
wpeutil reboot
goto :eof

:error
echo ========================================================
echo       INSTALLATION FAILED - CHECK ERRORS ABOVE
echo ========================================================
echo Press any key to open command prompt for debugging...
pause
cmd /k
