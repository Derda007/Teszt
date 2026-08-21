# OCR Szövegkinyerő

Egyoldalas webalkalmazás, amely **fotókból, szkennelt képekből és PDF-ekből OCR
segítségével kinyeri a szöveget**, majd az eredményt **Markdown (.md) fájlként**
menti.

* **Nincs benne mesterséges intelligencia.** A felismerést a klasszikus
  [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR motor végzi
  (tesseract.js, WebAssembly). Nem hív külső AI-szolgáltatást, nem generál
  szöveget – csak azt olvassa ki, ami a képen van.
* **Nincs szerver és nincs feltöltés.** Minden a böngészőben fut, a fájlok nem
  hagyják el a gépet.
* **Offline működik.** A motor, a magyar/angol/német nyelvi adatok és a
  PDF-olvasó a `vendor/` könyvtárban vannak, semmit nem tölt le futás közben.
* **Magyar nyelvű felület.**

## Indítás

A böngészők biztonsági szabályai miatt az oldalt **webkiszolgálóról** kell
megnyitni – a `file://` protokoll nem működik (a WebAssembly-motor és a nyelvi
fájlok nem töltődnének be).

```bash
git clone <a repó címe>
cd Teszt
python3 -m http.server 8080      # vagy: npm start
```

Ezután nyisd meg: <http://localhost:8080>

A `vendor/` könyvtár a repóban van, így **telepítés nélkül** azonnal használható.

## Használat

1. **Fájlok kiválasztása** – húzd a fájlokat a kijelölt területre, vagy tallózz.
   Támogatott: JPG, PNG, WEBP, BMP, GIF, TIFF és PDF. Több fájl is megadható.
2. **Beállítások** – nyelv, oldalelrendezés, PDF-felbontás, elforgatás; a
   lenyíló részben képjavítás és Markdown-formázási kapcsolók.
3. **Szöveg kinyerése** – a folyamat közben látszik, hol tart, és bármikor
   megszakítható.
4. **Eredmény** – előnézet vagy szerkeszthető Markdown forrás, majd letöltés
   `.md` fájlként (több fájl esetén egyben vagy külön-külön), illetve másolás
   vágólapra.

## Beállítások

| Beállítás | Mire jó |
| --- | --- |
| Felismerés nyelve | magyar, angol, német és ezek kombinációi |
| Oldalelrendezés | Tesseract page segmentation mode – táblához, felirathoz, egysoros szöveghez |
| PDF-oldalak felbontása | 150–400 DPI; magasabb érték pontosabb, de lassabb |
| Elforgatás | oldalra fordított beolvasás helyretétele |
| Szürkeárnyalat / kontraszt / küszöbölés | halvány vagy egyenetlen megvilágítású fotókhoz (Otsu-küszöb) |
| Kis képek felnagyítása | apró felbontású képek felskálázása felismerés előtt |
| Tördelt sorok bekezdéssé fűzése | a sortörések helyett folyó szöveg |
| Elválasztott szavak összevonása | a sorvégi elválasztójelek eltüntetése |
| Feltehető címsorok jelölése | a nagyobb betűs sorokból `##` / `###` címsor lesz |
| Felsorolások felismerése | a felsorolásjelek `-` listává alakítása |
| Oldalcímek beszúrása | többoldalas PDF-nél `## N. oldal` elválasztók |
| YAML fejléc | forrás, oldalszám, nyelv, megbízhatóság a fájl elején |
| Beágyazott PDF-szöveg használata | ha a PDF már tartalmaz valódi szöveget, azt veszi át OCR helyett |

## Hogyan lesz a nyers szövegből Markdown?

Az OCR nyers, tördelt szöveget ad vissza. Az alkalmazás ebből tisztán
szabályalapú lépésekkel épít dokumentumszerkezetet:

* a Tesseract saját **blokk- és bekezdésfelosztását** használja kiindulásnak;
* a sorok **betűméretéből** ismeri fel a címsorokat (a szokásosnál nagyobb,
  rövid, írásjel nélküli sorok);
* a **félbevágott bekezdéseket** összefűzi, ha az előző sor mondat közben ér
  véget és a következő kisbetűvel kezdődik;
* a **sorvégi elválasztójeleket** összevonja;
* a **felsorolásjeleket** listává alakítja – beleértve azokat is, amelyeket az
  OCR betűnek néz (a `•` gyakran `e`-ként jön vissza), ha ugyanaz a karakter
  több sor elején is megjelenik;
* a Markdown-jelentéssel bíró sorkezdő karaktereket (`#`, `>`, `|`) **escape-eli**.

PDF-nél, ha van beágyazott szövegréteg, a szöveg abból jön (hibátlanul és
azonnal); a bekezdéshatárokat ilyenkor a sorok függőleges térköze adja.

Az OCR sosem tökéletes: az eredmény a **Markdown forrás** nézetben szabadon
átírható letöltés előtt.

## Projektszerkezet

```
index.html              a felület
assets/styles.css       megjelenés (világos és sötét témával)
assets/app.js           az alkalmazás logikája
vendor/tesseract/       tesseract.js + WebAssembly mag
vendor/tessdata/        nyelvi adatok (hun, eng, deu)
vendor/pdfjs/           pdf.js + cmap-ek és szabványos betűkészletek
scripts/vendor.sh       a vendor/ könyvtár újraépítése npm csomagokból
```

## A vendor/ könyvtár frissítése

```bash
npm install
npm run vendor
```

A `scripts/vendor.sh` a `node_modules`-ból másolja a helyükre a böngészőben
futó fájlokat. További nyelv hozzáadásához telepítsd a megfelelő csomagot
(pl. `npm i @tesseract.js-data/slk`), vedd fel a nyelv kódját a szkript
`for LANG in ...` sorába, majd az `index.html` nyelvválasztójába.

## Licenc és források

Az alkalmazás kódja szabadon használható. A `vendor/` könyvtár tartalma:

* [tesseract.js](https://github.com/naptha/tesseract.js) és
  [tesseract.js-core](https://github.com/naptha/tesseract.js-core) – Apache-2.0
* [tessdata](https://github.com/tesseract-ocr/tessdata) nyelvi modellek – Apache-2.0
* [pdf.js](https://github.com/mozilla/pdf.js) – Apache-2.0
