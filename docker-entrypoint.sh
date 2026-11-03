#!/bin/sh
set -eu

: "${DSH_PORT:=3080}"

# The current DSH web CLI intentionally permits only a loopback bind. The
# proxy makes that service reachable through Docker's published port while the
# recommended run command still publishes it only to the host loopback.
dsh --profile web \
  --port 3081 \
  --trusted-host "localhost:${DSH_PORT}" \
  --trusted-host "127.0.0.1:${DSH_PORT}" \
  "$@" &
dsh_pid=$!

node /usr/local/lib/dsh-proxy.mjs &
proxy_pid=$!

stop() {
  kill -TERM "$dsh_pid" "$proxy_pid" 2>/dev/null || true
  wait "$dsh_pid" 2>/dev/null || true
  wait "$proxy_pid" 2>/dev/null || true
}

trap 'stop; exit 0' INT TERM

wait "$dsh_pid"
exit_code=$?
kill -TERM "$proxy_pid" 2>/dev/null || true
wait "$proxy_pid" 2>/dev/null || true
exit "$exit_code"
