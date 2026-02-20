# Test-ScreenHelper.ps1
# Quick test script for Screen Helper functionality
# Run on a Windows machine with Visual Studio

param(
    [switch]$Build,
    [switch]$TestIpc,
    [switch]$TestCapture
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== Octofleet Screen Helper Test ===" -ForegroundColor Cyan

# Build if requested
if ($Build) {
    Write-Host "`n[1] Building projects..." -ForegroundColor Yellow
    
    $serviceCsproj = Join-Path $RepoRoot "src\OctofleetAgent.Service\OctofleetAgent.Service.csproj"
    $helperCsproj = Join-Path $RepoRoot "src\OctofleetScreenHelper\OctofleetScreenHelper.csproj"
    
    Write-Host "Building Service..."
    dotnet build $serviceCsproj -c Debug
    if ($LASTEXITCODE -ne 0) { throw "Service build failed" }
    
    Write-Host "Building Screen Helper..."
    dotnet build $helperCsproj -c Debug
    if ($LASTEXITCODE -ne 0) { throw "Screen Helper build failed" }
    
    Write-Host "Build successful!" -ForegroundColor Green
}

# Find built executables
$helperExe = Join-Path $RepoRoot "src\OctofleetScreenHelper\bin\Debug\net8.0-windows\OctofleetScreenHelper.exe"
$serviceExe = Join-Path $RepoRoot "src\OctofleetAgent.Service\bin\Debug\net8.0-windows\OctofleetAgent.Service.exe"

if (-not (Test-Path $helperExe)) {
    Write-Host "Screen Helper not found at: $helperExe" -ForegroundColor Red
    Write-Host "Run with -Build to compile first" -ForegroundColor Yellow
    exit 1
}

# Test IPC connectivity
if ($TestIpc) {
    Write-Host "`n[2] Testing IPC connectivity..." -ForegroundColor Yellow
    
    # Start helper
    Write-Host "Starting Screen Helper..."
    $helperProc = Start-Process -FilePath $helperExe -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
    
    # Check if running
    if ($helperProc.HasExited) {
        Write-Host "Screen Helper exited immediately!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Screen Helper running (PID: $($helperProc.Id))" -ForegroundColor Green
    
    # Try to connect via named pipe
    $pipeName = "octofleet-screen-$env:USERNAME"
    Write-Host "Testing pipe: $pipeName"
    
    try {
        $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
        $pipe.Connect(5000)
        
        # Send ping
        $writer = New-Object System.IO.StreamWriter($pipe)
        $reader = New-Object System.IO.StreamReader($pipe)
        
        $writer.WriteLine('{"cmd":"ping"}')
        $writer.Flush()
        
        # Read response (with timeout)
        $pipe.ReadMode = [System.IO.Pipes.PipeTransmissionMode]::Message
        $buffer = New-Object byte[] 4096
        $bytesRead = $pipe.Read($buffer, 0, $buffer.Length)
        $response = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)
        
        Write-Host "IPC Response: $response" -ForegroundColor Green
        
        $pipe.Close()
    }
    catch {
        Write-Host "IPC connection failed: $_" -ForegroundColor Red
    }
    finally {
        # Stop helper
        Stop-Process -Id $helperProc.Id -Force -ErrorAction SilentlyContinue
        Write-Host "Screen Helper stopped"
    }
}

# Test screen capture
if ($TestCapture) {
    Write-Host "`n[3] Testing screen capture..." -ForegroundColor Yellow
    
    # Quick capture test using .NET
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    
    $screens = [System.Windows.Forms.Screen]::AllScreens
    Write-Host "Found $($screens.Count) monitor(s):"
    
    foreach ($screen in $screens) {
        Write-Host "  - $($screen.DeviceName): $($screen.Bounds.Width)x$($screen.Bounds.Height) $(if($screen.Primary){'(Primary)'})"
    }
    
    # Capture primary screen
    $primary = [System.Windows.Forms.Screen]::PrimaryScreen
    $bitmap = New-Object System.Drawing.Bitmap($primary.Bounds.Width, $primary.Bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($primary.Bounds.Location, [System.Drawing.Point]::Empty, $primary.Bounds.Size)
    
    $testFile = Join-Path $env:TEMP "octofleet-screen-test.jpg"
    $bitmap.Save($testFile, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    
    $fileInfo = Get-Item $testFile
    Write-Host "Captured: $testFile ($([math]::Round($fileInfo.Length / 1KB, 1)) KB)" -ForegroundColor Green
    
    # Cleanup
    $graphics.Dispose()
    $bitmap.Dispose()
    
    # Open the image
    Write-Host "Opening capture..."
    Start-Process $testFile
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Cyan
Write-Host @"

Next steps:
1. Build: .\Test-ScreenHelper.ps1 -Build
2. Test IPC: .\Test-ScreenHelper.ps1 -TestIpc
3. Test Capture: .\Test-ScreenHelper.ps1 -TestCapture
4. Full test: .\Test-ScreenHelper.ps1 -Build -TestIpc -TestCapture

To test end-to-end with the service:
1. Start Screen Helper manually (tray icon should appear)
2. Open Octofleet UI -> Node -> Screen View
3. Should connect and stream!
"@
