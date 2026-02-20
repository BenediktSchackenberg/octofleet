#!/bin/bash
# ============================================================
# Octofleet PXE - Boot Script Generator
# ============================================================

SCRIPT_DIR="$(dirname "$0")"
ANSWERS_DIR="$SCRIPT_DIR/answers"

usage() {
    echo "Usage: $0 <MAC> <HOSTNAME> [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --image <path>      WIM image path (default: /srv/images/install.wim)"
    echo "  --index <num>       WIM image index (default: 1)"
    echo "  --lang <code>       Language (default: de-DE)"
    echo "  --timezone <tz>     Timezone (default: W. Europe Standard Time)"
    echo "  --admin-pass <pw>   Admin password (default: Octofleet123!)"
    echo ""
    echo "Example:"
    echo "  $0 00:15:5D:01:02:03 SQL-SERVER-01 --image /srv/images/win2025.wim"
    exit 1
}

# Defaults
MAC=""
HOSTNAME=""
WIM_IMAGE="/srv/images/install.wim"
WIM_INDEX="1"
LANGUAGE="de-DE"
TIMEZONE="W. Europe Standard Time"
ADMIN_PASS="Octofleet123!"
PXE_SERVER="${PXE_SERVER_IP:-192.168.0.5}"

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --image) WIM_IMAGE="$2"; shift 2 ;;
        --index) WIM_INDEX="$2"; shift 2 ;;
        --lang) LANGUAGE="$2"; shift 2 ;;
        --timezone) TIMEZONE="$2"; shift 2 ;;
        --admin-pass) ADMIN_PASS="$2"; shift 2 ;;
        -*)
            echo "Unknown option: $1"
            usage
            ;;
        *)
            if [ -z "$MAC" ]; then
                MAC="$1"
            elif [ -z "$HOSTNAME" ]; then
                HOSTNAME="$1"
            fi
            shift
            ;;
    esac
done

[ -z "$MAC" ] || [ -z "$HOSTNAME" ] && usage

# Normalize MAC
MAC=$(echo "$MAC" | tr '[:upper:]' '[:lower:]' | tr ':' '-')
MAC_FILE="$ANSWERS_DIR/$MAC.ipxe"

mkdir -p "$ANSWERS_DIR"

# Base64 encode password (für Autounattend)
ADMIN_PASS_B64=$(echo -n "${ADMIN_PASS}AdministratorPassword" | iconv -t UTF-16LE | base64 -w0)

echo "🔧 Generating boot config for $HOSTNAME ($MAC)..."

# Generate iPXE boot script
cat > "$MAC_FILE" << EOF
#!ipxe
# ============================================================
# Octofleet Boot Script for: $HOSTNAME
# MAC: $MAC
# Generated: $(date -Iseconds)
# ============================================================

echo
echo ===============================================
echo    🐙 Installing: $HOSTNAME
echo ===============================================
echo

set pxe-server http://${PXE_SERVER}:8888

echo Loading WinPE...
kernel \${pxe-server}/winpe/wimboot
initrd \${pxe-server}/winpe/BCD         BCD
initrd \${pxe-server}/winpe/boot.sdi    boot.sdi
initrd \${pxe-server}/winpe/boot.wim    boot.wim
initrd \${pxe-server}/answers/${MAC}.xml autounattend.xml
boot
EOF

echo "✅ iPXE script: $MAC_FILE"

# Generate Autounattend.xml
ANSWER_FILE="$ANSWERS_DIR/$MAC.xml"

cat > "$ANSWER_FILE" << 'XMLEOF'
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <SetupUILanguage>
        <UILanguage>LANGUAGE_PLACEHOLDER</UILanguage>
      </SetupUILanguage>
      <InputLocale>de-DE</InputLocale>
      <SystemLocale>LANGUAGE_PLACEHOLDER</SystemLocale>
      <UILanguage>LANGUAGE_PLACEHOLDER</UILanguage>
      <UserLocale>LANGUAGE_PLACEHOLDER</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add">
              <Order>1</Order>
              <Size>512</Size>
              <Type>EFI</Type>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>2</Order>
              <Size>128</Size>
              <Type>MSR</Type>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>3</Order>
              <Extend>true</Extend>
              <Type>Primary</Type>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>1</PartitionID>
              <Format>FAT32</Format>
              <Label>System</Label>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order>
              <PartitionID>3</PartitionID>
              <Format>NTFS</Format>
              <Label>Windows</Label>
              <Letter>C</Letter>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallTo>
            <DiskID>0</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
          <InstallFrom>
            <MetaData wcm:action="add">
              <Key>/IMAGE/INDEX</Key>
              <Value>WIM_INDEX_PLACEHOLDER</Value>
            </MetaData>
          </InstallFrom>
        </OSImage>
      </ImageInstall>
      <UserData>
        <AcceptEula>true</AcceptEula>
      </UserData>
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>HOSTNAME_PLACEHOLDER</ComputerName>
      <TimeZone>TIMEZONE_PLACEHOLDER</TimeZone>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
      </OOBE>
      <UserAccounts>
        <AdministratorPassword>
          <Value>ADMIN_PASS_PLACEHOLDER</Value>
          <PlainText>false</PlainText>
        </AdministratorPassword>
      </UserAccounts>
      <AutoLogon>
        <Password>
          <Value>ADMIN_PASS_PLACEHOLDER</Value>
          <PlainText>false</PlainText>
        </Password>
        <Enabled>true</Enabled>
        <LogonCount>1</LogonCount>
        <Username>Administrator</Username>
      </AutoLogon>
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <CommandLine>powershell.exe -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'http://PXE_SERVER_PLACEHOLDER:8888/scripts/Install-OctofleetAgent.ps1' -OutFile 'C:\Windows\Temp\Install-OctofleetAgent.ps1'; C:\Windows\Temp\Install-OctofleetAgent.ps1"</CommandLine>
          <Description>Install Octofleet Agent</Description>
        </SynchronousCommand>
      </FirstLogonCommands>
    </component>
  </settings>
</unattend>
XMLEOF

# Replace placeholders
sed -i "s/HOSTNAME_PLACEHOLDER/$HOSTNAME/g" "$ANSWER_FILE"
sed -i "s/LANGUAGE_PLACEHOLDER/$LANGUAGE/g" "$ANSWER_FILE"
sed -i "s/TIMEZONE_PLACEHOLDER/$TIMEZONE/g" "$ANSWER_FILE"
sed -i "s/WIM_INDEX_PLACEHOLDER/$WIM_INDEX/g" "$ANSWER_FILE"
sed -i "s/ADMIN_PASS_PLACEHOLDER/$ADMIN_PASS_B64/g" "$ANSWER_FILE"
sed -i "s/PXE_SERVER_PLACEHOLDER/$PXE_SERVER/g" "$ANSWER_FILE"

echo "✅ Autounattend.xml: $ANSWER_FILE"

# Register MAC for PXE
MAC_COLON=$(echo "$MAC" | tr '-' ':')
"$SCRIPT_DIR/pxe-mac.sh" add "$MAC_COLON" 2>/dev/null || true

echo ""
echo "🚀 Ready! Start the VM/Server with PXE boot."
echo "   MAC: $MAC_COLON"
echo "   Hostname: $HOSTNAME"
