#!/bin/sh
# Post-restart verification for the installed dsh-ai-proxy plugin.
# Usage: sh test/verify-live.sh [web-url]   (default http://127.0.0.1:65148)
set -u
URL="${1:-http://127.0.0.1:65148}"
echo "== plugin inventory ("$URL") =="
INVENTORY=$(curl -s -m 5 -X POST "$URL/api/pluginInventory/list" \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"verify-live","method":"pluginInventory/list","payload":{"args":{}}}')
MATCH=$(printf '%s' "$INVENTORY" \
  | grep -o '"entryId":"[^"]*ai-proxy[^"]*","moduleName":"[^"]*","enabled":[a-z]*,"fiberPhase":"[a-z]*"' \
  || true)
if [ -n "$MATCH" ]; then
  printf '%s\n' "$MATCH"
else
  echo "(inventory query failed — app 还没重启或端口不对)"
fi
echo "== settings section =="
grep -A4 '^ai-proxy:' "$HOME/.dsh/settings.yaml" 2>/dev/null || echo "(settings.yaml 里还没有 ai-proxy 分节)"
echo "== OAuth Host interface =="
curl -s -m 5 -X POST "$URL/ai-proxy-auth/status" \
  -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"verify-oauth","method":"status","payload":{}}' \
  | grep -o '"state":"[^"]*","message":"[^"]*"' \
  || echo "(OAuth interface query failed — app 还没重启或不是本机地址)"
echo "== client bundle served =="
for ID in dsh-ai-proxy llm-ai-proxy; do
  CODE=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$URL/plugins/$ID/client.js")
  echo "  /plugins/$ID/client.js -> HTTP $CODE"
done
echo "== credential refs (names only, values never printed) =="
grep -E 'AIPROXY_(ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)' "$HOME/.dsh/.credentials.yaml" 2>/dev/null | sed 's/:.*//' || echo "(none configured)"
