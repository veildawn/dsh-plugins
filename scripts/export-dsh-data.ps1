<#
.SYNOPSIS
    DSH 数据与配置一键导出脚本（用于迁移至远程/Linux 128 主机）
.DESCRIPTION
    打包本机 ~/.dsh 下的所有核心配置、工作区元数据、会话历史、附件以及角色预设，
    排除 logs、node_modules 等平台相关的缓存与临时文件。
#>

param (
    [string]$OutputPath = "dsh-migration-package.tar.gz"
)

$ErrorActionPreference = "Stop"
$dshDir = "$env:USERPROFILE\.dsh"
$tempExportDir = "$env:TEMP\dsh-export-" + (Get-Date -Format "yyyyMMddHHmmss")

Write-Host "[*] 正在准备导出 DSH 数据..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $tempExportDir | Out-Null

try {
    # 1. 核心配置文件
    if (Test-Path "$dshDir\settings.yaml") {
        Copy-Item "$dshDir\settings.yaml" "$tempExportDir\" -Force
        Write-Host "  [+] 已导出 settings.yaml" -ForegroundColor Green
    }
    if (Test-Path "$dshDir\.credentials.yaml") {
        Copy-Item "$dshDir\.credentials.yaml" "$tempExportDir\" -Force
        Write-Host "  [+] 已导出 .credentials.yaml" -ForegroundColor Green
    }

    # 2. 预设角色
    if (Test-Path "$dshDir\.agent-presets") {
        Copy-Item "$dshDir\.agent-presets" "$tempExportDir\.agent-presets" -Recurse -Force
        Write-Host "  [+] 已导出 .agent-presets" -ForegroundColor Green
    }

    # 3. 存储与工作区配置
    if (Test-Path "$dshDir\storages") {
        Copy-Item "$dshDir\storages" "$tempExportDir\storages" -Recurse -Force
        Write-Host "  [+] 已导出 storages" -ForegroundColor Green
    }

    # 4. 会话历史
    if (Test-Path "$dshDir\sessions") {
        Copy-Item "$dshDir\sessions" "$tempExportDir\sessions" -Recurse -Force
        Write-Host "  [+] 已导出 sessions" -ForegroundColor Green
    }

    # 5. 附件数据
    if (Test-Path "$dshDir\attachments") {
        Copy-Item "$dshDir\attachments" "$tempExportDir\attachments" -Recurse -Force
        Write-Host "  [+] 已导出 attachments" -ForegroundColor Green
    }

    # 6. 打包归档 (Windows native tar / PowerShell Compress)
    Write-Host "[*] 正在压缩为 $OutputPath ..." -ForegroundColor Cyan
    
    # 优先使用 Windows 内置 tar.exe，避免 Git Bash tar 解析冒号为远程主机
    $systemTar = "$env:SystemRoot\System32\tar.exe"
    if (Test-Path $systemTar) {
        & $systemTar -czvf "$OutputPath" -C "$tempExportDir" .
    } else {
        tar -czvf "$OutputPath" -C "$tempExportDir" .
    }
    
    if (Test-Path "$OutputPath") {
        $size = (Get-Item "$OutputPath").Length / 1MB
        Write-Host "[+] 导出完成！归档文件: $OutputPath (大小: $([math]::Round($size, 2)) MB)" -ForegroundColor Green
    } else {
        Write-Host "[-] 导出未成功生成文件" -ForegroundColor Red
    }
} finally {
    Remove-Item -Path $tempExportDir -Recurse -Force -ErrorAction SilentlyContinue
}
