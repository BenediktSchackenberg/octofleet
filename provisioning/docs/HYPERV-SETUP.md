# Octofleet PXE - Hyper-V Setup Guide

Zero-Touch Windows Deployment via PXE für Hyper-V VMs.

## VM Konfiguration

### Wichtig: Generation 2 verwenden!

| Setting | Wert | Grund |
|---------|------|-------|
| **Generation** | Gen2 | Gen1 (BIOS) hat wimboot Bug! |
| **Secure Boot** | Disabled | Für PXE Boot |
| **Firmware** | UEFI | Standard bei Gen2 |

### Hyper-V Manager Einstellungen

1. **Neue VM** → Generation 2
2. **Memory:** Min 4GB
3. **Network:** External vSwitch mit PXE-fähigem DHCP
4. **Storage:** Standard VHDX
5. **Security:** Secure Boot **deaktivieren**
6. **Firmware:** Network Adapter als erstes Boot Device

### PowerShell Beispiel

```powershell
# VM erstellen
New-VM -Name "Win2025-Test" -Generation 2 -MemoryStartupBytes 4GB -NewVHDPath "C:\VMs\Win2025-Test.vhdx" -NewVHDSizeBytes 60GB -SwitchName "External"

# Secure Boot deaktivieren
Set-VMFirmware -VMName "Win2025-Test" -EnableSecureBoot Off

# Network Boot first
$net = Get-VMNetworkAdapter -VMName "Win2025-Test"
Set-VMFirmware -VMName "Win2025-Test" -FirstBootDevice $net
```

## Bekannte Probleme

### Gen1 (BIOS) funktioniert NICHT

wimboot hat einen Bug mit Hyper-V BIOS Mode - führt zu "Bad CPIO magic" Fehler.

**Lösung:** Immer Generation 2 (UEFI) verwenden.

### Secure Boot blockiert PXE

Secure Boot muss deaktiviert sein für unsigned iPXE/wimboot.

## Deployment Flow

Identisch mit KVM/libvirt - siehe [KVM-LIBVIRT-SETUP.md](KVM-LIBVIRT-SETUP.md)

---

*Getestet: 2026-02-21 mit Windows Server 2025 auf Hyper-V Gen2*
