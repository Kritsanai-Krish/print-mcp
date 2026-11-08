#!/usr/bin/env sh
# Starts Print Studio and opens it in its own window. Installs and builds on first run.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js 20.11 or newer is required: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install || exit 1
[ -f dist/index.js ] || npm run build || exit 1
exec node web/server.mjs --open
