# Pester Tests for OpenClaw Windows Agent
# Run with: Invoke-Pester -Path .\Tests\Agent.Tests.ps1 -Output Detailed

BeforeAll {
    $script:InstallPath = "C:\Program Files\OpenClaw"
    $script:ServiceName = "OpenClaw Agent"
    $script:ConfigFile = "service-config.json"
    $script:InstallerUrl = "https://raw.githubusercontent.com/BenediktSchackenberg/openclaw-windows-agent/main/Install-OpenClawAgent.ps1"
}

Describe "Install-OpenClawAgent.ps1" {
    
    Context "Script Download" {
        It "Should download installer script without errors" {
            { Invoke-RestMethod -Uri $InstallerUrl -ErrorAction Stop } | Should -Not -Throw
        }
        
        It "Should contain required functions" {
            $script = Invoke-RestMethod -Uri $InstallerUrl
            $script | Should -Match "function Install-OpenClawAgent"
            $script | Should -Match "function Get-LatestRelease"
        }
    }
    
    Context "Parameter Validation" {
        BeforeAll {
            $script:InstallerContent = Invoke-RestMethod -Uri $InstallerUrl
            # Save to temp and dot-source for testing
            $script:TempScript = Join-Path $env:TEMP "Install-OpenClawAgent.ps1"
            $InstallerContent | Out-File -FilePath $TempScript -Encoding UTF8
        }
        
        It "Should accept -GatewayUrl parameter" {
            $content = Get-Content $TempScript -Raw
            $content | Should -Match '\$GatewayUrl'
        }
        
        It "Should accept -GatewayToken parameter" {
            $content = Get-Content $TempScript -Raw
            $content | Should -Match '\$GatewayToken'
        }
        
        It "Should accept -EnrollToken parameter" {
            $content = Get-Content $TempScript -Raw
            $content | Should -Match '\$EnrollToken'
        }
        
        AfterAll {
            Remove-Item -Path $TempScript -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe "GitHub Release Integration" {
    
    Context "Release API" {
        It "Should fetch latest release info" {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/BenediktSchackenberg/openclaw-windows-agent/releases/latest" -ErrorAction SilentlyContinue
            $release | Should -Not -BeNullOrEmpty
        }
        
        It "Should have a tag_name" {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/BenediktSchackenberg/openclaw-windows-agent/releases/latest"
            $release.tag_name | Should -Match '^v?\d+\.\d+\.\d+'
        }
        
        It "Should have downloadable assets" {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/BenediktSchackenberg/openclaw-windows-agent/releases/latest"
            $release.assets.Count | Should -BeGreaterThan 0
        }
        
        It "Should have a ZIP asset" {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/BenediktSchackenberg/openclaw-windows-agent/releases/latest"
            $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" }
            $zipAsset | Should -Not -BeNullOrEmpty
        }
    }
}

Describe "Agent Service" -Tag "Integration" {
    
    Context "When agent is installed" -Skip:(-not (Test-Path $InstallPath)) {
        
        It "Should have service registered" {
            Get-Service -Name $ServiceName -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
        }
        
        It "Should have config file" {
            Test-Path (Join-Path $InstallPath $ConfigFile) | Should -BeTrue
        }
        
        It "Should have valid JSON config" {
            $configPath = Join-Path $InstallPath $ConfigFile
            { Get-Content $configPath | ConvertFrom-Json } | Should -Not -Throw
        }
        
        It "Service should be running" {
            (Get-Service -Name $ServiceName).Status | Should -Be "Running"
        }
    }
    
    Context "Config Validation" -Skip:(-not (Test-Path $InstallPath)) {
        BeforeAll {
            $script:Config = Get-Content (Join-Path $InstallPath $ConfigFile) | ConvertFrom-Json
        }
        
        It "Should have GatewayUrl configured" {
            $Config.GatewayUrl | Should -Not -BeNullOrEmpty
        }
        
        It "GatewayUrl should be valid WebSocket URL" {
            $Config.GatewayUrl | Should -Match '^wss?://'
        }
        
        It "Should have GatewayToken configured" {
            $Config.GatewayToken | Should -Not -BeNullOrEmpty
        }
    }
}

Describe "Auto-Update Mechanism" -Tag "Integration" {
    
    Context "Version Check" -Skip:(-not (Test-Path $InstallPath)) {
        
        It "Should be able to detect current version" {
            $exePath = Join-Path $InstallPath "DIOOpenClawAgent.Service.exe"
            if (Test-Path $exePath) {
                $version = (Get-Item $exePath).VersionInfo.ProductVersion
                $version | Should -Not -BeNullOrEmpty
            }
        }
        
        It "Should compare versions correctly" {
            # Test version comparison logic
            $v1 = [Version]"1.0.0"
            $v2 = [Version]"1.0.1"
            $v2 | Should -BeGreaterThan $v1
        }
    }
    
    Context "Update Download" {
        It "Should be able to download release ZIP" {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/BenediktSchackenberg/openclaw-windows-agent/releases/latest"
            $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
            
            if ($zipAsset) {
                $tempFile = Join-Path $env:TEMP "openclaw-test.zip"
                try {
                    Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $tempFile -ErrorAction Stop
                    Test-Path $tempFile | Should -BeTrue
                    (Get-Item $tempFile).Length | Should -BeGreaterThan 1000
                } finally {
                    Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
                }
            }
        }
    }
}

Describe "Hash Verification" {
    
    Context "SHA256 Checksum" {
        It "Should verify file hash correctly" {
            $testContent = "Hello OpenClaw"
            $testFile = Join-Path $env:TEMP "hashtest.txt"
            $testContent | Out-File -FilePath $testFile -Encoding UTF8 -NoNewline
            
            try {
                $hash = Get-FileHash -Path $testFile -Algorithm SHA256
                $hash.Hash | Should -Not -BeNullOrEmpty
                $hash.Hash.Length | Should -Be 64  # SHA256 = 64 hex chars
            } finally {
                Remove-Item $testFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
