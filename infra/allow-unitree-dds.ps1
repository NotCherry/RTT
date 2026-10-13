# Run in an elevated Windows PowerShell session for WSL mirrored networking.
# Restrict inbound DDS to one robot-facing interface; preserve defaults.
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$LocalAddress = '192.168.123.200',
    [string[]]$RobotAddresses = @('192.168.123.161', '192.168.123.164'),
    [string]$InterfaceAlias = 'Ethernet',
    [ValidatePattern('^RTT-Unitree-DDS-[A-Za-z0-9-]+$')]
    [string]$RuleName = 'RTT-Unitree-DDS-Inbound',
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $WhatIfPreference -and
    -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script in Windows PowerShell as Administrator.'
}

$wslCreator = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$destinations = @($LocalAddress, '239.255.0.1')
# CycloneDDS uses 7400/7401 for domain-zero discovery/multicast and may
# allocate ephemeral unicast ports. Limit sources instead of assuming fixed ports.
$ports = '7400-65535'

if ($Remove) {
    if ($PSCmdlet.ShouldProcess($ruleName, 'Remove Windows and WSL DDS rules')) {
        if (Get-NetFirewallHyperVRule -Name $ruleName -ErrorAction SilentlyContinue) {
            Remove-NetFirewallHyperVRule -Name $ruleName
        }
        if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
            Remove-NetFirewallRule -Name $ruleName
        }
    }
    return
}

if ($PSCmdlet.ShouldProcess($ruleName, 'Allow robot UDP in Windows and WSL')) {
    $hyperV = @{
        Name = $ruleName
        Direction = 'Inbound'
        Protocol = 'UDP'
        LocalAddresses = $destinations
        LocalPorts = $ports
        RemoteAddresses = $RobotAddresses
        Action = 'Allow'
        Enabled = 'True'
    }
    if (Get-NetFirewallHyperVRule -Name $ruleName -ErrorAction SilentlyContinue) {
        Set-NetFirewallHyperVRule @hyperV | Out-Null
    } else {
        New-NetFirewallHyperVRule @hyperV -DisplayName 'RTT Unitree DDS' `
            -VMCreatorId $wslCreator | Out-Null
    }

    $windows = @{
        Name = $ruleName
        Direction = 'Inbound'
        Protocol = 'UDP'
        LocalAddress = $destinations
        LocalPort = $ports
        RemoteAddress = $RobotAddresses
        InterfaceAlias = $InterfaceAlias
        Profile = 'Any'
        Action = 'Allow'
        Enabled = 'True'
    }
    if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule @windows | Out-Null
    } else {
        New-NetFirewallRule @windows -DisplayName 'RTT Unitree DDS' | Out-Null
    }
    Write-Output 'Robot DDS rules applied. Check measured state in RTT; keep control disarmed.'
}
