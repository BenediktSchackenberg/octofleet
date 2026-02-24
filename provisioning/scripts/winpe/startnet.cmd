@echo off
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
net use Z: \\192.168.0.5\install /user:guest ""

REM Copy Autounattend.xml
echo Copying answer file...
copy Z:\answers\%MAC%.xml X:\Autounattend.xml 2>nul
if not exist X:\Autounattend.xml copy Z:\answers\default.xml X:\Autounattend.xml

REM Run setup
echo Starting Windows Setup...
Z:\server2022\setup.exe /unattend:X:\Autounattend.xml

