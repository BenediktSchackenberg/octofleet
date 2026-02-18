# MSSQL Deployment Module
# Handles SQL Server installation with disk preparation

import uuid
import json
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
import asyncpg

router = APIRouter(prefix="/api/v1/mssql", tags=["MSSQL"])

# Download URLs for Express/Developer editions
# Using ISO downloads where possible for better compatibility
# NOTE: For local ISOs, set download URL to "local:<path>" e.g. "local:\\\\server\\share\\sql2025.iso"
MSSQL_DOWNLOADS = {
    "2019": {
        "express": "https://go.microsoft.com/fwlink/?linkid=866658",
        "developer": "https://go.microsoft.com/fwlink/?linkid=866662",
        "type": "bootstrapper"
    },
    "2022": {
        "express": "https://go.microsoft.com/fwlink/?linkid=2215158",
        "developer": "local:\\\\BALTASA\\ISOs\\SQLServer2022-x64-ENU-Dev.iso",
        "type": "iso"
    },
    "2025": {
        # SQL Server 2025 RC0 - Use local ISO from BALTASA share
        "developer": "local:\\\\BALTASA\\ISOs\\SQLServer2025-RC0-x64-ENU.iso",
        "evaluation": "local:\\\\BALTASA\\ISOs\\SQLServer2025-RC0-x64-ENU.iso",
        "type": "iso"
    }
}

# Edition info
EDITIONS = [
    {
        "id": "express",
        "name": "SQL Server Express",
        "free": True,
        "limits": "10GB DB, 1GB RAM, 4 cores",
        "versions": ["2019", "2022", "2025"],
        "downloadable": True,
        "requiresLicense": False
    },
    {
        "id": "developer",
        "name": "SQL Server Developer", 
        "free": True,
        "limits": "Dev/Test only, full features",
        "versions": ["2019", "2022", "2025"],
        "downloadable": True,
        "requiresLicense": False
    },
    {
        "id": "standard",
        "name": "SQL Server Standard",
        "free": False,
        "limits": "128GB RAM, 24 cores",
        "versions": ["2019", "2022", "2025"],
        "downloadable": False,
        "requiresLicense": True
    },
    {
        "id": "enterprise",
        "name": "SQL Server Enterprise",
        "free": False,
        "limits": "Unlimited",
        "versions": ["2019", "2022", "2025"],
        "downloadable": False,
        "requiresLicense": True
    }
]


# ============================================
# Pydantic Models
# ============================================

class DiskConfig(BaseModel):
    purpose: str = Field(..., description="data, log, tempdb, or backup")
    diskIdentifier: Optional[Dict[str, Any]] = Field(default=None, description="How to identify the disk (optional, auto-detect if None)")
    driveLetter: str = Field(..., min_length=1, max_length=1)
    volumeLabel: str = Field(default="SQL_Volume")
    allocationUnitKb: int = Field(default=64)
    folder: str = Field(..., description="Folder name to create")


class DiskConfigSection(BaseModel):
    prepareDisks: bool = Field(default=True)
    disks: List[DiskConfig]


class SqlPaths(BaseModel):
    userDbDir: str = Field(default="D:\\Data")
    userDbLogDir: str = Field(default="E:\\Logs")
    tempDbDir: str = Field(default="F:\\TempDB")
    tempDbLogDir: str = Field(default="F:\\TempDB")
    backupDir: Optional[str] = Field(default=None)


class MssqlInstallRequest(BaseModel):
    targets: List[str] = Field(..., description="List of node IDs")
    edition: str = Field(..., description="express, developer, standard, enterprise")
    version: str = Field(..., description="2019, 2022, 2025")
    instanceName: str = Field(default="MSSQLSERVER")
    features: List[str] = Field(default=["SQLEngine"])
    saPassword: str = Field(..., min_length=8, description="SA password (not stored)")
    licenseKey: Optional[str] = Field(default=None, description="Required for Standard/Enterprise")
    collation: str = Field(default="Latin1_General_CI_AS")
    port: int = Field(default=1433)
    maxMemoryMb: Optional[int] = Field(default=None)
    tempDbFileCount: int = Field(default=4)
    tempDbFileSizeMb: int = Field(default=1024)
    includeSsms: bool = Field(default=True)
    diskConfig: Optional[DiskConfigSection] = Field(default=None)
    sqlPaths: Optional[SqlPaths] = Field(default=None)
    # For Standard/Enterprise - ISO path on network share
    isoPath: Optional[str] = Field(default=None, description="UNC path to SQL Server ISO")


