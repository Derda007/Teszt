#!/usr/bin/env bash
# ---------------------------------------------------------------
#  OCR Szövegkinyerő – indítás macOS-en és Linuxon
#
#  Futtatás terminálból:   ./inditas.sh
#  (macOS-en duplakattintással is működik, ha a Finderben egyszer
#   beállítottad, hogy a .sh fájlokat a Terminál nyissa meg.)
#
#  Elindít egy helyi kiszolgálót, megvárja, amíg az tényleg válaszol,
#  és csak utána nyitja meg a böngészőt.
#  A terminálablakot hagyd nyitva, amíg használod; Ctrl+C leállítja.
# ---------------------------------------------------------------
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
PORT="${1:-8080}"
CIM="http://localhost:$PORT"

# A kiszolgálót csak a saját géped éri el (127.0.0.1), így a tűzfal
# sem kérdez rá.
if command -v python3 >/dev/null 2>&1; then
  PARANCS=(python3 -m http.server "$PORT" --bind 127.0.0.1)
elif command -v python >/dev/null 2>&1; then
  PARANCS=(python -m http.server "$PORT" --bind 127.0.0.1)
elif command -v node >/dev/null 2>&1; then
  PARANCS=(node scripts/server.js "$PORT")
else
  echo
  echo "  Nem találtam sem Pythont, sem Node.js-t a gépen."
  echo
  echo "  Telepítsd valamelyiket, aztán próbáld újra:"
  echo "    Python  –  https://www.python.org/downloads/"
  echo "    Node.js –  https://nodejs.org/"
  echo
  exit 1
fi

echo
echo "  OCR Szövegkinyerő indul…"
echo "  Cím: $CIM"
echo
echo "  Leállítás: Ctrl+C"
echo

# A böngészőt csak akkor nyitjuk meg, ha a kiszolgáló már válaszol –
# különben "a kapcsolat elutasítva" hibát kapnánk.
(
  for _ in $(seq 1 60); do
    if command -v curl >/dev/null 2>&1; then
      curl -s -o /dev/null "$CIM" && break
    else
      sleep 2
      break
    fi
    sleep 0.5
  done
  if command -v open >/dev/null 2>&1; then open "$CIM"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$CIM"
  else echo "  Nyisd meg a böngészőben: $CIM"
  fi
) >/dev/null 2>&1 &

exec "${PARANCS[@]}"
