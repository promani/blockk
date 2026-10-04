#!/usr/bin/env bash
# Deja la máquina lista para probar Blockk Studio en local: dependencias de PHP, Playwright + ESLint y Chromium.
# Uso: .claude/tools/preparar.sh   (se puede correr las veces que haga falta)
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
[ -f vendor/autoload_runtime.php ] || composer install --no-interaction
cd "$HERE"
[ -x node_modules/.bin/eslint ] && [ -d node_modules/playwright ] || npm install --no-audit --no-fund --loglevel=error
node_modules/.bin/playwright install chromium
command -v redis-server > /dev/null || echo "aviso: sin redis-server, RedisStoreTest se saltea (brew install redis para correrlo)"
echo "listo"
