@echo off
REM SetupComplete.cmd - Runs once after Windows installation
REM Location: W:\Windows\Setup\Scripts\SetupComplete.cmd

echo Octofleet Post-Install Configuration > C:\octofleet-setup.log
echo %date% %time% >> C:\octofleet-setup.log

REM Set DNS to 192.168.0.8
echo Setting DNS server... >> C:\octofleet-setup.log
netsh interface ip set dns "Ethernet" static 192.168.0.8 primary
netsh interface ip add dns "Ethernet" 8.8.8.8 index=2

REM Wait for network
ping -n 5 192.168.0.8 >nul

REM Join Domain
echo Joining domain home.lab... >> C:\octofleet-setup.log
powershell -Command "Add-Computer -DomainName 'home.lab' -Credential (New-Object PSCredential('home.lab\Administrator', (ConvertTo-SecureString '05Mainz05' -AsPlainText -Force))) -Restart -Force" >> C:\octofleet-setup.log 2>&1

echo Done. >> C:\octofleet-setup.log