class MssqlConfigCreate(BaseModel):
    name: str
    description: Optional[str] = None
    edition: str
    version: str
    instanceName: str = "MSSQLSERVER"
    features: List[str] = ["SQLEngine"]
    collation: str = "Latin1_General_CI_AS"
    port: int = 1433
    maxMemoryMb: Optional[int] = None
    tempDbFileCount: int = 4
    tempDbFileSizeMb: int = 1024
    includeSsms: bool = True
    diskConfigs: Optional[List[DiskConfig]] = None


# ============================================
# Script Generators
# ============================================

def generate_disk_prep_script(disk_config: DiskConfigSection) -> str:
    """Generate PowerShell script for disk preparation - auto-detects unconfigured disks"""
    
    # Build target config from disk_config
    targets = []
    for disk in disk_config.disks:
        targets.append({
            "purpose": disk.purpose,
            "letter": disk.driveLetter,
            "label": disk.volumeLabel,
            "folder": disk.folder
        })
    
    targets_json = json.dumps(targets)
    
    script = f'''# MSSQL Disk Preparation Script
# Generated by Octofleet
# Auto-detects and configures unconfigured disks

$ErrorActionPreference = 'Stop'

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SQL Server Disk Preparation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Target configuration
$targets = @(
    @{{ Purpose = "data";   Letter = "D"; Label = "SQL_Data";   Folder = "Data" }},
    @{{ Purpose = "log";    Letter = "E"; Label = "SQL_Logs";   Folder = "Logs" }},
    @{{ Purpose = "tempdb"; Letter = "F"; Label = "SQL_TempDB"; Folder = "TempDB" }}
)

# ============================================
# Step 1: Free up drive letters D, E, F
# ============================================
Write-Host "[Step 1] Freeing up drive letters D, E, F..." -ForegroundColor Yellow

foreach ($letter in @('D', 'E', 'F')) {{
    $existing = Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue
    if ($existing) {{
        Write-Host "  $letter`: is in use - checking type..."
        
        # Check if CD-ROM via WMI
        $cdrom = Get-WmiObject Win32_CDROMDrive | Where-Object {{ $_.Drive -eq "${{letter}}:" }}
        if ($cdrom) {{
            Write-Host "  $letter`: is CD-ROM - removing drive letter" -ForegroundColor Cyan
            $vol = Get-WmiObject Win32_Volume | Where-Object {{ $_.DriveLetter -eq "${{letter}}:" }}
            if ($vol) {{
                $vol.DriveLetter = $null
                $vol.Put() | Out-Null
                Write-Host "  $letter`: freed" -ForegroundColor Green
            }}
            continue
        }}
        
        # Check partition
        $partition = Get-Partition -DriveLetter $letter -ErrorAction SilentlyContinue
        if ($partition) {{
            $disk = Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue
            if ($disk.BusType -eq 'ATAPI' -or $disk.BusType -eq 'USB') {{
                Write-Host "  $letter`: is removable - removing access path" -ForegroundColor Cyan
                Remove-PartitionAccessPath -DiskNumber $partition.DiskNumber -PartitionNumber $partition.PartitionNumber -AccessPath "${{letter}}:\\" -ErrorAction SilentlyContinue
                Write-Host "  $letter`: freed" -ForegroundColor Green
            }} else {{
                Write-Host "  Warning: $letter`: is in use by a fixed disk" -ForegroundColor Red
            }}
        }}
    }} else {{
        Write-Host "  $letter`: available"
    }}
}}

# ============================================
# Step 2: Find unconfigured disks
# ============================================
Write-Host ""
Write-Host "[Step 2] Finding unconfigured disks..." -ForegroundColor Yellow

# Get all disks except disk 0 (system)
$allDisks = Get-Disk | Where-Object {{ $_.Number -ne 0 }}

# Bring all offline disks online first
foreach ($disk in $allDisks) {{
    if ($disk.OperationalStatus -eq 'Offline') {{
        Write-Host "  Disk $($disk.Number): Bringing online ($([math]::Round($disk.Size/1GB, 1)) GB)"
        Set-Disk -Number $disk.Number -IsOffline $false
        Set-Disk -Number $disk.Number -IsReadOnly $false
    }}
}}
Start-Sleep -Seconds 2

# Refresh disk list
$allDisks = Get-Disk | Where-Object {{ $_.Number -ne 0 }}

# Find disks that are RAW or have no volumes
$unconfiguredDisks = @()
foreach ($disk in $allDisks) {{
    $hasVolume = Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | 
                 Where-Object {{ $_.DriveLetter -and $_.DriveLetter -match '[A-Z]' }}
    
    if ($disk.PartitionStyle -eq 'RAW' -or -not $hasVolume) {{
        $unconfiguredDisks += $disk
        Write-Host "  Disk $($disk.Number): $([math]::Round($disk.Size/1GB, 1)) GB - UNCONFIGURED" -ForegroundColor Cyan
    }} else {{
        Write-Host "  Disk $($disk.Number): $([math]::Round($disk.Size/1GB, 1)) GB - already configured"
    }}
}}

if ($unconfiguredDisks.Count -eq 0) {{
    Write-Host ""
    Write-Host "No unconfigured disks found!" -ForegroundColor Red
    Write-Host "Either disks are already configured or not attached."
    exit 1
}}

Write-Host ""
Write-Host "Found $($unconfiguredDisks.Count) unconfigured disk(s)" -ForegroundColor Green

# ============================================
# Step 3: Sort and assign disks by size
# ============================================
Write-Host ""
Write-Host "[Step 3] Assigning disks by size..." -ForegroundColor Yellow

# Sort by size descending (largest first for Data)
$sortedDisks = $unconfiguredDisks | Sort-Object Size -Descending

# Assignment logic: 
# - If 3+ disks: largest=Data, smallest=Log, middle=TempDB
# - If 2 disks: largest=Data, smaller=Log+TempDB
# - If 1 disk: all on one disk

$assignments = @{{}}

if ($sortedDisks.Count -ge 3) {{
    $assignments['data'] = $sortedDisks[0]
    $assignments['tempdb'] = $sortedDisks[1]
    $assignments['log'] = $sortedDisks[$sortedDisks.Count - 1]
}} elseif ($sortedDisks.Count -eq 2) {{
    $assignments['data'] = $sortedDisks[0]
    $assignments['log'] = $sortedDisks[1]
    $assignments['tempdb'] = $sortedDisks[1]  # Share with log
}} else {{
    $assignments['data'] = $sortedDisks[0]
    $assignments['log'] = $sortedDisks[0]
    $assignments['tempdb'] = $sortedDisks[0]
}}

Write-Host "  Data   -> Disk $($assignments['data'].Number) ($([math]::Round($assignments['data'].Size/1GB, 1)) GB)"
Write-Host "  Log    -> Disk $($assignments['log'].Number) ($([math]::Round($assignments['log'].Size/1GB, 1)) GB)"
Write-Host "  TempDB -> Disk $($assignments['tempdb'].Number) ($([math]::Round($assignments['tempdb'].Size/1GB, 1)) GB)"

# ============================================
# Step 4: Initialize and format disks
# ============================================
Write-Host ""
Write-Host "[Step 4] Initializing and formatting..." -ForegroundColor Yellow

$processedDisks = @{{}}
$AllocationUnitBytes = 65536  # 64KB

foreach ($target in $targets) {{
    $disk = $assignments[$target.Purpose]
    $letter = $target.Letter
    $label = $target.Label
    $folder = $target.Folder
    
    Write-Host ""
    Write-Host "--- $($target.Purpose.ToUpper()): Disk $($disk.Number) -> $letter`: ---" -ForegroundColor Cyan
    
    # Check if we already processed this disk (for shared disk scenarios)
    if ($processedDisks.ContainsKey($disk.Number)) {{
        Write-Host "  Disk already formatted, just creating folder..."
        $existingLetter = $processedDisks[$disk.Number]
        $folderPath = "${{existingLetter}}:\\$folder"
        if (!(Test-Path $folderPath)) {{
            New-Item -Path $folderPath -ItemType Directory -Force | Out-Null
            Write-Host "  Created $folderPath" -ForegroundColor Green
        }}
        continue
    }}
    
    # Initialize if RAW
    $disk = Get-Disk -Number $disk.Number
    if ($disk.PartitionStyle -eq 'RAW') {{
        Write-Host "  Initializing as GPT..."
        Initialize-Disk -Number $disk.Number -PartitionStyle GPT -Confirm:$false
    }}
    
    # Clear existing partitions if any (except system reserved)
    $existingParts = Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | 
                     Where-Object {{ $_.Type -ne 'Reserved' }}
    foreach ($part in $existingParts) {{
        Write-Host "  Removing existing partition $($part.PartitionNumber)..."
        Remove-Partition -DiskNumber $disk.Number -PartitionNumber $part.PartitionNumber -Confirm:$false -ErrorAction SilentlyContinue
    }}
    
    # Create partition
    Write-Host "  Creating partition with drive letter $letter`..."
    $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -DriveLetter $letter
    
    # Format with 64KB allocation unit
    Write-Host "  Formatting NTFS with 64KB allocation unit..."
    Format-Volume -DriveLetter $letter `
                  -FileSystem NTFS `
                  -AllocationUnitSize $AllocationUnitBytes `
                  -NewFileSystemLabel $label `
                  -Confirm:$false | Out-Null
    
    # Create folder
    $folderPath = "${{letter}}:\\$folder"
    Write-Host "  Creating folder $folderPath..."
    New-Item -Path $folderPath -ItemType Directory -Force | Out-Null
    
    # Mark as processed
    $processedDisks[$disk.Number] = $letter
    
    Write-Host "  ✓ Complete" -ForegroundColor Green
}}

# ============================================
# Summary
# ============================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Disk Preparation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Paths ready for SQL Server:"
Write-Host "  Data:   D:\\Data"
Write-Host "  Logs:   E:\\Logs"  
Write-Host "  TempDB: F:\\TempDB"
Write-Host ""
'''
    
    return script


