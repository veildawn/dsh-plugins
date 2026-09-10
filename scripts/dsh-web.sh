#!/usr/bin/env bash
#
# DeepSeek Harness (dsh web) 控制脚本（macOS / Linux 维护者用）
# 支持启动、停止、重启、状态查询。
#
# 普通用户请改用 launchd LaunchAgent（scripts/com.deepseek.dsh-web.plist），
# 不要依赖本脚本。插件平滑重启只在设置了 DSH_PLUGINS_REPO 时才会调用它。
#
# 用法:
#   ./scripts/dsh-web.sh start    # 后台启动 dsh web
#   ./scripts/dsh-web.sh stop     # 停止 dsh web
#   ./scripts/dsh-web.sh restart  # 重启 dsh web
#   ./scripts/dsh-web.sh status   # 检查运行状态与端口
#

ACTION="${1:-status}"
PORT="${DSH_PORT:-3080}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
LOG_DIR="$DSH_HOME/logs"

green() { printf '%s\n' "$1"; }
if [ -t 1 ]; then
  green() { printf '\033[32m%s\033[0m\n' "$1"; }
  yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
  cyan() { printf '\033[36m%s\033[0m\n' "$1"; }
  red() { printf '\033[31m%s\033[0m\n' "$1"; }
else
  yellow() { printf '%s\n' "$1"; }
  cyan() { printf '%s\n' "$1"; }
  red() { printf '%s\n' "$1"; }
fi

get_dsh_pids() {
  # 1. 优先通过端口监听确认当前正占用的 PID
  if command -v lsof >/dev/null 2>&1; then
    local port_pids
    port_pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$port_pids" ]; then
      printf '%s\n' "$port_pids"
      return 0
    fi
  fi

  # 2. ps 命令参数匹配
  local ps_pids
  ps_pids=$(ps -eo pid,args 2>/dev/null | grep -E '[d]sh.*web' | awk '{print $1}' || true)
  if [ -n "$ps_pids" ]; then
    printf '%s\n' "$ps_pids"
    return 0
  fi

  # 3. pgrep 兜底
  pgrep -f '(^|/)dsh([[:space:]].*)?[[:space:]]web([[:space:]]|$)|@deepseek-ai/dsh.*[[:space:]]web([[:space:]]|$)|dsh/lib/bin\.js.*[[:space:]]web([[:space:]]|$)' 2>/dev/null || true
}

show_status() {
  local pids
  pids=$(get_dsh_pids)
  if [ -n "$pids" ]; then
    green "[+] DSH Web 正在运行中:"
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        local cmd
        cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
        printf '    - PID: %s (%s)\n' "$pid" "$cmd"
      fi
    done

    if command -v lsof >/dev/null 2>&1; then
      if lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
        cyan "    - 监听端口: $PORT (http://127.0.0.1:$PORT)"
      fi
    fi
  else
    yellow "[-] DSH Web 未运行"
  fi
}

stop_dsh() {
  local pids
  pids=$(get_dsh_pids)
  if [ -n "$pids" ]; then
    yellow "[*] 正在停止 DSH Web 进程..."
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
      printf '    - 已发送终止信号给 PID: %s\n' "$pid"
    done
    sleep 1.5
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
        printf '    - 强制终止 PID: %s\n' "$pid"
      fi
    done
    green "[+] DSH Web 已停止"
  else
    printf '%s\n' "[!] 未发现正在运行的 DSH Web 进程"
  fi
}

start_dsh() {
  local pids
  pids=$(get_dsh_pids)
  if [ -n "$pids" ]; then
    yellow "[!] DSH Web 已经在运行中 (PID: $(printf '%s ' $pids))"
    printf '    如果需要重启，请运行: %s restart\n' "$0"
    return 0
  fi

  if ! command -v dsh >/dev/null 2>&1; then
    red "[-] 未找到 dsh 命令，请确认 @deepseek-ai/dsh 已全局安装并在 PATH 中"
    exit 1
  fi

  mkdir -p "$LOG_DIR"
  local log_file="$LOG_DIR/web.log"
  cyan "[*] 正在后台启动 dsh web (日志: $log_file)..."

  nohup dsh --profile web --no-open >> "$log_file" 2>&1 &
  local new_pid=$!
  sleep 2

  if kill -0 "$new_pid" 2>/dev/null; then
    green "[+] DSH Web 启动成功！(PID: $new_pid)"
    show_status
  else
    yellow "[-] 启动可能需要更多时间或出现异常，请稍后检查日志: $log_file"
  fi
}

case "$ACTION" in
  start)
    start_dsh
    ;;
  stop)
    stop_dsh
    ;;
  restart)
    cyan "=== 正在重启 DSH Web ==="
    stop_dsh
    sleep 1
    start_dsh
    ;;
  status)
    show_status
    ;;
  *)
    printf '用法: %s {start|stop|restart|status}\n' "$0"
    exit 1
    ;;
esac
