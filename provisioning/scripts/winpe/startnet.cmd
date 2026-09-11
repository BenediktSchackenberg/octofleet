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

REM Initialize network
wpeinit

REM Wait for network
echo Waiting for network...
ping -n 5 127.0.0.1 > nul

REM Map network share with install files
echo Mapping installation source...
net use Z: "%SMB_INSTALL_SHARE%" /user:guest ""

REM Copy Autounattend.xml
echo Copying answer file...
copy Z:\answers\%MAC%.xml X:\Autounattend.xml 2>nul
if not exist X:\Autounattend.xml copy Z:\answers\default.xml X:\Autounattend.xml

REM Run setup
echo Starting Windows Setup...
Z:\server2022\setup.exe /unattend:X:\Autounattend.xml

