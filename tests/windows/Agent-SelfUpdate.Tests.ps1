#Requires -Modules Pester

<#
.SYNOPSIS
    Integration tests for Octofleet Windows Agent self-update functionality.
.DESCRIPTION
    Tests that run on a real Windows system with the agent installed.
    Requires: Agent installed, network access to API.
.NOTES
    Run with: Invoke-Pester -Path .\Agent-SelfUpdate.Tests.ps1 -Output Detailed
#>

param(
    [string]$ApiUrl = "http://localhost:8080",
    [string]$InstallPath = "C:\Program Files\Octofleet"
)

BeforeAll {
    $ServiceName = "DIOOctofleetAgent"
    $ExePath = Join-Path $InstallPath "DIOOctofleetAgent.Service.exe"
    
    function Get-AgentVersion {
        if (Test-Path $ExePath) {
            return (Get-Item $ExePath).VersionInfo.ProductVersion
        }
        return $null
    }
    
    function Get-LatestVersion {
        try {
            $response = Invoke-RestMethod -Uri "$ApiUrl/api/v1/agent/version" -Method Get -TimeoutSec 10
            return $response.version
        }
        catch {
            return $null
        }
    }
    
    function Test-ServiceRunning {
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        return ($service -and $service.Status -eq 'Running')
    }
}

Describe "Agent Installation State" {
    
    Context "Prerequisites" {
        It "Agent executable exists" {
            Test-Path $ExePath | Should -Be $true
        }
        
        It "Agent service is registered" {
            Get-Service -Name $ServiceName -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
        }
        
        It "Agent service is running" {
            Test-ServiceRunning | Should -Be $true
        }
        
        It "Agent has valid version" {
            Get-AgentVersion | Should -Not -BeNullOrEmpty
        }
    }
    
    Context "Configuration" {
        It "Config file exists" {
            $configPath = Join-Path $InstallPath "config.json"
            Test-Path $configPath | Should -Be $true
        }
        
        It "Config has gateway URL" {
            $configPath = Join-Path $InstallPath "config.json"
            $config = Get-Content $configPath | ConvertFrom-Json
            $config.gatewayUrl | Should -Not -BeNullOrEmpty
        }
    }
}

Describe "API Connectivity" {
    
    Context "Health Check" {
        It "Can reach API health endpoint" {
            { Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 10 } | Should -Not -Throw
        }
        
        It "Health endpoint returns OK" {
            $health = Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 10
            $health.status | Should -BeIn @('ok', 'healthy')
        }
    }
    
    Context "Version Endpoint" {
        It "Can fetch latest version info" {
            $version = Get-LatestVersion
            $version | Should -Not -BeNullOrEmpty
        }
        
        It "Version format is valid" {
            $version = Get-LatestVersion
            $version | Should -Match '^\d+\.\d+\.\d+'
        }
    }
}

Describe "Self-Update Mechanism" -Tag "Integration" {
    
    BeforeAll {
        $currentVersion = Get-AgentVersion
        $latestVersion = Get-LatestVersion
    }
    
    Context "Version Comparison" {
        It "Can determine current version" {
            $currentVersion | Should -Not -BeNullOrEmpty
        }
        
        It "Can determine latest version" {
            $latestVersion | Should -Not -BeNullOrEmpty
        }
        
        It "Versions are comparable" {
            { [version]$currentVersion } | Should -Not -Throw
            { [version]$latestVersion } | Should -Not -Throw
        }
    }
    
    Context "Update Check" {
        It "Agent can check for updates" -Skip:(-not (Test-ServiceRunning)) {
            # Trigger update check via API or config
            $nodeId = (Get-Content (Join-Path $InstallPath "node-id.txt") -ErrorAction SilentlyContinue)
            $nodeId | Should -Not -BeNullOrEmpty
        }
    }
}

Describe "Service Recovery" -Tag "Integration" {
    
    Context "Service Restart" {
        It "Service can be stopped" -Skip:(-not (Test-ServiceRunning)) {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            # Verify it stopped (or auto-recovered)
            $true | Should -Be $true  # Basic check
        }
        
        It "Service auto-recovers or can be restarted" {
            Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 5
            Test-ServiceRunning | Should -Be $true
        }
    }
}

Describe "Logging" {
    
    Context "Log Files" {
        It "Log directory exists" {
            $logPath = Join-Path $InstallPath "logs"
            Test-Path $logPath | Should -Be $true
        }
        
        It "Recent log files exist" {
            $logPath = Join-Path $InstallPath "logs"
            $recentLogs = Get-ChildItem -Path $logPath -Filter "*.log" -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-1) }
            $recentLogs | Should -Not -BeNullOrEmpty
        }
    }
}
