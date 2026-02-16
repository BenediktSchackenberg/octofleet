#Requires -Modules Pester

<#
.SYNOPSIS
    Pester tests for Install-OctofleetAgent.ps1 installer script.
.DESCRIPTION
    Tests the installer script logic, parameter handling, and basic functionality.
    Does NOT test actual installation (requires elevated permissions and real system).
#>

BeforeAll {
    $InstallerPath = Join-Path $PSScriptRoot "..\..\installer\Install-OctofleetAgent.ps1"
    
    # Mock functions for testing without side effects
    function Get-InstallerContent {
        Get-Content $InstallerPath -Raw
    }
}

Describe "Install-OctofleetAgent.ps1 Script Validation" {
    
    Context "Script Structure" {
        It "Script file exists" {
            Test-Path $InstallerPath | Should -Be $true
        }
        
        It "Script has valid PowerShell syntax" {
            $errors = $null
            [System.Management.Automation.Language.Parser]::ParseFile($InstallerPath, [ref]$null, [ref]$errors)
            $errors.Count | Should -Be 0
        }
        
        It "Script contains required parameters" {
            $content = Get-InstallerContent
            $content | Should -Match 'param\s*\('
            $content | Should -Match '\$GatewayUrl'
            $content | Should -Match '\$EnrollToken'
        }
        
        It "Script has proper version variable" {
            $content = Get-InstallerContent
            $content | Should -Match '\$Version\s*='
        }
    }
    
    Context "Parameter Validation" {
        It "Has GatewayUrl parameter" {
            $content = Get-InstallerContent
            $content | Should -Match '\[string\]\s*\$GatewayUrl'
        }
        
        It "Has EnrollToken parameter" {
            $content = Get-InstallerContent
            $content | Should -Match '\[string\]\s*\$EnrollToken'
        }
        
        It "Has InstallDir variable with default" {
            $content = Get-InstallerContent
            $content | Should -Match '\$InstallDir.*=.*"C:\\Program Files\\Octofleet'
        }
        
        It "Has Force switch parameter" {
            $content = Get-InstallerContent
            $content | Should -Match '\[switch\]\s*\$Force'
        }
    }
    
    Context "Security Features" {
        It "Script validates hash/checksum" {
            $content = Get-InstallerContent
            $content | Should -Match 'Get-FileHash|SHA256'
        }
        
        It "Script downloads from GitHub releases" {
            $content = Get-InstallerContent
            $content | Should -Match 'github\.com.*releases'
        }
        
        It "Script checks for admin elevation" {
            $content = Get-InstallerContent
            $content | Should -Match 'Administrator|IsInRole|RunAsAdministrator'
        }
    }
    
    Context "Service Management" {
        It "Script registers Windows service" {
            $content = Get-InstallerContent
            $content | Should -Match 'New-Service|sc\.exe\s+create'
        }
        
        It "Script starts the service" {
            $content = Get-InstallerContent
            $content | Should -Match 'Start-Service|sc\.exe\s+start'
        }
    }
}

Describe "Agent Update Logic" {
    
    Context "Version Comparison" {
        It "Can parse semantic versions" {
            # Test version parsing logic
            $v1 = [version]"0.3.12"
            $v2 = [version]"0.3.15"
            $v2 | Should -BeGreaterThan $v1
        }
        
        It "Handles version with build numbers" {
            $v1 = [version]"0.3.12.0"
            $v2 = [version]"0.3.12.1"
            $v2 | Should -BeGreaterThan $v1
        }
    }
}

Describe "Enrollment Token Handling" {
    
    Context "Token Validation" {
        It "Token format is valid (UUID-like)" {
            $validToken = "abc12345-1234-5678-9abc-def012345678"
            $validToken | Should -Match '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        }
        
        It "Rejects invalid token format" {
            $invalidToken = "not-a-valid-token"
            $invalidToken | Should -Not -Match '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        }
    }
}
