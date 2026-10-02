#!/usr/bin/env bash
# Verificación completa de Blockk Studio antes de subir un cambio: PHPUnit, sintaxis PHP, ESLint y prueba de humo en el
# navegador. Uso: .claude/skills/verificar/scripts/verificar.sh [--rapido]   (--rapido omite el navegador)
set -uo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null)}"
fail=0
step() { printf '\n== %s\n' "$1"; }

step "PHPUnit"
# Con redis-server instalado, RedisStoreTest corre contra una instancia efímera en el puerto 6390.
if command -v redis-server > /dev/null && ! redis-cli -p 6390 ping > /dev/null 2>&1; then
    redis-server --port 6390 --save '' --appendonly no --daemonize yes > /dev/null
fi
redis-cli -p 6390 ping > /dev/null 2>&1 && export REDIS_TEST_URL=redis://127.0.0.1:6390
vendor/bin/phpunit --colors=never 2>&1 | tail -4
[ "${PIPESTATUS[0]}" -eq 0 ] || fail=1
# PHPUnit regenera config/reference.php al arrancar el kernel: no es un cambio nuestro.
git checkout -q -- config/reference.php 2>/dev/null || true

step "Sintaxis PHP (archivos modificados)"
for f in $(git diff --name-only HEAD -- '*.php'; git ls-files --others --exclude-standard -- '*.php'); do
    [ -f "$f" ] && { php -l "$f" > /dev/null || fail=1; }
done
echo "ok"

step "ESLint (assets/)"
if command -v eslint > /dev/null; then
    eslint -c "$HERE/../eslint.config.mjs" assets --ignore-pattern 'assets/vendor/**' && echo "ok" || fail=1
else
    echo "eslint no está instalado (npm i -g eslint): se omite"
fi

if [ "${1:-}" != "--rapido" ]; then
    step "Navegador: prueba de humo"
    "$ROOT/.claude/skills/capturas/scripts/servidor.sh" || fail=1
    node "$HERE/humo.cjs" || fail=1

    step "Navegador: Mis casas y enlace compartido"
    node "$HERE/casas.cjs" || fail=1

    step "Navegador: chat de diseño (Kimi falso)"
    "$HERE/servidor-ia.sh" || fail=1
    node "$HERE/asistente.cjs" || fail=1

    step "Navegador: plano de fondo y PDF adjunto"
    node "$HERE/fondo.cjs" || fail=1
fi

printf '\n'
if [ "$fail" -eq 0 ]; then echo "VERIFICACIÓN OK"; else echo "VERIFICACIÓN CON FALLAS"; fi
exit "$fail"
