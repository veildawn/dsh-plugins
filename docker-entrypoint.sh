#!/bin/sh
set -eu

: "${DSH_PORT:=3080}"
: "${DSH_HOME:=/home/node/.dsh}"

# The seed is the profile built into the image. A mount on DSH_HOME hides it,
# so copy only when this volume has no web profile yet. An existing profile
# keeps its cordis.patch.yml; the sync below updates bundled plugins in place.
if [ ! -f "${DSH_HOME}/profiles/web/package.json" ]; then
  mkdir -p "${DSH_HOME}"
  cp -a /opt/dsh-home-seed/. "${DSH_HOME}/"
fi

node /usr/local/lib/docker-sync-plugins.mjs

# Resolve after the sync so a bad DSH_PORT fails before DSH is started.
DSH_UPSTREAM_PORT=$(node /usr/local/lib/docker-ports.mjs)
export DSH_UPSTREAM_PORT

# DSH's web CLI binds loopback only. The proxy publishes that listener.
# --no-open skips the desktop browser launch, which a container cannot do.
dsh --profile web \
  --port "${DSH_UPSTREAM_PORT}" \
  --no-open \
  --trusted-host "localhost:${DSH_PORT}" \
  --trusted-host "127.0.0.1:${DSH_PORT}" \
  "$@" &
dsh_pid=$!

node /usr/local/lib/docker-proxy.mjs &
proxy_pid=$!

stop() {
  kill -TERM "$dsh_pid" "$proxy_pid" 2>/dev/null || true
  wait "$dsh_pid" 2>/dev/null || true
  wait "$proxy_pid" 2>/dev/null || true
}

trap 'stop; exit 0' INT TERM

# Leave if either child exits, so a proxy bind failure does not look healthy.
while kill -0 "$dsh_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  sleep 1
done

exit_code=0
if ! kill -0 "$dsh_pid" 2>/dev/null; then
  wait "$dsh_pid" || exit_code=$?
elif ! kill -0 "$proxy_pid" 2>/dev/null; then
  wait "$proxy_pid" || exit_code=$?
fi
stop
exit "$exit_code"
