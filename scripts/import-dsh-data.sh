#!/usr/bin/env bash
# DSH 数据导入与插件安装脚本 (在 128 Linux 主机上执行)
set -e

ARCHIVE_FILE="${1:-dsh-migration-package.tar.gz}"
DSH_DIR="${HOME}/.dsh"

if [ ! -f "$ARCHIVE_FILE" ]; then
  echo "[-] 找不到迁移归档文件: $ARCHIVE_FILE"
  echo "用法: bash import-dsh-data.sh [dsh-migration-package.tar.gz]"
  exit 1
fi

echo "[*] 正在准备解压数据到 $DSH_DIR ..."
mkdir -p "$DSH_DIR"

# 1. 解压核心数据
tar -xzvf "$ARCHIVE_FILE" -C "$DSH_DIR"
echo "[+] 核心配置、会话记录、附件及角色预设已就绪"

# 2. 安装 6 个远程插件
echo "[*] 正在通过 GitHub 远程源安装全量插件..."
dsh plugin add --profile web \
  github:veildawn/dsh-plugins#path:/plugins/dsh-ai-proxy \
  github:veildawn/dsh-plugins#path:/plugins/dsh-file-viewer \
  github:veildawn/dsh-plugins#path:/plugins/dsh-mobile-adapter \
  github:veildawn/dsh-plugins#path:/plugins/dsh-model-roles \
  github:veildawn/dsh-plugins#path:/plugins/dsh-remote-control \
  github:veildawn/dsh-plugins#path:/plugins/dsh-terminal

echo "[+] 插件安装完成！"
echo "[*] 可通过 'dsh web' 启动服务。"
