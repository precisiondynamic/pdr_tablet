#!/usr/bin/env bash
# Runs every test suite. Needs: node, lua5.4, and Playwright with Chromium
#   npm i -g playwright && npx playwright install chromium      (or set PLAYWRIGHT / CHROMIUM)
# Usage: tests/run.sh [suite…]      suites: lua market os-lifecycle settings-audit apps murder
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8765}
export PDR_URL="http://localhost:$PORT/dev/"
export PLAYWRIGHT=${PLAYWRIGHT:-$(npm root -g 2>/dev/null)/playwright}

if ! curl -s -o /dev/null "http://localhost:$PORT/dev/"; then
    python3 -m http.server -d web "$PORT" >/dev/null 2>&1 &
    SERVER=$!
    trap 'kill $SERVER 2>/dev/null' EXIT
    for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/dev/" && break; sleep 0.1; done
fi

SUITES=${*:-lua market os-lifecycle settings-audit apps murder}
FAILED=()
for s in $SUITES; do
    echo "════════ $s"
    case $s in
        lua)    lua5.4 tests/lua/test_lib.lua ;;
        market) TMP=$(mktemp); node tests/lua/gen_prices.js "$TMP" && lua5.4 tests/lua/test_market.lua "$TMP"; rc=$?; rm -f "$TMP"; (exit $rc) ;;
        *)      node "tests/e2e/$s.js" | grep -v '^PASS' ;;
    esac
    rc=${PIPESTATUS[0]}
    [ "$rc" -ne 0 ] && FAILED+=("$s")
done
echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "FAILED: ${FAILED[*]}"; exit 1; fi
