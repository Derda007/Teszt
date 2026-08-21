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

> **Az `index.html`-re duplán kattintva az oldal nem működik.** Ilyenkor a
> böngésző `file://` módban nyitja meg, és a biztonsági szabályai miatt nem
> engedi betölteni a WebAssembly-motort és a nyelvi adatfájlt. Az oldal ezt ki
> is írja. Egy helyi kiszolgáló kell hozzá – ehhez vannak az indítófájlok:

**Windows:** kattints duplán az **`inditas.bat`** fájlra.

**macOS / Linux:** a projekt könyvtárában futtasd:

```bash
./inditas.sh
```

Mindkettő elindítja a kiszolgálót, **megvárja, amíg az tényleg válaszol**, és
csak utána nyitja meg a böngészőt. A megnyíló terminál- vagy parancssori
ablakot **hagyd nyitva**, amíg használod; bezárva (vagy `Ctrl+C`-vel) leáll a
kiszolgáló.

Ha inkább kézzel indítanád:

```bash
python3 -m http.server 8080      # vagy: node scripts/server.js
```

Ezután nyisd meg: <http://localhost:8080>

Az indítófájlok Pythont keresnek, és ha nincs, Node.js-t. Ha egyik sincs a
gépen, kiírják, honnan telepíthető. A `vendor/` könyvtár a repóban van, így
**telepítés nélkül** azonnal használható.

### Kiszolgáló nélkül: GitHub Pages

Ha nem akarsz semmit indítani a saját gépeden, tedd közzé a repót GitHub
Pages-en (a repó **Settings → Pages** menüjében válaszd ki ezt az ágat), és az
oldal onnantól egy webcímről is használható. A feldolgozás ettől még ugyanúgy
a böngésződben történik – a fájljaid akkor sem töltődnek fel sehová.

## Használat

1. **Fájlok kiválasztása** – húzd a fájlokat a kijelölt területre, tallózz, vagy
   **illeszd be a vágólapról `Ctrl+V`-vel**. Támogatott: JPG, PNG, WEBP, BMP,
   GIF, TIFF és PDF. Több fájl is megadható.
2. **Beállítások** – nyelv, oldalelrendezés, PDF-felbontás, elforgatás; a
   lenyíló részben képjavítás és Markdown-formázási kapcsolók.
3. **Szöveg kinyerése** – a folyamat közben látszik, hol tart, és bármikor
   megszakítható.
4. **Eredmény** – előnézet vagy szerkeszthető Markdown forrás, majd letöltés
   `.md` fájlként (több fájl esetén egyben vagy külön-külön), illetve másolás
   vágólapra.

### Képernyőkép beillesztése

Készíts kivágást (Windows: `Win`+`Shift`+`S`, macOS: `Cmd`+`Ctrl`+`Shift`+`4`),
majd nyomj `Ctrl`+`V`-t az oldalon: a kép `vagolap-1.png`, `vagolap-2.png` …
néven azonnal a listába kerül. A **Beillesztés vágólapról** gomb ugyanezt teszi
azokban a böngészőkben, ahol a billentyűparancs nem jut el az oldalig (ilyenkor
a böngésző engedélyt kérhet a vágólap olvasásához). A fájlkezelőből másolt
kép- és PDF-fájlok beillesztése is működik.

## Ha valami nem működik

Az oldal alján látszik a futó **verzió**. Ha az nem egyezik a repóban lévővel
(`APP_VERSION` az `assets/app.js` elején), akkor a böngésző a gyorsítótárból
szolgálja ki a régi változatot – frissíts rá `Ctrl`+`Shift`+`R`-rel
(macOS-en `Cmd`+`Shift`+`R`).

A **Szöveg kinyerése** gomb csak akkor tiltott, ha van rá oka, és ezt mindig
meg is mondja: vidd fölé az egeret, vagy nézd meg a gomb alatti üzenetsávot.

| Amit látsz | Mi a teendő |
| --- | --- |
| „Az oldalt közvetlenül a fájlrendszerről nyitottad meg (file://)” | Indítsd az `inditas.bat` / `inditas.sh` fájllal, és a `http://localhost:8080` címen használd |
| „Az OCR motor … nem töltődött be” | Hiányzik a `vendor/` könyvtár: `npm install && npm run vendor` |
| A gomb szürke, de nincs üzenet | Nincs még fájl a listán |
| Régi verziószám a láblécben | Frissíts `Ctrl`+`Shift`+`R`-rel |
| `ERR_CONNECTION_REFUSED` / „a localhost elutasította a csatlakozást” | A kiszolgáló nem indult el. Nézd meg az indítófájl ablakát: ha Python hiányt jelez, telepítsd; ha „Address already in use”, a port foglalt |
| A Windows a Microsoft Store-t nyitja meg a `python` parancsra | Nincs telepítve Python, csak a Windows helyettesítője. Telepítsd a [python.org](https://www.python.org/downloads/)-ról, és pipáld be az *Add python.exe to PATH* opciót |

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
inditas.bat             indítás Windowson (duplakattintás)
inditas.sh              indítás macOS-en és Linuxon
assets/styles.css       megjelenés (világos és sötét témával)
assets/app.js           az alkalmazás logikája
scripts/server.js       tartalék statikus kiszolgáló, ha nincs Python
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
