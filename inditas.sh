#!/usr/bin/env bash
# ---------------------------------------------------------------
#  OCR Szövegkinyerő – indítás macOS-en és Linuxon
#
#  Futtatás terminálból:   ./inditas.sh
#  (macOS-en duplakattintással is működik, ha a Finderben egyszer
#   beállítottad, hogy a .sh fájlokat a Terminál nyissa meg.)
#
#  Elindít egy helyi kiszolgálót és megnyitja az oldalt a böngészőben.
#  A terminálablakot hagyd nyitva, amíg használod; Ctrl+C leállítja.
# ---------------------------------------------------------------
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
PORT="${1:-8080}"
CIM="http://localhost:$PORT"

echo
echo "  OCR Szövegkinyerő indul…"
echo "  Cím: $CIM"
echo

# A böngészőt kis késleltetéssel nyitjuk, hogy a kiszolgáló már álljon.
(
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$CIM"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$CIM"
  fi
) >/dev/null 2>&1 &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server "$PORT"
elif command -v node >/dev/null 2>&1; then
  exec node scripts/server.js "$PORT"
else
  echo "  Nem találtam sem Pythont, sem Node.js-t a gépen."
  echo
  echo "  Telepítsd valamelyiket, aztán próbáld újra:"
  echo "    Python  –  https://www.python.org/downloads/"
  echo "    Node.js –  https://nodejs.org/"
  echo
  exit 1
fi
