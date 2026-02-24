@echo off
echo.
echo ============================================
echo   Octofleet Zero-Touch Windows Deployment
echo ============================================
echo.

wpeinit

echo Waiting for network...
:waitnet
ping -n 2 192.168.0.5 >nul 2>&1
if errorlevel 1 goto waitnet

echo Mapping network share...
net use Z: \\192.168.0.5\wininstall /user:guest ""

echo Starting Windows Setup...
Z:\server2022\setup.exe /unattend:Z:\answers\default.xml

