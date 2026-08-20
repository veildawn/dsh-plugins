<#
.SYNOPSIS
  Start, stop, restart, or check a DSH profile process on Windows.

.DESCRIPTION
  The `dsh` CLI shipped in this workspace (@deepseek-ai/dsh) has no `service`
  subcommand — only the root boot command, `web`, and `plugin` (see
  `dsh --help`). "dsh service restart", which every plugin README quotes as
  the post-install step, does not exist on Windows: there is no systemd/
  launchd equivalent bundled, and running it errors out with
  "too many arguments. Expected 0 arguments but got 2: service, restart.".

  This script does the same job by hand: find the running `dsh <profile>`
  node process (started via `dsh.cmd`/`dsh.ps1`), and start, stop, restart, or
  report on it.

.PARAMETER Action
  One of start, stop, restart, status. Defaults to status.

.PARAMETER Profile
  The profile name under $DSH_HOME/profiles to manage. Defaults to "web".

.PARAMETER Background
  For start/restart: redirect the new process's stdout/stderr to
  $DSH_HOME/logs/<profile>-<timestamp>.{out,err}.log instead of opening a new
  console window.

.EXAMPLE
  ./scripts/dsh-service.ps1 status
  Show whether the "web" profile is running and which port it's listening on.

.EXAMPLE
  ./scripts/dsh-service.ps1 restart -Profile web -Background
  Restart the "web" profile detached, logging to $DSH_HOME/logs.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "status",

    [string]$Profile = "web",

    [switch]$Background
)

$ErrorActionPreference = "Stop"

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }

# Booted via dsh.cmd/dsh.ps1 -> node.exe .../@deepseek-ai/dsh/lib/bin.js <profile>
# Matched on the profile name too (not just "any dsh process"), so managing one
# profile does not touch another profile's process on the same machine.
function Get-DshProcesses {
    param([string]$ProfileName)
    $needle = [regex]::Escape("@deepseek-ai\dsh\lib\bin.js")
    $profilePattern = "\b" + [regex]::Escape($ProfileName) + "\b\s*$"
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match $needle -and $_.CommandLine -match $profilePattern }
}

function Show-Status {
    param([string]$ProfileName)
    $processes = Get-DshProcesses -ProfileName $ProfileName
    if ($processes) {
        Write-Host "[+] dsh $ProfileName is running:" -ForegroundColor Green
        foreach ($proc in $processes) {
            $mem = [math]::Round($proc.WorkingSetSize / 1MB, 2)
            Write-Host "    - PID $($proc.ProcessId) (mem: $mem MB)"
            $conns = Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen -ErrorAction SilentlyContinue
            foreach ($conn in $conns) {
                $addr = if ($conn.LocalAddress -in @("0.0.0.0", "::")) { "127.0.0.1" } else { $conn.LocalAddress }
                Write-Host "      listening on http://$($addr):$($conn.LocalPort)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "[-] dsh $ProfileName is not running" -ForegroundColor Yellow
    }
    return $processes
}

function Stop-Dsh {
    param([string]$ProfileName)
    $processes = Get-DshProcesses -ProfileName $ProfileName
    if (-not $processes) {
        Write-Host "[!] No running 'dsh $ProfileName' process found" -ForegroundColor Gray
        return
    }
    foreach ($proc in $processes) {
        Write-Host "Stopping PID $($proc.ProcessId): $($proc.CommandLine)"
        Stop-Process -Id $proc.ProcessId -Force
    }
    Start-Sleep -Seconds 1
}

function Start-Dsh {
    param([string]$ProfileName, [switch]$Bg)

    if (Get-DshProcesses -ProfileName $ProfileName) {
        Write-Host "[!] dsh $ProfileName is already running. Use 'restart' instead." -ForegroundColor Yellow
        return
    }

    # `dsh` on PATH resolves to the extensionless POSIX shim; Start-Process
    # needs the actual Win32-launchable file, which is dsh.cmd (or dsh.ps1)
    # next to it.
    $dshCmd = Get-Command "dsh.cmd" -ErrorAction SilentlyContinue
    if (-not $dshCmd) { $dshCmd = Get-Command "dsh.ps1" -ErrorAction SilentlyContinue }
    if (-not $dshCmd) {
        throw "Could not find dsh.cmd or dsh.ps1 on PATH. Is the dsh CLI installed for this shell?"
    }
    $dshPath = $dshCmd.Source

    Write-Host "Starting 'dsh $ProfileName'..."
    if ($Bg) {
        $logDir = Join-Path $dshHome "logs"
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $outLog = Join-Path $logDir "$ProfileName-$stamp.out.log"
        $errLog = Join-Path $logDir "$ProfileName-$stamp.err.log"
        Start-Process -FilePath $dshPath -ArgumentList $ProfileName -WindowStyle Hidden `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog
        Write-Host "Started in background."
        Write-Host "  stdout: $outLog"
        Write-Host "  stderr: $errLog"
    } else {
        Start-Process -FilePath $dshPath -ArgumentList $ProfileName
        Write-Host "Started in a new console window."
    }

    Start-Sleep -Seconds 2
    if (Get-DshProcesses -ProfileName $ProfileName) {
        Write-Host "[+] dsh $ProfileName started" -ForegroundColor Green
    } else {
        Write-Host "[!] Startup may still be in progress; check again with '$($MyInvocation.MyCommand.Name) status'" -ForegroundColor Yellow
    }
}

switch ($Action) {
    "start"   { Start-Dsh -ProfileName $Profile -Bg:$Background }
    "stop"    { Stop-Dsh -ProfileName $Profile }
    "restart" {
        Stop-Dsh -ProfileName $Profile
        Start-Sleep -Seconds 1
        Start-Dsh -ProfileName $Profile -Bg:$Background
    }
    "status"  { Show-Status -ProfileName $Profile | Out-Null }
}
