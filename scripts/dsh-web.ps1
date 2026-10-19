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
    [string]$Action = "status",
    # `dsh web` 默认启动 web profile；端口以该 profile 的 cordis.patch.yml 为准。
    [string]$Profile = "web"
)

# 从 profile 的 patch 里读 webserver 端口；`!!js` 表达式（如
# `ctx.webStartup.port ?? 3080`）取不到字面量，回落到 3080。
function Get-DshPort {
    $home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
    $patch = Join-Path $home_ "profiles\$Profile\cordis.patch.yml"
    if (Test-Path $patch) {
        $inWebserver = $false
        foreach ($line in Get-Content $patch) {
            if ($line -match '^\s*-\s+id:\s*[''"]?webserver[''"]?') { $inWebserver = $true; continue }
            if ($inWebserver -and $line -match '^\s*-\s+id:') { $inWebserver = $false }
            if ($inWebserver -and $line -match '^\s+port:\s*(\d+)\s*$') { return [int]$Matches[1] }
        }
    }
    return 3080
}

# 找一个当前没人监听的 TCP 端口（默认从 3080 起，最多试 50 个）。
function Get-FreePort([int]$start = 3080) {
    for ($p = $start; $p -lt $start + 50; $p++) {
        if (-not (Get-PortOwner $p)) { return $p }
    }
    return 0
}

# 端口是否已被别的进程占用；返回占用者 PID，空闲时返回 $null。
function Get-PortOwner([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

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
        # 以进程实际监听的端口为准：配置里的端口可能被 --port 覆盖，
        # 而 3080 有时其实属于桌面端进程，直接读配置会把别人的端口当成自己的。
        $owned = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -in $processes.Id }
        $loopback = $owned | Where-Object { $_.LocalAddress -match '^(127\.|::1$)' }
        if ($loopback) {
            foreach ($conn in $loopback) {
                Write-Host "    - 监听地址: Host: $($conn.LocalAddress) | Port: $($conn.LocalPort) (http://127.0.0.1:$($conn.LocalPort))" -ForegroundColor Cyan
            }
        } else {
            Write-Host "    - 尚未监听回环端口（启动中）" -ForegroundColor Gray
        }
        # 局域网入口：宿主绑回环时由 remote-control 插件的反代端口提供
        $lan = $owned | Where-Object { $_.LocalAddress -notmatch '^(127\.|::1$|0\.0\.0\.0$|::$)' }
        foreach ($conn in $lan) {
            Write-Host "    - 局域网入口: http://$($conn.LocalAddress):$($conn.LocalPort)" -ForegroundColor Cyan
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
    $port = Get-DshPort
    $processes = Get-DshProcesses
    if ($processes) {
        Write-Host "[!] DSH Web 已经在运行中 (PID: $($processes.Id -join ', '))" -ForegroundColor Yellow
        Write-Host "    如果需要重启，请运行: .\dsh-web.ps1 restart" -ForegroundColor Gray
        return
    }

    # 端口被占用时不该让宿主抛 EADDRINUSE 再连带 20 多个插件失败：
    # 空闲就用配置的端口，被占就换成下一个空闲端口并通过 --port 传进去。
    $wanted = Get-DshPort
    $port = if (Get-PortOwner $wanted) { Get-FreePort ($wanted + 1) } else { $wanted }
    if ($port -eq 0) {
        Write-Host "[-] $wanted 起 50 个端口都被占用，无法启动" -ForegroundColor Red
        return
    }
    if ($port -ne $wanted) {
        $owner = Get-PortOwner $wanted
        $name = try { (Get-Process -Id $owner -ErrorAction Stop).ProcessName } catch { "未知进程" }
        Write-Host "[!] 端口 $wanted 已被占用 (PID: $owner, $name)，改用 $port" -ForegroundColor Yellow
    }
    # 局域网反代端口同理：默认 3091，被占就让插件换一个
    $lanWanted = if ($port -eq 3080) { 3081 } else { 3091 }
    $lanPort = if (Get-PortOwner $lanWanted) { Get-FreePort ($lanWanted + 1) } else { $lanWanted }
    $env:DSH_LAN_PORT = [string]$lanPort

    Write-Host "[*] 正在后台启动 dsh web (端口 $port, 局域网 $lanPort)..." -ForegroundColor Cyan
    # 显式使用 dsh.cmd：nvm4w 目录下还有一个同名的无扩展名文件（Unix shell 脚本），
    # Start-Process 按 ShellExecute 解析会精确匹配到它而不是按 PATHEXT 找 .cmd/.ps1，
    # 导致系统用未知文件类型的默认程序打开它（而不是执行 dsh），启动检测因此总是失败。
    $dshCmd = Get-Command "dsh.cmd" -ErrorAction SilentlyContinue
    if (-not $dshCmd) {
        Write-Host "[-] 未找到 dsh.cmd，请确认 dsh 已正确安装并在 PATH 中" -ForegroundColor Red
        return
    }
    Start-Process -FilePath $dshCmd.Source -ArgumentList "--profile", $Profile, "--port", $port, "--no-open" -WindowStyle Hidden

    # 进程立刻就有，但端口要等宿主把 20 多个插件装配完才监听；
    # 固定 sleep 两秒会把「还在启动」误报成「启动成功」。
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if (-not (Get-DshProcesses)) { break }
        if (Get-PortOwner $port) {
            Write-Host "[+] DSH Web 启动成功！" -ForegroundColor Green
            Show-Status
            return
        }
    }

    if (Get-DshProcesses) {
        Write-Host "[!] 进程在跑但 $port 还没监听，可能仍在装配插件；稍后用 status 复查" -ForegroundColor Yellow
    } else {
        Write-Host "[-] 启动失败，进程已退出" -ForegroundColor Red
        # 宿主的启动失败诊断落在 ~/.dsh/logs/startup-*.log，直接指出来省一次猜测
        $home_ = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
        $latest = Get-ChildItem (Join-Path $home_ "logs") -Filter 'startup-*.log' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) { Write-Host "    最新诊断: $($latest.FullName)" -ForegroundColor Gray }
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
