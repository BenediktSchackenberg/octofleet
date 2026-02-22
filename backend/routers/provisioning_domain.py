"""
Domain Join Module for Octofleet Provisioning
Supports offline (djoin) and online domain join methods
"""

from typing import Optional
import base64

# PowerShell script to generate offline domain join blob
DJOIN_GENERATE_SCRIPT = '''
param(
    [string]$Hostname,
    [string]$Domain,
    [string]$OU
)

$ErrorActionPreference = "Stop"

# Check if we're on a domain controller or domain member
$computerSystem = Get-WmiObject Win32_ComputerSystem
if (-not $computerSystem.PartOfDomain) {{
    throw "This machine is not part of a domain. Cannot generate djoin blob."
}}

# Generate the blob
$blobFile = "$env:TEMP\\$Hostname-djoin.txt"

$djoinArgs = @(
    "/provision",
    "/domain", $Domain,
    "/machine", $Hostname,
    "/savefile", $blobFile
)

if ($OU) {{
    $djoinArgs += "/machineou"
    $djoinArgs += $OU
}}

Write-Host "Running: djoin.exe $($djoinArgs -join ' ')"
$result = & djoin.exe @djoinArgs 2>&1

if ($LASTEXITCODE -ne 0) {{
    throw "djoin.exe failed: $result"
}}

# Read and encode the blob
$blob = Get-Content $blobFile -Raw
$blobBase64 = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($blob))

# Cleanup
Remove-Item $blobFile -Force

# Return result
@{{
    success = $true
    hostname = $Hostname
    domain = $Domain
    ou = $OU
    blob = $blobBase64
    blobLength = $blob.Length
}} | ConvertTo-Json -Compress
'''

def generate_djoin_script(hostname: str, domain: str, ou: Optional[str] = None) -> str:
    """Generate PowerShell script to create offline domain join blob"""
    return DJOIN_GENERATE_SCRIPT.format(
        hostname=hostname,
        domain=domain,
        ou=ou or ""
    )


def generate_autounattend_domain_section(
    method: str,  # "offline" or "online"
    domain: str,
    ou: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    djoin_blob: Optional[str] = None
) -> str:
    """
    Generate the domain join section for Autounattend.xml
    """
    
    if method == "offline" and djoin_blob:
        # Offline domain join - no credentials in XML!
        return f'''
    <component name="Microsoft-Windows-UnattendedJoin" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <Identification>
        <Provisioning>
          <AccountData>{djoin_blob}</AccountData>
        </Provisioning>
      </Identification>
    </component>'''
    
    elif method == "online" and username and password:
        # Online domain join - credentials in XML (less secure)
        password_base64 = base64.b64encode(
            (password + "AdministratorPassword").encode('utf-16-le')
        ).decode()
        
        return f'''
    <component name="Microsoft-Windows-UnattendedJoin" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <Identification>
        <Credentials>
          <Domain>{domain}</Domain>
          <Username>{username}</Username>
          <Password>{password_base64}</Password>
        </Credentials>
        <JoinDomain>{domain}</JoinDomain>
        {f'<MachineObjectOU>{ou}</MachineObjectOU>' if ou else ''}
      </Identification>
    </component>'''
    
    else:
        # No domain join
        return ""


# Full Autounattend.xml template with domain join support
AUTOUNATTEND_TEMPLATE = '''<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">

  <!-- WinPE Pass -->
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <SetupUILanguage>
        <UILanguage>{language}</UILanguage>
      </SetupUILanguage>
      <InputLocale>{input_locale}</InputLocale>
      <SystemLocale>{system_locale}</SystemLocale>
      <UILanguage>{language}</UILanguage>
      <UserLocale>{user_locale}</UserLocale>
    </component>
    
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <UserData>
        <ProductKey>
          <Key>{product_key}</Key>
        </ProductKey>
        <AcceptEula>true</AcceptEula>
      </UserData>
    </component>
  </settings>

  <!-- Specialize Pass -->
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <ComputerName>{hostname}</ComputerName>
      <TimeZone>{timezone}</TimeZone>
    </component>
    
{domain_join_section}

    <component name="Microsoft-Windows-TerminalServices-LocalSessionManager" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <fDenyTSConnections>false</fDenyTSConnections>
    </component>
    
    <component name="Networking-MPSSVC-Svc" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <FirewallGroups>
        <FirewallGroup wcm:action="add" wcm:keyValue="RemoteDesktop">
          <Active>true</Active>
          <Group>Remote Desktop</Group>
          <Profile>all</Profile>
        </FirewallGroup>
      </FirewallGroups>
    </component>
  </settings>

  <!-- OOBE Pass -->
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
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
          <Value>{admin_password_encoded}</Value>
          <PlainText>false</PlainText>
        </AdministratorPassword>
      </UserAccounts>
      
      <FirstLogonCommands>
        <SynchronousCommand wcm:action="add">
          <Order>1</Order>
          <CommandLine>cmd /c echo Octofleet Deployment Complete > C:\\octofleet-deployed.txt</CommandLine>
          <Description>Mark deployment complete</Description>
        </SynchronousCommand>
{first_logon_commands}
      </FirstLogonCommands>
      
      <AutoLogon>
        <Enabled>true</Enabled>
        <LogonCount>1</LogonCount>
        <Username>Administrator</Username>
        <Password>
          <Value>{admin_password_encoded}</Value>
          <PlainText>false</PlainText>
        </Password>
      </AutoLogon>
    </component>
  </settings>

</unattend>
'''


