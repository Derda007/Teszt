#!/usr/bin/env bash
#
# A böngészőben futó könyvtárak (tesseract.js, pdf.js) és a nyelvi
# adatfájlok bemásolása a vendor/ könyvtárba az npm csomagokból.
#
# Használat:
#   npm install
#   ./scripts/vendor.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NM="$ROOT/node_modules"

if [ ! -d "$NM" ]; then
  echo "Hiba: nincs node_modules könyvtár. Futtasd előbb: npm install" >&2
  exit 1
fi

mkdir -p "$ROOT/vendor/tesseract" "$ROOT/vendor/tessdata" "$ROOT/vendor/pdfjs"

echo "-> tesseract.js"
cp "$NM/tesseract.js/dist/tesseract.min.js"   "$ROOT/vendor/tesseract/"
cp "$NM/tesseract.js/dist/worker.min.js"      "$ROOT/vendor/tesseract/"
cp "$NM/tesseract.js/dist/tesseract.min.js.LICENSE.txt" "$ROOT/vendor/tesseract/" 2>/dev/null || true

echo "-> tesseract.js-core (WASM)"
cp "$NM/tesseract.js-core/tesseract-core-simd-lstm.wasm.js" "$ROOT/vendor/tesseract/"
cp "$NM/tesseract.js-core/tesseract-core-lstm.wasm.js"      "$ROOT/vendor/tesseract/"
cp "$NM/tesseract.js-core/LICENSE" "$ROOT/vendor/tesseract/LICENSE-core.txt"

echo "-> nyelvi adatfájlok (4.0.0_best_int)"
for LANG in hun eng deu; do
  cp "$NM/@tesseract.js-data/$LANG/4.0.0_best_int/$LANG.traineddata.gz" "$ROOT/vendor/tessdata/"
done

echo "-> pdf.js"
cp "$NM/pdfjs-dist/build/pdf.min.mjs"        "$ROOT/vendor/pdfjs/"
cp "$NM/pdfjs-dist/build/pdf.worker.min.mjs" "$ROOT/vendor/pdfjs/"
cp "$NM/pdfjs-dist/LICENSE" "$ROOT/vendor/pdfjs/LICENSE.txt" 2>/dev/null || true

echo "-> pdf.js kiegészítők (szabványos betűkészletek, cmap-ek)"
rm -rf "$ROOT/vendor/pdfjs/standard_fonts" "$ROOT/vendor/pdfjs/cmaps"
cp -r "$NM/pdfjs-dist/standard_fonts" "$ROOT/vendor/pdfjs/standard_fonts"
cp -r "$NM/pdfjs-dist/cmaps"          "$ROOT/vendor/pdfjs/cmaps"

echo "Kész. A vendor/ könyvtár frissítve:"
du -sh "$ROOT/vendor"
