@echo off
REM Load the export from Settings > Provisioning.
if exist "%~dp0octofleet-config.cmd" call "%~dp0octofleet-config.cmd"
if exist "X:\Windows\System32\octofleet-config.cmd" call "X:\Windows\System32\octofleet-config.cmd"
if not defined SMB_INSTALL_SHARE (echo Missing SMB_INSTALL_SHARE in octofleet-config.cmd. & exit /b 1)
echo.
echo ============================================
echo   Octofleet Zero-Touch Windows Deployment
echo ============================================
echo.

wpeinit

echo Waiting for network...
ping -n 5 127.0.0.1 >nul

echo Mapping network share...
net use Z: "%SMB_INSTALL_SHARE%" /user:guest ""

echo Starting Windows Setup...
Z:\server2022\setup.exe /unattend:Z:\answers\default.xml