def generate_config_ini(request: MssqlInstallRequest, paths: SqlPaths) -> str:
    """Generate SQL Server ConfigurationFile.ini
    
    Note: SQL Server setup ConfigurationFile.ini format:
    - String values use quotes: KEY="value"  
    - Numeric values no quotes: KEY=123
    - Paths use quotes: KEY="D:\\Data"
    - Boolean: "True" or "False"
    """
    
    features = ",".join(request.features)
    
    # Determine service account name
    if request.instanceName == "MSSQLSERVER":
        sql_svc_account = "NT Service\\MSSQLSERVER"
        agt_svc_account = "NT Service\\SQLSERVERAGENT"
    else:
        sql_svc_account = f"NT Service\\MSSQL${request.instanceName}"
        agt_svc_account = f"NT Service\\SQLAgent${request.instanceName}"
    
    ini_lines = [
        "; SQL Server Configuration File",
        "; Generated by Octofleet",
        "[OPTIONS]",
        "",
        "; Setup Action",
        'ACTION="Install"',
        f"FEATURES={features}",
        f'INSTANCENAME="{request.instanceName}"',
        f'INSTANCEID="{request.instanceName}"',
        "",
        "; Authentication",
        'SECURITYMODE="SQL"',
        f'SAPWD="{request.saPassword}"',
        'SQLSYSADMINACCOUNTS="BUILTIN\\Administrators"',
        "",
        "; Collation",
        f'SQLCOLLATION="{request.collation}"',
        "",
        "; Data Directories (no trailing backslash)",
        f'INSTALLSQLDATADIR="{paths.userDbDir}"',
        f'SQLUSERDBDIR="{paths.userDbDir}"',
        f'SQLUSERDBLOGDIR="{paths.userDbLogDir}"',
        f'SQLTEMPDBDIR="{paths.tempDbDir}"',
        f'SQLTEMPDBLOGDIR="{paths.tempDbLogDir}"',
    ]
    
    if paths.backupDir:
        ini_lines.append(f'SQLBACKUPDIR="{paths.backupDir}"')
    
    ini_lines.extend([
        "",
        "; TempDB Configuration",
        f"SQLTEMPDBFILECOUNT={request.tempDbFileCount}",
        f"SQLTEMPDBFILESIZE={request.tempDbFileSizeMb}",
        "SQLTEMPDBFILEGROWTH=512",
        "SQLTEMPDBLOGFILESIZE=256",
        "SQLTEMPDBLOGFILEGROWTH=64",
        "",
        "; Network - TCP enabled",
        "TCPENABLED=1",
        "NPENABLED=0",
        "",
        "; Service Accounts",
        f'SQLSVCACCOUNT="{sql_svc_account}"',
        'SQLSVCSTARTUPTYPE="Automatic"',
        f'AGTSVCACCOUNT="{agt_svc_account}"',
        'AGTSVCSTARTUPTYPE="Automatic"',
        "",
        "; Telemetry - disabled",
        'SQLTELSVCSTARTUPTYPE="Disabled"',
        "",
        "; Suppress prompts",
        'IACCEPTSQLSERVERLICENSETERMS="True"',
        'SUPPRESSPRIVACYSTATEMENTNOTICE="True"',
        "",
        "; Updates - managed separately by Octofleet",
        'UPDATEENABLED="False"',
    ])
    
    if request.licenseKey:
        ini_lines.append(f'PID="{request.licenseKey}"')
    
    return "\n".join(ini_lines)


