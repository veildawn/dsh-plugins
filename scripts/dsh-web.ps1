<#
.SYNOPSIS
    DeepSeek Harness (dsh web) 控制脚本：支持启动、停止、重启、状态查询。

.EXAMPLE
    .\dsh-web.ps1 start      # 后台启动 dsh web
    .\dsh-web.ps1 stop       # 停止 dsh web
    .\dsh-web.ps1 restart    # 重启 dsh web
    .\dsh-web.ps1 status     # 检查运行状态与端口
#>

param (
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "status"
)

function Get-DshProcesses {
    Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        $cmd = ""
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        } catch { }
        
        if (-not $cmd) {
            $cmd = $_.CommandLine
        }
        $cmd -match "(@deepseek-ai[\\/]dsh|dsh[\\/]lib[\\/]bin\.js)"
    }
}

function Show-Status {
    $processes = Get-DshProcesses
    if ($processes) {
        Write-Host "[+] DSH Web 正在运行中:" -ForegroundColor Green
        foreach ($proc in $processes) {
            Write-Host "    - PID: $($proc.Id) (内存: $([math]::Round($proc.WorkingSet64 / 1MB, 2)) MB)"
        }
        $connections = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
        if ($connections) {
            foreach ($conn in $connections) {
                $hostAddr = $conn.LocalAddress
                $displayUrl = if ($hostAddr -eq "0.0.0.0" -or $hostAddr -eq "::") {
                    "http://127.0.0.1:$($conn.LocalPort)"
                } else {
                    "http://$($hostAddr):$($conn.LocalPort)"
                }
                Write-Host "    - 监听地址: Host: $hostAddr | Port: $($conn.LocalPort) ($displayUrl)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "[-] DSH Web 未运行" -ForegroundColor Yellow
    }
}

function Stop-Dsh {
    $processes = Get-DshProcesses
    if ($processes) {
        Write-Host "[*] 正在停止 DSH Web 进程..." -ForegroundColor Yellow
        foreach ($proc in $processes) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Host "    - 已终止 PID: $($proc.Id)" -ForegroundColor Gray
            } catch {
                Write-Host "    - 无法终止 PID: $($proc.Id): $_" -ForegroundColor Red
            }
        }
        Start-Sleep -Seconds 1
        Write-Host "[+] DSH Web 已停止" -ForegroundColor Green
    } else {
        Write-Host "[!] 未发现正在运行的 DSH Web 进程" -ForegroundColor Gray
    }
}

function Start-Dsh {
    $processes = Get-DshProcesses
    if ($processes) {
        Write-Host "[!] DSH Web 已经在运行中 (PID: $($processes.Id -join ', '))" -ForegroundColor Yellow
        Write-Host "    如果需要重启，请运行: .\dsh-web.ps1 restart" -ForegroundColor Gray
        return
    }

    Write-Host "[*] 正在后台启动 dsh web..." -ForegroundColor Cyan
    # 显式使用 dsh.cmd：nvm4w 目录下还有一个同名的无扩展名文件（Unix shell 脚本），
    # Start-Process 按 ShellExecute 解析会精确匹配到它而不是按 PATHEXT 找 .cmd/.ps1，
    # 导致系统用未知文件类型的默认程序打开它（而不是执行 dsh），启动检测因此总是失败。
    $dshCmd = Get-Command "dsh.cmd" -ErrorAction SilentlyContinue
    if (-not $dshCmd) {
        Write-Host "[-] 未找到 dsh.cmd，请确认 dsh 已正确安装并在 PATH 中" -ForegroundColor Red
        return
    }
    Start-Process -FilePath $dshCmd.Source -ArgumentList "web" -WindowStyle Hidden
    
    Start-Sleep -Seconds 2
    $newProcs = Get-DshProcesses
    if ($newProcs) {
        Write-Host "[+] DSH Web 启动成功！" -ForegroundColor Green
        Show-Status
    } else {
        Write-Host "[-] 启动可能需要更多时间或出现异常，请稍后使用 .\dsh-web.ps1 status 检查" -ForegroundColor Yellow
    }
}

switch ($Action) {
    "start" {
        Start-Dsh
    }
    "stop" {
        Stop-Dsh
    }
    "restart" {
        Write-Host "=== 正在重启 DSH Web ===" -ForegroundColor Cyan
        Stop-Dsh
        Start-Sleep -Seconds 1
        Start-Dsh
    }
    "status" {
        Show-Status
    }
}
