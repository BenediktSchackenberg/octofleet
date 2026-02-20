"""
Octofleet Provisioning Module
Generates Autounattend.xml for Zero-Touch Windows deployment
"""

from datetime import datetime
from typing import Optional
import xml.etree.ElementTree as ET
from xml.dom import minidom


def generate_autounattend(
    hostname: str,
    admin_password: str,
    # Network
    use_dhcp: bool = True,
    ip_address: Optional[str] = None,
    subnet_mask: str = "255.255.255.0",
    gateway: Optional[str] = None,
    dns_servers: Optional[list[str]] = None,
    # Domain
    join_domain: bool = False,
    domain_name: Optional[str] = None,
    domain_ou: Optional[str] = None,
    domain_user: Optional[str] = None,
    domain_password: Optional[str] = None,
    # Options
    windows_edition: str = "Windows Server 2025 SERVERDATACENTER",
    language: str = "en-US",
    keyboard: str = "0409:00000409",  # US keyboard
    timezone: str = "W. Europe Standard Time",
    # Post-Install
    install_octofleet_agent: bool = True,
    enable_rdp: bool = True,
    disable_firewall: bool = False,
    # PXE Server
    pxe_server: str = "http://192.168.0.5:9080",
) -> str:
    """Generate Autounattend.xml for Windows Server 2025"""
    
    # XML Namespace
    ns = "urn:schemas-microsoft-com:unattend"
    
    # Root element
    unattend = ET.Element("unattend", xmlns=ns)
    
    # ==========================================================
    # 1. windowsPE - WinPE Phase (Disk, Drivers, Image Selection)
    # ==========================================================
    settings_pe = ET.SubElement(unattend, "settings")
    settings_pe.set("pass", "windowsPE")
    
    # Windows Setup component
    setup = ET.SubElement(settings_pe, "component", 
                          name="Microsoft-Windows-Setup",
                          processorArchitecture="amd64",
                          publicKeyToken="31bf3856ad364e35",
                          language="neutral",
                          versionScope="nonSxS")
    
    # Disk Configuration - Clean install on Disk 0
    disk_config = ET.SubElement(setup, "DiskConfiguration")
    disk = ET.SubElement(disk_config, "Disk")
    ET.SubElement(disk, "DiskID").text = "0"
    ET.SubElement(disk, "WillWipeDisk").text = "true"
    create_parts = ET.SubElement(disk, "CreatePartitions")
    
    # Partition 1: EFI System (100MB)
    part1 = ET.SubElement(create_parts, "CreatePartition")
    ET.SubElement(part1, "Order").text = "1"
    ET.SubElement(part1, "Type").text = "EFI"
    ET.SubElement(part1, "Size").text = "100"
    
    # Partition 2: MSR (16MB)
    part2 = ET.SubElement(create_parts, "CreatePartition")
    ET.SubElement(part2, "Order").text = "2"
    ET.SubElement(part2, "Type").text = "MSR"
    ET.SubElement(part2, "Size").text = "16"
    
    # Partition 3: Windows (Rest)
    part3 = ET.SubElement(create_parts, "CreatePartition")
    ET.SubElement(part3, "Order").text = "3"
    ET.SubElement(part3, "Type").text = "Primary"
    ET.SubElement(part3, "Extend").text = "true"
    
    # Format partitions
    modify_parts = ET.SubElement(disk, "ModifyPartitions")
    
    # Format EFI
    mod1 = ET.SubElement(modify_parts, "ModifyPartition")
    ET.SubElement(mod1, "Order").text = "1"
    ET.SubElement(mod1, "PartitionID").text = "1"
    ET.SubElement(mod1, "Format").text = "FAT32"
    ET.SubElement(mod1, "Label").text = "System"
    
    # MSR - no format needed
    mod2 = ET.SubElement(modify_parts, "ModifyPartition")
    ET.SubElement(mod2, "Order").text = "2"
    ET.SubElement(mod2, "PartitionID").text = "2"
    
    # Format Windows partition
    mod3 = ET.SubElement(modify_parts, "ModifyPartition")
    ET.SubElement(mod3, "Order").text = "3"
    ET.SubElement(mod3, "PartitionID").text = "3"
    ET.SubElement(mod3, "Format").text = "NTFS"
    ET.SubElement(mod3, "Label").text = "Windows"
    ET.SubElement(mod3, "Letter").text = "C"
    
    # Image Install - from network share
    image_install = ET.SubElement(setup, "ImageInstall")
    os_image = ET.SubElement(image_install, "OSImage")
    install_to = ET.SubElement(os_image, "InstallTo")
    ET.SubElement(install_to, "DiskID").text = "0"
    ET.SubElement(install_to, "PartitionID").text = "3"
    
    # Install from - WIM über HTTP
    install_from = ET.SubElement(os_image, "InstallFrom")
    ET.SubElement(install_from, "Path").text = f"{pxe_server}/images/win2025/install.wim"
    meta = ET.SubElement(install_from, "MetaData")
    ET.SubElement(meta, "Key").text = "/IMAGE/NAME"
    ET.SubElement(meta, "Value").text = windows_edition
    
    # User Data
    user_data = ET.SubElement(setup, "UserData")
    ET.SubElement(user_data, "AcceptEula").text = "true"
    ET.SubElement(user_data, "FullName").text = "Octofleet"
    ET.SubElement(user_data, "Organization").text = "Octofleet"
    
    # VirtIO Drivers from wimboot ramdisk (X:\)
    driver_paths = ET.SubElement(setup, "DriverPaths")
    driver_path = ET.SubElement(driver_paths, "PathAndCredentials")
    ET.SubElement(driver_path, "Path").text = "X:\\"
    
    # International settings for WinPE
    intl_pe = ET.SubElement(settings_pe, "component",
                            name="Microsoft-Windows-International-Core-WinPE",
                            processorArchitecture="amd64",
                            publicKeyToken="31bf3856ad364e35",
                            language="neutral",
                            versionScope="nonSxS")
    ET.SubElement(intl_pe, "SetupUILanguage").append(
        _create_element("UILanguage", language)
    )
    ET.SubElement(intl_pe, "InputLocale").text = keyboard
    ET.SubElement(intl_pe, "SystemLocale").text = language
    ET.SubElement(intl_pe, "UILanguage").text = language
    ET.SubElement(intl_pe, "UserLocale").text = language
    
    # ==========================================================
    # 2. specialize - Computer Name, Network, Domain Join
    # ==========================================================
    settings_spec = ET.SubElement(unattend, "settings")
    settings_spec.set("pass", "specialize")
    
    # Computer Name
    shell_setup = ET.SubElement(settings_spec, "component",
                                name="Microsoft-Windows-Shell-Setup",
                                processorArchitecture="amd64",
                                publicKeyToken="31bf3856ad364e35",
                                language="neutral",
                                versionScope="nonSxS")
    ET.SubElement(shell_setup, "ComputerName").text = hostname
    ET.SubElement(shell_setup, "TimeZone").text = timezone
    
    # Static IP configuration (if not DHCP)
    if not use_dhcp and ip_address:
        tcpip = ET.SubElement(settings_spec, "component",
                              name="Microsoft-Windows-TCPIP",
                              processorArchitecture="amd64",
                              publicKeyToken="31bf3856ad364e35",
                              language="neutral",
                              versionScope="nonSxS")
        interfaces = ET.SubElement(tcpip, "Interfaces")
        interface = ET.SubElement(interfaces, "Interface")
        ET.SubElement(interface, "Identifier").text = "Ethernet"
        
        # IPv4 Settings
        ipv4 = ET.SubElement(interface, "Ipv4Settings")
        ET.SubElement(ipv4, "DhcpEnabled").text = "false"
        
        unicast = ET.SubElement(interface, "UnicastIpAddresses")
        addr = ET.SubElement(unicast, "IpAddress")
        addr.set("wcm:action", "add")
        addr.set("wcm:keyValue", "1")
        addr.text = f"{ip_address}/{_subnet_to_cidr(subnet_mask)}"
        
        routes = ET.SubElement(interface, "Routes")
        route = ET.SubElement(routes, "Route")
        route.set("wcm:action", "add")
        route.set("wcm:keyValue", "1")
        ET.SubElement(route, "Identifier").text = "0"
        ET.SubElement(route, "NextHopAddress").text = gateway or "192.168.0.1"
        ET.SubElement(route, "Prefix").text = "0.0.0.0/0"
        
        # DNS
        if dns_servers:
            dns_comp = ET.SubElement(settings_spec, "component",
                                     name="Microsoft-Windows-DNS-Client",
                                     processorArchitecture="amd64",
                                     publicKeyToken="31bf3856ad364e35",
                                     language="neutral",
                                     versionScope="nonSxS")
            dns_interfaces = ET.SubElement(dns_comp, "Interfaces")
            dns_iface = ET.SubElement(dns_interfaces, "Interface")
            ET.SubElement(dns_iface, "Identifier").text = "Ethernet"
            dns_addrs = ET.SubElement(dns_iface, "DNSServerSearchOrder")
            for i, dns in enumerate(dns_servers, 1):
                dns_addr = ET.SubElement(dns_addrs, "IpAddress")
                dns_addr.set("wcm:action", "add")
                dns_addr.set("wcm:keyValue", str(i))
                dns_addr.text = dns
    
    # Domain Join
    if join_domain and domain_name:
        unjoin = ET.SubElement(settings_spec, "component",
                               name="Microsoft-Windows-UnattendedJoin",
                               processorArchitecture="amd64",
                               publicKeyToken="31bf3856ad364e35",
                               language="neutral",
                               versionScope="nonSxS")
        ident = ET.SubElement(unjoin, "Identification")
        ET.SubElement(ident, "JoinDomain").text = domain_name
        if domain_ou:
            ET.SubElement(ident, "MachineObjectOU").text = domain_ou
        creds = ET.SubElement(ident, "Credentials")
        ET.SubElement(creds, "Domain").text = domain_name
        ET.SubElement(creds, "Username").text = domain_user or "Administrator"
        ET.SubElement(creds, "Password").text = domain_password or ""
    
    # Enable RDP
    if enable_rdp:
        ts = ET.SubElement(settings_spec, "component",
                           name="Microsoft-Windows-TerminalServices-LocalSessionManager",
                           processorArchitecture="amd64",
                           publicKeyToken="31bf3856ad364e35",
                           language="neutral",
                           versionScope="nonSxS")
        ET.SubElement(ts, "fDenyTSConnections").text = "false"
        
        # RDP NLA
        rdp_nla = ET.SubElement(settings_spec, "component",
                                name="Microsoft-Windows-TerminalServices-RDP-WinStationExtensions",
                                processorArchitecture="amd64",
                                publicKeyToken="31bf3856ad364e35",
                                language="neutral",
                                versionScope="nonSxS")
        ET.SubElement(rdp_nla, "UserAuthentication").text = "0"
    
    # Disable Firewall (if requested)
    if disable_firewall:
        fw = ET.SubElement(settings_spec, "component",
                           name="Networking-MPSSVC-Svc",
                           processorArchitecture="amd64",
                           publicKeyToken="31bf3856ad364e35",
                           language="neutral",
                           versionScope="nonSxS")
        fw_profiles = ET.SubElement(fw, "FirewallGroups")
        for profile in ["DomainProfile", "PrivateProfile", "PublicProfile"]:
            fp = ET.SubElement(fw_profiles, profile)
            ET.SubElement(fp, "EnableFirewall").text = "false"
    
    # ==========================================================
    # 3. oobeSystem - Admin Account, Auto-Login, First Boot
    # ==========================================================
    settings_oobe = ET.SubElement(unattend, "settings")
    settings_oobe.set("pass", "oobeSystem")
    
    shell_oobe = ET.SubElement(settings_oobe, "component",
                               name="Microsoft-Windows-Shell-Setup",
                               processorArchitecture="amd64",
                               publicKeyToken="31bf3856ad364e35",
                               language="neutral",
                               versionScope="nonSxS")
    
    # OOBE settings - skip all dialogs
    oobe = ET.SubElement(shell_oobe, "OOBE")
    ET.SubElement(oobe, "HideEULAPage").text = "true"
    ET.SubElement(oobe, "HideLocalAccountScreen").text = "true"
    ET.SubElement(oobe, "HideOEMRegistrationScreen").text = "true"
    ET.SubElement(oobe, "HideOnlineAccountScreens").text = "true"
    ET.SubElement(oobe, "HideWirelessSetupInOOBE").text = "true"
    ET.SubElement(oobe, "ProtectYourPC").text = "3"
    ET.SubElement(oobe, "NetworkLocation").text = "Work"
    
    # Admin account
    user_accounts = ET.SubElement(shell_oobe, "UserAccounts")
    admin_pass = ET.SubElement(user_accounts, "AdministratorPassword")
    ET.SubElement(admin_pass, "Value").text = admin_password
    ET.SubElement(admin_pass, "PlainText").text = "true"
    
    # Auto-login for first boot (to run post-install scripts)
    auto_logon = ET.SubElement(shell_oobe, "AutoLogon")
    ET.SubElement(auto_logon, "Enabled").text = "true"
    ET.SubElement(auto_logon, "LogonCount").text = "1"
    ET.SubElement(auto_logon, "Username").text = "Administrator"
    auto_pass = ET.SubElement(auto_logon, "Password")
    ET.SubElement(auto_pass, "Value").text = admin_password
    ET.SubElement(auto_pass, "PlainText").text = "true"
    
    # First Logon Commands (Post-Install)
    if install_octofleet_agent or enable_rdp or disable_firewall:
        first_logon = ET.SubElement(shell_oobe, "FirstLogonCommands")
        cmd_order = 1
        
        # Enable RDP Firewall Rule
        if enable_rdp:
            cmd = ET.SubElement(first_logon, "SynchronousCommand")
            ET.SubElement(cmd, "Order").text = str(cmd_order)
            ET.SubElement(cmd, "CommandLine").text = 'netsh advfirewall firewall set rule group="Remote Desktop" new enable=yes'
            ET.SubElement(cmd, "Description").text = "Enable RDP Firewall Rule"
            cmd_order += 1
        
        # Install Octofleet Agent
        if install_octofleet_agent:
            cmd = ET.SubElement(first_logon, "SynchronousCommand")
            ET.SubElement(cmd, "Order").text = str(cmd_order)
            ET.SubElement(cmd, "CommandLine").text = f'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'{pxe_server}/scripts/Install-OctofleetAgent.ps1\' -OutFile C:\\Install-Agent.ps1; C:\\Install-Agent.ps1"'
            ET.SubElement(cmd, "Description").text = "Install Octofleet Agent"
            cmd_order += 1
    
    # International settings
    intl_oobe = ET.SubElement(settings_oobe, "component",
                              name="Microsoft-Windows-International-Core",
                              processorArchitecture="amd64",
                              publicKeyToken="31bf3856ad364e35",
                              language="neutral",
                              versionScope="nonSxS")
    ET.SubElement(intl_oobe, "InputLocale").text = keyboard
    ET.SubElement(intl_oobe, "SystemLocale").text = language
    ET.SubElement(intl_oobe, "UILanguage").text = language
    ET.SubElement(intl_oobe, "UserLocale").text = language
    
    # Pretty print
    xml_str = ET.tostring(unattend, encoding="unicode")
    dom = minidom.parseString(xml_str)
    return dom.toprettyxml(indent="  ", encoding=None)