def generate_install_script(request: MssqlInstallRequest, paths: SqlPaths) -> str:
    """Generate the main SQL Server installation script"""
    
    config_ini = generate_config_ini(request, paths)
    # Escape for PowerShell here-string
    config_ini_escaped = config_ini.replace("'", "''")
    
    version_config = MSSQL_DOWNLOADS.get(request.version, {})
    download_url = version_config.get(request.edition, "")
    download_type = version_config.get("type", "bootstrapper")
    
    script = f'''# SQL Server {request.version} {request.edition.title()} Installation
# Generated by Octofleet
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$setupDir = "$env:TEMP\\SQLSetup"
$configPath = "$setupDir\\ConfigurationFile.ini"

# Create setup directory
New-Item -Path $setupDir -ItemType Directory -Force | Out-Null

# Write configuration file
$configContent = @'
{config_ini_escaped}
'@
$configContent | Out-File -FilePath $configPath -Encoding ASCII

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SQL Server {request.version} {request.edition.title()} Installation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration file written to $configPath"
'''

    # Check if download_url is a local path (starts with "local:")
    is_local_iso = download_url and download_url.startswith("local:")
    local_iso_path = download_url[6:] if is_local_iso else None  # Strip "local:" prefix

    if is_local_iso:
        # Use local/network ISO path directly
        script += f'''
# ============================================
# Mount local/network ISO
# ============================================
$isoPath = "{local_iso_path}"
Write-Host ""
Write-Host "[Step 1] Mounting ISO from network path..." -ForegroundColor Yellow
Write-Host "Path: $isoPath"

if (!(Test-Path $isoPath)) {{
    throw "ISO file not found: $isoPath"
}}

$mountResult = Mount-DiskImage -ImagePath $isoPath -PassThru
Start-Sleep -Seconds 3
$driveLetter = ($mountResult | Get-Volume).DriveLetter
$setupPath = "${{driveLetter}}:\\setup.exe"

Write-Host "ISO mounted at ${{driveLetter}}:\\" -ForegroundColor Green

if (!(Test-Path $setupPath)) {{
    Dismount-DiskImage -ImagePath $isoPath -ErrorAction SilentlyContinue
    throw "setup.exe not found on mounted ISO"
}}
'''
    elif download_type == "iso":
        # ISO-based installation (SQL Server 2022+, 2025)
        script += f'''
# ============================================
# Download SQL Server ISO
# ============================================
$downloadUrl = "{download_url}"
$isoPath = "$setupDir\\SQLServer.iso"

Write-Host ""
Write-Host "[Step 1] Downloading SQL Server ISO..." -ForegroundColor Yellow
Write-Host "URL: $downloadUrl"
Write-Host "This may take 10-20 minutes depending on connection speed..."

$ProgressPreference = 'SilentlyContinue'
$webClient = New-Object System.Net.WebClient
$webClient.DownloadFile($downloadUrl, $isoPath)

$isoSize = [math]::Round((Get-Item $isoPath).Length / 1GB, 2)
Write-Host "Download complete: $isoSize GB" -ForegroundColor Green

# ============================================
# Mount ISO and locate setup.exe
# ============================================
Write-Host ""
Write-Host "[Step 2] Mounting ISO..." -ForegroundColor Yellow

$mountResult = Mount-DiskImage -ImagePath $isoPath -PassThru
Start-Sleep -Seconds 3
$driveLetter = ($mountResult | Get-Volume).DriveLetter
$setupPath = "${{driveLetter}}:\\setup.exe"

Write-Host "ISO mounted at ${{driveLetter}}:\\"

if (!(Test-Path $setupPath)) {{
    Dismount-DiskImage -ImagePath $isoPath -ErrorAction SilentlyContinue
    throw "setup.exe not found on mounted ISO at $setupPath"
}}
'''
    elif request.isoPath:
        # User-provided ISO path
        script += f'''
# ============================================
# Mount user-provided ISO
# ============================================
$isoPath = "{request.isoPath}"
Write-Host ""
Write-Host "[Step 1] Mounting ISO from $isoPath..." -ForegroundColor Yellow

$mountResult = Mount-DiskImage -ImagePath $isoPath -PassThru
Start-Sleep -Seconds 3
$driveLetter = ($mountResult | Get-Volume).DriveLetter
$setupPath = "${{driveLetter}}:\\setup.exe"

Write-Host "ISO mounted at ${{driveLetter}}:\\"

if (!(Test-Path $setupPath)) {{
    Dismount-DiskImage -ImagePath $isoPath -ErrorAction SilentlyContinue
    throw "setup.exe not found on mounted ISO"
}}
'''
    else:
        # Bootstrapper download (legacy - SQL Server 2019 and older)
        script += f'''
# ============================================
# Download SQL Server Bootstrapper
# ============================================
$downloadUrl = "{download_url}"
$setupExe = "$setupDir\\SQLSetup.exe"

Write-Host ""
Write-Host "[Step 1] Downloading SQL Server {request.version} {request.edition.title()}..." -ForegroundColor Yellow
Write-Host "URL: $downloadUrl"

$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $downloadUrl -OutFile $setupExe -UseBasicParsing

Write-Host "Download complete. Extracting..." -ForegroundColor Green
Start-Process -FilePath $setupExe -ArgumentList "/QS /x:$setupDir\\extracted" -Wait -NoNewWindow

$actualSetup = Get-ChildItem -Path "$setupDir\\extracted" -Recurse -Filter "setup.exe" | Select-Object -First 1
if (-not $actualSetup) {{
    throw "setup.exe not found after extraction"
}}
$setupPath = $actualSetup.FullName
'''

    script += f'''
# ============================================
# Run SQL Server Setup
# ============================================
Write-Host ""
Write-Host "[Step 3] Starting SQL Server installation..." -ForegroundColor Yellow
Write-Host "This may take 20-45 minutes. Please wait..."
Write-Host ""

$process = Start-Process -FilePath $setupPath `
    -ArgumentList "/ConfigurationFile=`"$configPath`" /IACCEPTSQLSERVERLICENSETERMS /ENU /QS" `
    -Wait -PassThru -NoNewWindow

# Cleanup - dismount ISO if we mounted one
if (Test-Path variable:isoPath) {{
    Dismount-DiskImage -ImagePath $isoPath -ErrorAction SilentlyContinue
}}

if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {{
    # 3010 = reboot required, still success
    # Check summary log for details
    $logPath = "$env:ProgramFiles\\Microsoft SQL Server\\*\\Setup Bootstrap\\Log\\Summary.txt"
    $summaryLog = Get-ChildItem -Path $logPath -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($summaryLog) {{
        Write-Host "=== Installation Log (last 50 lines) ===" -ForegroundColor Red
        Get-Content $summaryLog.FullName | Select-Object -Last 50
    }}
    throw "SQL Server installation failed with exit code $($process.ExitCode)"
}}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  ✅ SQL Server Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

if ($process.ExitCode -eq 3010) {{
    Write-Host ""
    Write-Host "⚠️  A system restart is required to complete the installation." -ForegroundColor Yellow
}}
'''

    # Memory configuration
    if request.maxMemoryMb:
        script += f'''
# Configure max server memory
Write-Host "Configuring max server memory to {request.maxMemoryMb} MB..."
$sqlCmd = @"
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'max server memory', {request.maxMemoryMb};
RECONFIGURE;
"@
Invoke-Sqlcmd -Query $sqlCmd -ServerInstance "localhost\\{request.instanceName}" -TrustServerCertificate
'''

    # Firewall
    script += f'''
# Configure Windows Firewall
Write-Host "Configuring firewall..."
New-NetFirewallRule -DisplayName "SQL Server ({request.instanceName})" `
    -Direction Inbound -Protocol TCP -LocalPort {request.port} -Action Allow -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName "SQL Server Browser" `
    -Direction Inbound -Protocol UDP -LocalPort 1434 -Action Allow -ErrorAction SilentlyContinue
'''

    # SSMS
    if request.includeSsms:
        script += '''
# Install SQL Server Management Studio
Write-Host "Installing SSMS..."
$chocoPath = "C:\\ProgramData\\chocolatey\\bin\\choco.exe"
if (!(Test-Path $chocoPath)) {
    Write-Host "Installing Chocolatey first..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}
& $chocoPath install sql-server-management-studio -y --no-progress
'''

    script += '''
# Cleanup
Write-Host "Cleaning up temporary files..."
Remove-Item -Path $setupDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=========================================="
Write-Host "✅ SQL Server Installation Complete!"
Write-Host "=========================================="
'''

    return script