def generate_autounattend(
    hostname: str,
    admin_password: str,
    language: str = "de-DE",
    timezone: str = "W. Europe Standard Time",
    product_key: str = "",
    domain_join_method: Optional[str] = None,
    domain_name: Optional[str] = None,
    domain_ou: Optional[str] = None,
    domain_user: Optional[str] = None,
    domain_password: Optional[str] = None,
    djoin_blob: Optional[str] = None,
    install_agent: bool = True,
    agent_api_url: str = "http://192.168.0.5:8080",
    custom_scripts: list = None
) -> str:
    """
    Generate a complete Autounattend.xml for Windows deployment
    """
    
    # Encode admin password for XML
    admin_password_encoded = base64.b64encode(
        (admin_password + "AdministratorPassword").encode('utf-16-le')
    ).decode()
    
    # Generate domain join section
    domain_join_section = ""
    if domain_join_method and domain_name:
        domain_join_section = generate_autounattend_domain_section(
            method=domain_join_method,
            domain=domain_name,
            ou=domain_ou,
            username=domain_user,
            password=domain_password,
            djoin_blob=djoin_blob
        )
    
    # Generate first logon commands
    first_logon_commands = ""
    command_order = 2
    
    if install_agent:
        first_logon_commands += f'''
        <SynchronousCommand wcm:action="add">
          <Order>{command_order}</Order>
          <CommandLine>powershell.exe -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/BenediktSchackenberg/octofleet/main/Install-OctofleetAgent.ps1' -OutFile 'C:\\Windows\\Temp\\Install-OctofleetAgent.ps1'; & 'C:\\Windows\\Temp\\Install-OctofleetAgent.ps1' -ApiUrl '{agent_api_url}'"</CommandLine>
          <Description>Install Octofleet Agent</Description>
        </SynchronousCommand>'''
        command_order += 1
    
    # Add custom scripts
    if custom_scripts:
        for script in custom_scripts:
            first_logon_commands += f'''
        <SynchronousCommand wcm:action="add">
          <Order>{command_order}</Order>
          <CommandLine>{script.get('command', '')}</CommandLine>
          <Description>{script.get('description', 'Custom script')}</Description>
        </SynchronousCommand>'''
            command_order += 1
    
    # Callback to Octofleet when done
    first_logon_commands += f'''
        <SynchronousCommand wcm:action="add">
          <Order>{command_order}</Order>
          <CommandLine>powershell.exe -ExecutionPolicy Bypass -Command "Invoke-RestMethod -Method POST -Uri '{agent_api_url}/api/v1/provisioning/pxe/callback' -ContentType 'application/json' -Body (ConvertTo-Json @{{hostname='%COMPUTERNAME%';step='oobe_complete';message='First logon completed'}})"</CommandLine>
          <Description>Notify Octofleet of completion</Description>
        </SynchronousCommand>'''
    
    # Determine locale settings
    locale_map = {
        "de-DE": {"input": "0407:00000407", "system": "de-DE", "user": "de-DE"},
        "en-US": {"input": "0409:00000409", "system": "en-US", "user": "en-US"},
        "en-GB": {"input": "0809:00000809", "system": "en-GB", "user": "en-GB"},
    }
    locale = locale_map.get(language, locale_map["de-DE"])
    
    return AUTOUNATTEND_TEMPLATE.format(
        hostname=hostname,
        language=language,
        input_locale=locale["input"],
        system_locale=locale["system"],
        user_locale=locale["user"],
        timezone=timezone,
        product_key=product_key or "",
        admin_password_encoded=admin_password_encoded,
        domain_join_section=domain_join_section,
        first_logon_commands=first_logon_commands
    )
