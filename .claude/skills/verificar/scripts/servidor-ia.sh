#!/usr/bin/env bash
# Levanta Kimi falso (8099) y una segunda instancia de la app (8091) configurada contra él, para probar el chat.
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "$0")" && pwd)"
if ! curl -s -o /dev/null -m 2 -X POST http://127.0.0.1:8099/v1/chat/completions; then
    setsid nohup node "$HERE/kimi-falso.cjs" 8099 > /tmp/blockk-kimi-falso.log 2>&1 < /dev/null &
fi
if ! curl -s -m 2 http://127.0.0.1:8091/api/assistant/status | grep -q '"enabled":true'; then
    KIMI_BASE_URL=http://127.0.0.1:8099/v1 KIMI_API_KEY=x KIMI_MODEL=falso KIMI_MODEL_LIGHT=liviano ASSISTANT_HOURLY_LIMIT=100000 ASSISTANT_DAILY_LIMIT=100000 NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
        setsid nohup php -d variables_order=EGPCS -S 127.0.0.1:8091 -t "$ROOT/public" > /tmp/blockk-ia.log 2>&1 < /dev/null &
fi
for _ in $(seq 1 20); do
    if curl -s -m 2 http://127.0.0.1:8091/api/assistant/status | grep -q '"enabled":true'; then echo "app con Kimi falso en http://127.0.0.1:8091"; exit 0; fi
    sleep 0.5
done
echo "no levantó (ver /tmp/blockk-ia.log y /tmp/blockk-kimi-falso.log)" >&2
exit 1