# ============================================
# API Endpoints
# ============================================

@router.get("/editions")
async def list_editions():
    """List available SQL Server editions"""
    return {"editions": EDITIONS}


@router.get("/downloads")
async def get_download_urls():
    """Get download URLs for Express/Developer editions"""
    return {"downloads": MSSQL_DOWNLOADS}


@router.post("/configs")
async def create_config(config: MssqlConfigCreate, db: asyncpg.Pool = Depends(lambda: None)):
    """Create a reusable MSSQL configuration profile"""
    # This will be injected properly when registered with the app
    pass  # Implemented in main.py


@router.get("/configs")
async def list_configs(db: asyncpg.Pool = Depends(lambda: None)):
    """List all MSSQL configuration profiles"""
    pass


@router.get("/configs/{config_id}")
async def get_config(config_id: str, db: asyncpg.Pool = Depends(lambda: None)):
    """Get a specific MSSQL configuration profile"""
    pass


@router.delete("/configs/{config_id}")
async def delete_config(config_id: str, db: asyncpg.Pool = Depends(lambda: None)):
    """Delete a MSSQL configuration profile"""
    pass


@router.post("/install")
async def install_mssql(request: MssqlInstallRequest, db: asyncpg.Pool = Depends(lambda: None)):
    """
    Install SQL Server on target nodes.
    
    This creates jobs for:
    1. Disk preparation (if diskConfig provided)
    2. SQL Server installation
    3. Post-installation configuration
    """
    pass


@router.get("/instances")
async def list_instances(node_id: Optional[str] = None, db: asyncpg.Pool = Depends(lambda: None)):
    """List all MSSQL instances across nodes"""
    pass


@router.get("/instances/{instance_id}")
async def get_instance(instance_id: str, db: asyncpg.Pool = Depends(lambda: None)):
    """Get details of a specific MSSQL instance"""
    pass


# Export for use in main.py
__all__ = [
    "router",
    "generate_disk_prep_script",
    "generate_install_script",
    "generate_config_ini",
    "MssqlInstallRequest",
    "DiskConfigSection",
    "SqlPaths",
    "MSSQL_DOWNLOADS",
    "EDITIONS"
]