def _create_element(name: str, text: str) -> ET.Element:
    """Helper to create element with text"""
    elem = ET.Element(name)
    elem.text = text
    return elem


def _subnet_to_cidr(subnet: str) -> int:
    """Convert subnet mask to CIDR notation"""
    mapping = {
        "255.255.255.0": 24,
        "255.255.255.128": 25,
        "255.255.255.192": 26,
        "255.255.255.224": 27,
        "255.255.255.240": 28,
        "255.255.254.0": 23,
        "255.255.252.0": 22,
        "255.255.248.0": 21,
        "255.255.240.0": 20,
        "255.255.0.0": 16,
        "255.0.0.0": 8,
    }
    return mapping.get(subnet, 24)


def generate_ipxe_script(
    mac_address: str,
    hostname: str,
    pxe_server: str = "http://192.168.0.5:9080",
) -> str:
    """Generate MAC-specific iPXE boot script"""
    mac_hyp = mac_address.replace(":", "-").lower()
    
    return f"""#!ipxe
# ============================================================
# Octofleet Zero-Touch Install: {hostname}
# MAC: {mac_hyp}
# Generated: {datetime.utcnow().isoformat()}Z
# ============================================================

echo
echo ===============================================
echo    🐙 Installing: {hostname}
echo ===============================================
echo

set pxe-server {pxe_server}

echo Loading WinPE with VirtIO drivers...
kernel ${{pxe-server}}/winpe/wimboot
initrd ${{pxe-server}}/winpe/BCD                              BCD
initrd ${{pxe-server}}/winpe/boot.sdi                         boot.sdi
initrd ${{pxe-server}}/winpe/boot.wim                         boot.wim
initrd ${{pxe-server}}/answers/{mac_hyp}.xml                  Autounattend.xml
initrd ${{pxe-server}}/winpe/drivers/viostor.inf              viostor.inf
initrd ${{pxe-server}}/winpe/drivers/viostor.sys              viostor.sys
initrd ${{pxe-server}}/winpe/drivers/viostor.cat              viostor.cat
initrd ${{pxe-server}}/winpe/drivers/netkvm.inf               netkvm.inf
initrd ${{pxe-server}}/winpe/drivers/netkvm.sys               netkvm.sys
initrd ${{pxe-server}}/winpe/drivers/netkvm.cat               netkvm.cat
boot
"""


# Test
if __name__ == "__main__":
    xml = generate_autounattend(
        hostname="TEST-VM-01",
        admin_password="P@ssw0rd123!",
        use_dhcp=True,
        install_octofleet_agent=True,
        enable_rdp=True,
    )
    print(xml)
