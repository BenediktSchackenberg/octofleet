# Pester Tests for Octofleet Windows Agent
# Run with: Invoke-Pester -Path .\Tests\Agent.Tests.ps1 -Output Detailed

BeforeAll {
    $script:InstallPath = "C:\Program Files\Octofleet"
    $script:ServiceName = "Octofleet Agent"
    $script:ConfigFile = "service-config.json"
    $script:RepoOwner = "BenediktSchackenberg"
    $script:RepoName = "octofleet"
    $script:InstallerUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/main/Install-OctofleetAgent.ps1"
}

Describe "Install-OctofleetAgent.ps1" {
    
    Context "Script Download" {
        It "Should download installer script without errors" {
            { Invoke-RestMethod -Uri $InstallerUrl -ErrorAction Stop } | Should -Not -Throw
        }
        
        It "Should contain required functions" {
            $script = Invoke-RestMethod -Uri $InstallerUrl
            $script | Should -Match "function Install-OctofleetAgent"
            $script | Should -Match "function Get-LatestRelease"
        }
        
        It "Should contain param block" {
            $script = Invoke-RestMethod -Uri $InstallerUrl
            $script | Should -Match "param\s*\("
        }
    }
    
    Context "Parameter Validation" {
        BeforeAll {
            $script:InstallerContent = Invoke-RestMethod -Uri $InstallerUrl -ErrorAction SilentlyContinue
        }
        
        It "Should accept -GatewayUrl parameter" -Skip:(-not $InstallerContent) {
            $InstallerContent | Should -Match '\$GatewayUrl'
        }
        
        It "Should accept -GatewayToken parameter" -Skip:(-not $InstallerContent) {
            $InstallerContent | Should -Match '\$GatewayToken'
        }
        
        It "Should accept -EnrollToken parameter" -Skip:(-not $InstallerContent) {
            $InstallerContent | Should -Match '\$EnrollToken'
        }
        
        It "Should accept -InstallPath parameter" -Skip:(-not $InstallerContent) {
            $InstallerContent | Should -Match '\$InstallPath'
        }
    }
}

Describe "GitHub Release Integration" {
    
    BeforeAll {
        $script:ApiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
    }
    
    Context "Release API" {
        It "Should fetch latest release info" {
            $release = Invoke-RestMethod -Uri $ApiUrl -ErrorAction SilentlyContinue
            $release | Should -Not -BeNullOrEmpty
        }
        
        It "Should have a tag_name" {
            $release = Invoke-RestMethod -Uri $ApiUrl
            $release.tag_name | Should -Match '^v?\d+\.\d+\.\d+'
        }
        
        It "Should have downloadable assets" {
            $release = Invoke-RestMethod -Uri $ApiUrl
            $release.assets.Count | Should -BeGreaterThan 0
        }
        
        It "Should have a ZIP asset" {
            $release = Invoke-RestMethod -Uri $ApiUrl
            $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" }
            $zipAsset | Should -Not -BeNullOrEmpty
        }
    }
}

Describe "Agent Service" -Tag "Integration" {
    
    BeforeAll {
        $script:AgentInstalled = Test-Path $InstallPath
    }
    
    Context "When agent is installed" -Skip:(-not $AgentInstalled) {
        
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
    
    Context "Config Validation" -Skip:(-not $AgentInstalled) {
        BeforeAll {
            $configPath = Join-Path $InstallPath $ConfigFile
            if (Test-Path $configPath) {
                $script:Config = Get-Content $configPath | ConvertFrom-Json
            }
        }
        
        It "Should have GatewayUrl configured" -Skip:(-not $Config) {
            $Config.GatewayUrl | Should -Not -BeNullOrEmpty
        }
        
        It "GatewayUrl should be valid WebSocket URL" -Skip:(-not $Config) {
            $Config.GatewayUrl | Should -Match '^wss?://'
        }
    }
}

Describe "Auto-Update Mechanism" -Tag "Integration" {
    
    BeforeAll {
        $script:AgentInstalled = Test-Path $InstallPath
    }
    
    Context "Version Check" -Skip:(-not $AgentInstalled) {
        
        It "Should be able to detect current version" {
            $exePath = Join-Path $InstallPath "DIOOctofleetAgent.Service.exe"
            if (Test-Path $exePath) {
                $version = (Get-Item $exePath).VersionInfo.ProductVersion
                $version | Should -Not -BeNullOrEmpty
            }
        }
    }
    
    Context "Version Comparison" {
        It "Should compare versions correctly" {
            $v1 = [Version]"1.0.0"
            $v2 = [Version]"1.0.1"
            $v2 | Should -BeGreaterThan $v1
        }
        
        It "Should handle major version bumps" {
            $v1 = [Version]"1.9.9"
            $v2 = [Version]"2.0.0"
            $v2 | Should -BeGreaterThan $v1
        }
    }
    
    Context "Update Download" {
        It "Should be able to download release ZIP" {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
            $zipAsset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
            
            if ($zipAsset) {
                $tempFile = Join-Path $env:TEMP "octofleet-test-$([Guid]::NewGuid().ToString('N').Substring(0,8)).zip"
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
            $testContent = "Hello Octofleet"
            $testFile = Join-Path $env:TEMP "hashtest-$([Guid]::NewGuid().ToString('N').Substring(0,8)).txt"
            
            try {
                $testContent | Out-File -FilePath $testFile -Encoding UTF8 -NoNewline
                $hash = Get-FileHash -Path $testFile -Algorithm SHA256
                $hash.Hash | Should -Not -BeNullOrEmpty
                $hash.Hash.Length | Should -Be 64  # SHA256 = 64 hex chars
            } finally {
                Remove-Item $testFile -Force -ErrorAction SilentlyContinue
            }
        }
        
        It "Should produce consistent hashes" {
            $content = "Test content for hashing"
            $file1 = Join-Path $env:TEMP "hash1-$([Guid]::NewGuid().ToString('N').Substring(0,8)).txt"
            $file2 = Join-Path $env:TEMP "hash2-$([Guid]::NewGuid().ToString('N').Substring(0,8)).txt"
            
            try {
                $content | Out-File -FilePath $file1 -Encoding UTF8 -NoNewline
                $content | Out-File -FilePath $file2 -Encoding UTF8 -NoNewline
                
                $hash1 = (Get-FileHash -Path $file1 -Algorithm SHA256).Hash
                $hash2 = (Get-FileHash -Path $file2 -Algorithm SHA256).Hash
                
                $hash1 | Should -Be $hash2
            } finally {
                Remove-Item $file1, $file2 -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
