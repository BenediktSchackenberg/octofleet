@echo off
REM Runs once after Windows installation. Network and domain settings are in the task's unattend.xml.
if exist "%~dp0octofleet-config.cmd" call "%~dp0octofleet-config.cmd"
echo Octofleet post-install configuration > C:\octofleet-setup.log
echo %date% %time% >> C:\octofleet-setup.log
REM DNS is applied by the task's answer file, which includes per-task overrides.
REM Domain join is configured per task; no credentials or domain names are bundled here.
echo Done. >> C:\octofleet-setup.log
