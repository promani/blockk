#!/usr/bin/env bash
# Levanta el servidor de desarrollo de Blockk Studio en 127.0.0.1:8000 si no está respondiendo.
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
URL="http://127.0.0.1:8000/"
if curl -s -o /dev/null -m 3 "$URL"; then echo "servidor ya activo en $URL"; exit 0; fi
setsid nohup php -S 127.0.0.1:8000 -t "$ROOT/public" > /tmp/blockk-server.log 2>&1 < /dev/null &
for _ in $(seq 1 20); do
    if curl -s -o /dev/null -m 2 "$URL"; then echo "servidor activo en $URL (log: /tmp/blockk-server.log)"; exit 0; fi
    sleep 0.5
done
echo "no se pudo levantar el servidor; ver /tmp/blockk-server.log" >&2
exit 1
