/*
 * Irodai dokumentumok olvasása – Word és Excel, Markdown kimenettel.
 * ------------------------------------------------------------------
 * Négy formátumot kezel, mindet a böngészőben, könyvtárak és
 * szolgáltatások nélkül:
 *
 *   .docx / .xlsx   ZIP + XML (Office Open XML)
 *   .doc  / .xls    OLE összetett fájl (Word 97-2003, Excel 97-2003)
 *
 * Ezekben valódi, gépi szöveg van, ezért itt nincs OCR: a felismerés
 * hibázhatna olyan szövegen, amit egyszerűen ki lehet olvasni.
 *
 * A modul a window.Iroda objektumot teszi elérhetővé.
 */

(function () {
  'use strict';

  /** Ennél nagyobb fájlt nem nyitunk meg: a böngésző memóriája véges. */
  const MAX_MERET = 80 * 1024 * 1024;

  const KITERJESZTESEK = {
    docx: 'docx', docm: 'docx',
    xlsx: 'xlsx', xlsm: 'xlsx',
    doc: 'doc',
    xls: 'xls',
  };

  const FAJTA_NEVEK = {
    docx: 'Word-dokumentum',
    doc: 'Word 97-2003 dokumentum',
    xlsx: 'Excel-munkafüzet',
    xls: 'Excel 97-2003 munkafüzet',
  };

  /* ------------------------------------------------------------------ *
   * Segédek
   * ------------------------------------------------------------------ */

  function kiterjesztes(nev) {
    const m = /\.([A-Za-z0-9]+)$/.exec(nev || '');
    return m ? m[1].toLowerCase() : '';
  }

  /** @return 'docx' | 'doc' | 'xlsx' | 'xls' | null */
  function fajta(nev) {
    return KITERJESZTESEK[kiterjesztes(nev)] || null;
  }

  /** Markdownban jelentéssel bíró karakterek semlegesítése. */
  function vedd(szoveg) {
    return String(szoveg)
      .replace(/([\\`*[\]])/g, '\\$1')
      .replace(/^(\s*)([#>+-])/, '$1\\$2')
      .replace(/^(\s*)(\d{1,3})\./, '$1$2\\.');
  }

  /** Táblázatcellában a sortörés és a függőleges vonal nem maradhat. */
  function cella(szoveg) {
    return String(szoveg)
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\|/g, '\\|')
      .replace(/([\\`*[\]])/g, '\\$1')
      .trim();
  }

  /**
   * Markdown-táblázat egy cellarácsból. Az üres szélső sorokat és
   * oszlopokat levágja, mert a táblázatkezelők gyakran hagynak ilyeneket.
   */
  function tablazat(racs) {
    let sorok = racs.map((sor) => (sor || []).map((c) => (c == null ? '' : String(c))));

    const uresSor = (sor) => sor.every((c) => c.trim() === '');
    while (sorok.length && uresSor(sorok[0])) sorok.shift();
    while (sorok.length && uresSor(sorok[sorok.length - 1])) sorok.pop();
    if (sorok.length === 0) return '';

    const szelesseg = Math.max(...sorok.map((s) => s.length));
    sorok = sorok.map((s) => {
      const masolat = s.slice();
      while (masolat.length < szelesseg) masolat.push('');
      return masolat;
    });

    let elso = 0;
    let utolso = szelesseg - 1;
    const uresOszlop = (i) => sorok.every((s) => s[i].trim() === '');
    while (elso <= utolso && uresOszlop(elso)) elso += 1;
    while (utolso >= elso && uresOszlop(utolso)) utolso -= 1;
    if (elso > utolso) return '';

    sorok = sorok.map((s) => s.slice(elso, utolso + 1));

    const fej = sorok[0].map(cella);
    const elvalaszto = fej.map(() => '---');
    const test = sorok.slice(1).map((s) => s.map(cella));

    const sorMd = (s) => `| ${s.join(' | ')} |`;
    return [sorMd(fej), sorMd(elvalaszto)].concat(test.map(sorMd)).join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Számformátumok: dátumok és számok emberi alakja
   * ------------------------------------------------------------------ */

  /* A táblázatkezelők beépített dátum- és időformátumai. */
  const BEEPITETT_DATUM = new Set([
    14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    50, 51, 52, 53, 54, 55, 56, 57, 58,
  ]);
  const BEEPITETT_IDO = new Set([18, 19, 20, 21, 45, 46, 47]);

  function datumFormatum(ifmt, formatKod) {
    if (BEEPITETT_DATUM.has(ifmt)) return 'datum';
    if (BEEPITETT_IDO.has(ifmt)) return 'ido';
    if (!formatKod) return null;

    /* Az idézőjeles részek nem formátumjelek, azokat kihagyjuk. */
    const tiszta = formatKod.replace(/"[^"]*"/g, '').replace(/\\./g, '');
    const vanDatum = /[yYmMdD]/.test(tiszta) && /[yYdD]/.test(tiszta);
    const vanIdo = /[hHsS]/.test(tiszta);
    if (vanDatum) return 'datum';
    if (vanIdo) return 'ido';
    return null;
  }

  /** A táblázatkezelők sorszámából dátum. */
  function sorszamDatum(szam, ezerkilencszaznegy) {
    let napok = szam;
    if (ezerkilencszaznegy) {
      napok += 1462;
    } else if (napok < 61) {
      /* Az 1900-as rendszer tévesen szökőévnek veszi 1900-at. */
      napok += 1;
    }
    const ezredmasodperc = Math.round((napok - 25569) * 86400000);
    const d = new Date(ezredmasodperc);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  const ket = (n) => String(n).padStart(2, '0');

  function formazErtek(szam, tipus, ezerkilencszaznegy) {
    if (tipus === 'datum' || tipus === 'ido') {
      const d = sorszamDatum(szam, ezerkilencszaznegy);
      if (d) {
        const nap = `${d.getUTCFullYear()}. ${ket(d.getUTCMonth() + 1)}. ${ket(d.getUTCDate())}.`;
        const ido = `${ket(d.getUTCHours())}:${ket(d.getUTCMinutes())}`;
        if (tipus === 'ido') return ido;
        return d.getUTCHours() || d.getUTCMinutes() ? `${nap} ${ido}` : nap;
      }
    }
    return szamSzoveg(szam);
  }

  /** A lebegőpontos ábrázolás szemetét nem írjuk ki (0,1+0,2 esete). */
  function szamSzoveg(szam) {
    if (!Number.isFinite(szam)) return '';
    if (Number.isInteger(szam)) return String(szam);
    const kerekitett = Number(szam.toPrecision(15));
    return String(kerekitett);
  }

  /* ------------------------------------------------------------------ *
   * OLE összetett fájl (a .doc és .xls tárolója)
   * ------------------------------------------------------------------ */

  const OLE_ALAIRAS = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const LANC_VEGE = 0xfffffffe;

  /**
   * Az OLE fájl egy kis fájlrendszer: szektorláncokból álló, névvel
   * ellátott adatfolyamok. Itt csak olvasunk belőle.
   */
  function olvasOle(bajtok) {
    for (let i = 0; i < 8; i += 1) {
      if (bajtok[i] !== OLE_ALAIRAS[i]) {
        throw new Error('a fájl nem Word 97-2003 vagy Excel 97-2003 formátumú');
      }
    }

    const dv = new DataView(bajtok.buffer, bajtok.byteOffset, bajtok.byteLength);
    const szektorMeret = 1 << dv.getUint16(30, true);
    const miniMeret = 1 << dv.getUint16(32, true);
    const elsoKonyvtar = dv.getUint32(48, true);
    const miniHatar = dv.getUint32(56, true);
    const elsoMiniFat = dv.getUint32(60, true);
    const miniFatSzektorok = dv.getUint32(64, true);
    const elsoDifat = dv.getUint32(68, true);

    const eltolas = (s) => (s + 1) * szektorMeret;
    const bejegyzesPerSzektor = szektorMeret / 4;

    /* 1. A FAT-ot leíró szektorok listája (DIFAT). */
    const fatSzektorok = [];
    for (let i = 0; i < 109; i += 1) {
      const s = dv.getUint32(76 + i * 4, true);
      if (s > 0xfffffff9) break;
      fatSzektorok.push(s);
    }
    let difat = elsoDifat;
    let orseg = 0;
    while (difat <= 0xfffffff9 && orseg < 100000) {
      orseg += 1;
      const off = eltolas(difat);
      if (off + szektorMeret > bajtok.length) break;
      for (let i = 0; i < bejegyzesPerSzektor - 1; i += 1) {
        const s = dv.getUint32(off + i * 4, true);
        if (s <= 0xfffffff9) fatSzektorok.push(s);
      }
      difat = dv.getUint32(off + (bejegyzesPerSzektor - 1) * 4, true);
    }

    /* 2. Maga a FAT: melyik szektort melyik követi. */
    const fat = new Uint32Array(fatSzektorok.length * bejegyzesPerSzektor);
    fatSzektorok.forEach((s, k) => {
      const off = eltolas(s);
      for (let i = 0; i < bejegyzesPerSzektor; i += 1) {
        fat[k * bejegyzesPerSzektor + i] = off + i * 4 + 4 <= bajtok.length
          ? dv.getUint32(off + i * 4, true)
          : LANC_VEGE;
      }
    });

    function lanc(kezdet, tabla) {
      const ki = [];
      let s = kezdet;
      while (s <= 0xfffffff9 && ki.length < 1000000) {
        ki.push(s);
        s = tabla[s];
        if (s === undefined) break;
      }
      return ki;
    }

    function normalAdat(kezdet, meret) {
      const ki = new Uint8Array(meret);
      let irt = 0;
      for (const s of lanc(kezdet, fat)) {
        if (irt >= meret) break;
        const off = eltolas(s);
        const n = Math.min(szektorMeret, meret - irt, bajtok.length - off);
        if (n <= 0) break;
        ki.set(bajtok.subarray(off, off + n), irt);
        irt += n;
      }
      return ki;
    }

    /* 3. Könyvtárbejegyzések. */
    const konyvtar = [];
    for (const s of lanc(elsoKonyvtar, fat)) {
      const off = eltolas(s);
      for (let k = 0; k + 128 <= szektorMeret; k += 128) {
        const e = off + k;
        if (e + 128 > bajtok.length) break;
        const nevHossz = dv.getUint16(e + 64, true);
        if (nevHossz < 2 || nevHossz > 64) continue;
        let nev = '';
        for (let i = 0; i < nevHossz - 2; i += 2) {
          nev += String.fromCharCode(dv.getUint16(e + i, true));
        }
        konyvtar.push({
          nev,
          tipus: bajtok[e + 66],
          kezdet: dv.getUint32(e + 116, true),
          meret: dv.getUint32(e + 120, true),
        });
      }
    }

    /* 4. A kis adatfolyamok külön tárolóban (mini FAT) laknak. */
    const gyoker = konyvtar.find((b) => b.tipus === 5);
    let miniAdat = null;
    let miniFat = null;

    function keszitsMini() {
      if (miniAdat) return;
      miniAdat = gyoker ? normalAdat(gyoker.kezdet, gyoker.meret) : new Uint8Array(0);

      const nyers = normalAdat(elsoMiniFat, miniFatSzektorok * szektorMeret);
      const mdv = new DataView(nyers.buffer, nyers.byteOffset, nyers.byteLength);
      miniFat = new Uint32Array(Math.floor(nyers.length / 4));
      for (let i = 0; i < miniFat.length; i += 1) miniFat[i] = mdv.getUint32(i * 4, true);
    }

    function folyam(nev) {
      const b = konyvtar.find((x) => x.nev === nev && x.tipus === 2);
      if (!b) return null;
      if (b.meret >= miniHatar) return normalAdat(b.kezdet, b.meret);

      keszitsMini();
      const ki = new Uint8Array(b.meret);
      let irt = 0;
      for (const s of lanc(b.kezdet, miniFat)) {
        if (irt >= b.meret) break;
        const off = s * miniMeret;
        const n = Math.min(miniMeret, b.meret - irt, miniAdat.length - off);
        if (n <= 0) break;
        ki.set(miniAdat.subarray(off, off + n), irt);
        irt += n;
      }
      return ki;
    }

    return { folyam, konyvtar };
  }

  /* ------------------------------------------------------------------ *
   * ZIP (a .docx és .xlsx tárolója)
   * ------------------------------------------------------------------ */

  function kicsomagol(bajtok) {
    if (typeof fflate === 'undefined' || typeof fflate.unzipSync !== 'function') {
      throw new Error('a ZIP-olvasó (vendor/fflate) nem töltődött be');
    }
    return fflate.unzipSync(bajtok);
  }

  const UTF8 = new TextDecoder('utf-8');

  function xmlDokumentum(csomag, ut) {
    const nyers = csomag[ut];
    if (!nyers) return null;
    const doc = new DOMParser().parseFromString(UTF8.decode(nyers), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error(`sérült XML a fájlban: ${ut}`);
    }
    return doc;
  }

  /** Névtértől független elemkeresés: a gyártók eltérő előtagokat használnak. */
  function gyerekek(elem, helyiNev) {
    const ki = [];
    for (let cs = elem.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName === helyiNev) ki.push(cs);
    }
    return ki;
  }

  function elsoGyerek(elem, helyiNev) {
    for (let cs = elem.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName === helyiNev) return cs;
    }
    return null;
  }

  /** Egymásba ágyazott útvonal, pl. pPr > pStyle. */
  function utonLefele(elem, ...nevek) {
    let mostani = elem;
    for (const nev of nevek) {
      if (!mostani) return null;
      mostani = elsoGyerek(mostani, nev);
    }
    return mostani;
  }

  function ertek(elem) {
    if (!elem) return null;
    return elem.getAttribute('w:val')
      || elem.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'val')
      || elem.getAttribute('val');
  }

  /* ------------------------------------------------------------------ *
   * DOCX
   * ------------------------------------------------------------------ */

  function olvasDocx(bajtok) {
    const csomag = kicsomagol(bajtok);
    const doc = xmlDokumentum(csomag, 'word/document.xml');
    if (!doc) throw new Error('hiányzik a word/document.xml – lehet, hogy nem Word-fájl');

    const cimsorSzintek = docxCimsorStilusok(csomag);
    const szamozasFajtak = docxSzamozas(csomag);
    const hivatkozasok = docxHivatkozasok(csomag);

    const test = doc.getElementsByTagName('*');
    let body = null;
    for (let i = 0; i < test.length; i += 1) {
      if (test[i].localName === 'body') { body = test[i]; break; }
    }
    if (!body) throw new Error('a dokumentumnak nincs törzse');

    const blokkok = [];
    let bekezdesek = 0;
    let tablak = 0;

    const ctx = { cimsorSzintek, szamozasFajtak, hivatkozasok };
    let elozoLista = false;

    for (let cs = body.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName === 'p') {
        const b = docxBekezdes(cs, ctx);
        if (!b) continue;
        bekezdesek += 1;

        /* Az egymást követő felsoroláspontok egyetlen listát alkotnak;
           külön blokkokként a Markdown újrakezdené a számozást. */
        if (b.lista && elozoLista) {
          blokkok[blokkok.length - 1] += `\n${b.md}`;
        } else {
          blokkok.push(b.md);
        }
        elozoLista = b.lista;
      } else if (cs.localName === 'tbl') {
        const md = docxTabla(cs, ctx);
        if (md) { blokkok.push(md); tablak += 1; }
        elozoLista = false;
      }
    }

    return {
      markdown: osszefuz(blokkok),
      bekezdesek,
      tablak,
    };
  }

  /**
   * A címsorstílusok azonosítója gyártó- és nyelvfüggő (Heading1, Cmsor1 …),
   * a beépített angol neve viszont nem: erre támaszkodunk.
   */
  function docxCimsorStilusok(csomag) {
    const szintek = new Map();
    const doc = xmlDokumentum(csomag, 'word/styles.xml');
    if (!doc) return szintek;

    const stilusok = doc.getElementsByTagName('*');
    for (let i = 0; i < stilusok.length; i += 1) {
      const s = stilusok[i];
      if (s.localName !== 'style') continue;

      const azonosito = s.getAttribute('w:styleId') || s.getAttribute('styleId');
      if (!azonosito) continue;

      const nev = ertek(elsoGyerek(s, 'name')) || '';
      const nevbol = /^heading\s*(\d)$/i.exec(nev.trim());
      const azonositobol = /^(?:heading|cmsor|berschrift|titre|titolo|encabezado)\s*_?(\d)$/i
        .exec(azonosito.trim());

      if (nevbol) szintek.set(azonosito, Number(nevbol[1]));
      else if (azonositobol) szintek.set(azonosito, Number(azonositobol[1]));
      else if (/^title$/i.test(nev.trim())) szintek.set(azonosito, 1);
    }
    return szintek;
  }

  /** numId -> 'bullet' | 'decimal' | 'none' */
  function docxSzamozas(csomag) {
    const fajtak = new Map();
    const doc = xmlDokumentum(csomag, 'word/numbering.xml');
    if (!doc) return fajtak;

    const absztraktok = new Map();
    const elemek = doc.getElementsByTagName('*');

    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName === 'abstractNum') {
        const id = e.getAttribute('w:abstractNumId') || e.getAttribute('abstractNumId');
        const szintek = [];
        const lvl = e.getElementsByTagName('*');
        for (let k = 0; k < lvl.length; k += 1) {
          if (lvl[k].localName === 'numFmt') szintek.push(ertek(lvl[k]));
        }
        absztraktok.set(id, szintek);
      }
    }

    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName !== 'num') continue;
      const numId = e.getAttribute('w:numId') || e.getAttribute('numId');
      const absId = ertek(elsoGyerek(e, 'abstractNumId'));
      const szintek = absztraktok.get(absId) || [];
      fajtak.set(numId, szintek);
    }
    return fajtak;
  }

  function docxHivatkozasok(csomag) {
    const cimek = new Map();
    const doc = xmlDokumentum(csomag, 'word/_rels/document.xml.rels');
    if (!doc) return cimek;

    const elemek = doc.getElementsByTagName('*');
    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName !== 'Relationship') continue;
      if (!/hyperlink$/i.test(e.getAttribute('Type') || '')) continue;
      cimek.set(e.getAttribute('Id'), e.getAttribute('Target'));
    }
    return cimek;
  }

  /** @return {{md: string, lista: boolean}} vagy null, ha a bekezdés üres. */
  function docxBekezdes(p, ctx) {
    const szoveg = docxFutamok(p, ctx).trim();
    const pPr = elsoGyerek(p, 'pPr');

    if (!szoveg) return null;

    /* Címsor? */
    const stilus = ertek(utonLefele(p, 'pPr', 'pStyle'));
    let szint = stilus ? ctx.cimsorSzintek.get(stilus) : null;
    if (!szint && pPr) {
      const vazlat = ertek(elsoGyerek(pPr, 'outlineLvl'));
      if (vazlat !== null && vazlat !== undefined && vazlat !== '') {
        szint = Number(vazlat) + 1;
      }
    }

    /* Felsorolás? A 0-s azonosító azt jelenti: nincs számozás. */
    const numPr = pPr ? elsoGyerek(pPr, 'numPr') : null;
    const numId = numPr ? ertek(elsoGyerek(numPr, 'numId')) : null;
    const ilvl = numPr ? Number(ertek(elsoGyerek(numPr, 'ilvl')) || 0) : 0;

    if (numId && numId !== '0') {
      const szintek = ctx.szamozasFajtak.get(numId) || [];
      const fmt = szintek[ilvl] || szintek[0] || 'bullet';
      if (fmt !== 'none') {
        const behuzas = '  '.repeat(Math.min(ilvl, 5));
        const jel = fmt === 'bullet' ? '-' : '1.';
        return { md: `${behuzas}${jel} ${szoveg}`, lista: true };
      }
    }

    if (szint && szint >= 1 && szint <= 5) {
      /* A dokumentum címe a fájlnévből lesz #, ezért egy szinttel lejjebb. */
      return { md: `${'#'.repeat(Math.min(szint + 1, 6))} ${szoveg}`, lista: false };
    }

    return { md: szoveg, lista: false };
  }

  /** A bekezdés szövege a betűformázásokkal együtt. */
  function docxFutamok(elem, ctx) {
    let ki = '';

    for (let cs = elem.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName === 'r') {
        ki += docxFutam(cs);
      } else if (cs.localName === 'hyperlink') {
        const belso = docxFutamok(cs, ctx).trim();
        const cim = ctx.hivatkozasok.get(cs.getAttribute('r:id') || cs.getAttribute('id'));
        ki += cim && belso ? `[${belso}](${cim})` : belso;
      } else if (cs.localName === 'smartTag' || cs.localName === 'sdt' || cs.localName === 'sdtContent') {
        ki += docxFutamok(cs, ctx);
      } else if (cs.localName === 'ins') {
        ki += docxFutamok(cs, ctx);          // elfogadott javítás: benne marad
      }
      /* A 'del' (törölt szöveg) szándékosan kimarad. */
    }

    return ki;
  }

  function docxFutam(r) {
    const rPr = elsoGyerek(r, 'rPr');
    const felkover = rPr && elsoGyerek(rPr, 'b') && ertek(elsoGyerek(rPr, 'b')) !== '0';
    const dolt = rPr && elsoGyerek(rPr, 'i') && ertek(elsoGyerek(rPr, 'i')) !== '0';

    let szoveg = '';
    for (let cs = r.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName === 't') szoveg += cs.textContent;
      else if (cs.localName === 'tab') szoveg += ' ';
      else if (cs.localName === 'br' || cs.localName === 'cr') szoveg += '\n';
      else if (cs.localName === 'noBreakHyphen') szoveg += '-';
      else if (cs.localName === 'sym') szoveg += ' ';
    }

    if (!szoveg) return '';

    /* A jelölés csak a tényleges szövegre kerül, a széli szóközökre nem. */
    const eleje = szoveg.match(/^\s*/)[0];
    const vege = szoveg.match(/\s*$/)[0];
    let mag = vedd(szoveg.slice(eleje.length, szoveg.length - vege.length));
    if (!mag) return szoveg;

    if (felkover) mag = `**${mag}**`;
    if (dolt) mag = `*${mag}*`;
    return eleje + mag + vege;
  }

  function docxTabla(tbl, ctx) {
    const racs = [];
    for (const tr of gyerekek(tbl, 'tr')) {
      const sor = [];
      for (const tc of gyerekek(tr, 'tc')) {
        const darabok = [];
        for (const p of gyerekek(tc, 'p')) {
          const s = docxFutamok(p, ctx).trim();
          if (s) darabok.push(s);
        }
        sor.push(darabok.join(' '));
      }
      if (sor.length) racs.push(sor);
    }
    return tablazat(racs);
  }

  /* ------------------------------------------------------------------ *
   * XLSX
   * ------------------------------------------------------------------ */

  function olvasXlsx(bajtok) {
    const csomag = kicsomagol(bajtok);

    const munkafuzet = xmlDokumentum(csomag, 'xl/workbook.xml');
    if (!munkafuzet) throw new Error('hiányzik az xl/workbook.xml – lehet, hogy nem Excel-fájl');

    const ezerkilencszaznegy = xlsxDatumRendszer(munkafuzet);
    const szovegek = xlsxSzovegek(csomag);
    const formatumok = xlsxFormatumok(csomag);
    const kapcsolatok = xlsxKapcsolatok(csomag);

    const lapok = [];
    const elemek = munkafuzet.getElementsByTagName('*');
    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName !== 'sheet') continue;
      const rid = e.getAttribute('r:id') || e.getAttribute('id');
      lapok.push({ nev: e.getAttribute('name') || `${lapok.length + 1}. munkalap`, rid });
    }

    const blokkok = [];
    let osszesSor = 0;
    let tablak = 0;

    for (const lap of lapok) {
      const cel = kapcsolatok.get(lap.rid);
      const ut = cel ? `xl/${cel.replace(/^\/?xl\//, '').replace(/^\//, '')}` : null;
      const doc = ut ? xmlDokumentum(csomag, ut) : null;
      if (!doc) continue;

      const racs = xlsxRacs(doc, szovegek, formatumok, ezerkilencszaznegy);
      const md = tablazat(racs);
      if (!md) continue;

      blokkok.push(`## ${vedd(lap.nev)}`);
      blokkok.push(md);
      osszesSor += racs.length;
      tablak += 1;
    }

    if (blokkok.length === 0) {
      return { markdown: '', bekezdesek: 0, tablak: 0, munkalapok: lapok.length };
    }

    return {
      markdown: osszefuz(blokkok),
      bekezdesek: osszesSor,
      tablak,
      munkalapok: lapok.length,
    };
  }

  function xlsxDatumRendszer(munkafuzet) {
    const elemek = munkafuzet.getElementsByTagName('*');
    for (let i = 0; i < elemek.length; i += 1) {
      if (elemek[i].localName === 'workbookPr') {
        const v = elemek[i].getAttribute('date1904');
        return v === '1' || v === 'true';
      }
    }
    return false;
  }

  function xlsxKapcsolatok(csomag) {
    const cimek = new Map();
    const doc = xmlDokumentum(csomag, 'xl/_rels/workbook.xml.rels');
    if (!doc) return cimek;
    const elemek = doc.getElementsByTagName('*');
    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName === 'Relationship') cimek.set(e.getAttribute('Id'), e.getAttribute('Target'));
    }
    return cimek;
  }

  function xlsxSzovegek(csomag) {
    const lista = [];
    const doc = xmlDokumentum(csomag, 'xl/sharedStrings.xml');
    if (!doc) return lista;

    for (let cs = doc.documentElement.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName !== 'si') continue;
      lista.push(xlsxSzovegElem(cs));
    }
    return lista;
  }

  /** Egy cellaszöveg: sima <t>, vagy formázott darabokból (<r><t>). */
  function xlsxSzovegElem(elem) {
    let ki = '';
    const bejar = (e) => {
      for (let cs = e.firstElementChild; cs; cs = cs.nextElementSibling) {
        if (cs.localName === 't') ki += cs.textContent;
        else if (cs.localName === 'r') bejar(cs);
      }
    };
    bejar(elem);
    return ki;
  }

  /** Cellastílus-index -> 'datum' | 'ido' | null */
  function xlsxFormatumok(csomag) {
    const ki = [];
    const doc = xmlDokumentum(csomag, 'xl/styles.xml');
    if (!doc) return ki;

    const egyediek = new Map();
    const elemek = doc.getElementsByTagName('*');
    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName === 'numFmt') {
        egyediek.set(Number(e.getAttribute('numFmtId')), e.getAttribute('formatCode') || '');
      }
    }

    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      if (e.localName !== 'cellXfs') continue;
      for (const xf of gyerekek(e, 'xf')) {
        const ifmt = Number(xf.getAttribute('numFmtId') || 0);
        ki.push(datumFormatum(ifmt, egyediek.get(ifmt)));
      }
      break;
    }
    return ki;
  }

  /** A1 -> 0, B1 -> 1, AA1 -> 26 */
  function oszlopIndex(hivatkozas) {
    const m = /^([A-Z]+)/.exec(hivatkozas || '');
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function xlsxRacs(doc, szovegek, formatumok, ezerkilencszaznegy) {
    const racs = [];
    const elemek = doc.getElementsByTagName('*');

    let adatok = null;
    for (let i = 0; i < elemek.length; i += 1) {
      if (elemek[i].localName === 'sheetData') { adatok = elemek[i]; break; }
    }
    if (!adatok) return racs;

    for (const row of gyerekek(adatok, 'row')) {
      const szam = Number(row.getAttribute('r') || racs.length + 1);
      const sor = [];

      for (const c of gyerekek(row, 'c')) {
        const oszlop = oszlopIndex(c.getAttribute('r'));
        const tipus = c.getAttribute('t');
        const stilus = Number(c.getAttribute('s') || 0);

        let ertekSzoveg = '';
        if (tipus === 'inlineStr') {
          const is = elsoGyerek(c, 'is');
          ertekSzoveg = is ? xlsxSzovegElem(is) : '';
        } else {
          const v = elsoGyerek(c, 'v');
          const nyers = v ? v.textContent : '';
          if (nyers === '') {
            ertekSzoveg = '';
          } else if (tipus === 's') {
            ertekSzoveg = szovegek[Number(nyers)] || '';
          } else if (tipus === 'str') {
            ertekSzoveg = nyers;
          } else if (tipus === 'b') {
            ertekSzoveg = nyers === '1' ? 'igaz' : 'hamis';
          } else if (tipus === 'e') {
            ertekSzoveg = nyers;
          } else {
            ertekSzoveg = formazErtek(Number(nyers), formatumok[stilus], ezerkilencszaznegy);
          }
        }

        while (sor.length < oszlop) sor.push('');
        sor[oszlop] = ertekSzoveg;
      }

      while (racs.length < szam - 1) racs.push([]);
      racs[szam - 1] = sor;
    }

    return racs;
  }

  /* ------------------------------------------------------------------ *
   * DOC (Word 97-2003)
   * ------------------------------------------------------------------ */

  /* A 8 bites darabokban a szöveg CP1252 kódolású; a 0x80-0x9F tartomány
     nem egyezik a Unicode-dal, ezért külön táblázat kell hozzá. */
  const CP1252_FELSO = [
    0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
    0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
    0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
  ];

  function olvasDoc(bajtok) {
    const ole = olvasOle(bajtok);
    const fo = ole.folyam('WordDocument');
    if (!fo) throw new Error('hiányzik a WordDocument adatfolyam – lehet, hogy nem Word-fájl');

    const dv = new DataView(fo.buffer, fo.byteOffset, fo.byteLength);
    if (dv.getUint16(0, true) !== 0xa5ec) {
      throw new Error('ismeretlen Word-változat');
    }

    const jelzok = dv.getUint16(0x0a, true);
    const tablaNev = (jelzok & 0x0200) ? '1Table' : '0Table';
    const tabla = ole.folyam(tablaNev) || ole.folyam('1Table') || ole.folyam('0Table');
    if (!tabla) throw new Error('hiányzik a szövegtábla');

    const ccpText = dv.getUint32(0x004c, true);
    const fcClx = dv.getUint32(0x01a2, true);
    const lcbClx = dv.getUint32(0x01a6, true);

    const darabok = docDarabok(tabla, fcClx, lcbClx);
    let szoveg = '';

    if (darabok.length > 0) {
      for (const d of darabok) {
        szoveg += docDarabSzoveg(fo, d);
        if (szoveg.length >= ccpText) break;
      }
    } else {
      /* Nincs darabtábla: a szöveg egyben van a fájl elején. */
      const fcMin = dv.getUint32(0x18, true);
      szoveg = docDarabSzoveg(fo, { kezdet: fcMin, hossz: ccpText, tomoritett: true });
    }

    if (ccpText > 0 && szoveg.length > ccpText) szoveg = szoveg.slice(0, ccpText);

    return docSzovegbolMarkdown(szoveg);
  }

  /** A darabtábla mondja meg, hogy a szöveg mely részei hol vannak. */
  function docDarabok(tabla, fcClx, lcbClx) {
    if (!lcbClx || fcClx + lcbClx > tabla.length) return [];

    const clx = tabla.subarray(fcClx, fcClx + lcbClx);
    const dv = new DataView(clx.buffer, clx.byteOffset, clx.byteLength);

    let i = 0;
    while (i < clx.length && clx[i] === 1) {
      const meret = dv.getUint16(i + 1, true);
      i += 3 + meret;
    }
    if (i >= clx.length || clx[i] !== 2) return [];

    const lcbPlc = dv.getUint32(i + 1, true);
    const plcKezdet = i + 5;
    const n = Math.floor((lcbPlc - 4) / 12);
    if (n <= 0 || plcKezdet + lcbPlc > clx.length) return [];

    const darabok = [];
    for (let k = 0; k < n; k += 1) {
      const cpTol = dv.getUint32(plcKezdet + k * 4, true);
      const cpIg = dv.getUint32(plcKezdet + (k + 1) * 4, true);
      const pcd = plcKezdet + (n + 1) * 4 + k * 8;
      const fc = dv.getUint32(pcd + 2, true);

      const tomoritett = (fc & 0x40000000) !== 0;
      const kezdet = tomoritett ? (fc & 0x3fffffff) >>> 1 : (fc & 0x3fffffff);
      darabok.push({ kezdet, hossz: cpIg - cpTol, tomoritett });
    }
    return darabok;
  }

  function docDarabSzoveg(folyam, darab) {
    let ki = '';
    if (darab.tomoritett) {
      for (let i = 0; i < darab.hossz; i += 1) {
        const b = folyam[darab.kezdet + i];
        if (b === undefined) break;
        ki += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_FELSO[b - 0x80] : b);
      }
    } else {
      for (let i = 0; i < darab.hossz; i += 1) {
        const off = darab.kezdet + i * 2;
        if (off + 1 >= folyam.length) break;
        ki += String.fromCharCode(folyam[off] | (folyam[off + 1] << 8));
      }
    }
    return ki;
  }

  /**
   * A Word 97 szövegfolyamában vezérlőkarakterek jelölik a bekezdéseket,
   * a táblázatcellákat és a mezőket. Ezeket itt fordítjuk le.
   */
  function docSzovegbolMarkdown(nyers) {
    const bekezdesek = [];
    let mostani = '';
    let mezoMelyseg = 0;      // 0x13 … 0x14 között a mező KÓDJA áll
    let mezoEredmeny = 0;
    let cellak = [];
    let bekezdesekSzama = 0;
    let tablaSorok = 0;

    const lezar = () => {
      const t = mostani.replace(/[ \t]+/g, ' ').trim();
      mostani = '';
      return t;
    };

    for (let i = 0; i < nyers.length; i += 1) {
      const k = nyers.charCodeAt(i);

      if (k === 0x13) { mezoMelyseg += 1; continue; }
      if (k === 0x14) { mezoEredmeny += 1; continue; }
      if (k === 0x15) {
        if (mezoMelyseg > 0) mezoMelyseg -= 1;
        if (mezoEredmeny > 0) mezoEredmeny -= 1;
        continue;
      }
      if (mezoMelyseg > mezoEredmeny) continue;   // a mezőkód nem tartozik a szövegre

      if (k === 0x07) {
        /* Minden cella 0x07-tel zárul, és a sor végét egy további,
           üres tartalmú 0x07 jelzi – így különül el a cellavég a
           sorvégtől. */
        const t = lezar();
        if (t === '' && cellak.length > 0) {
          bekezdesek.push({ sor: cellak });
          tablaSorok += 1;
          cellak = [];
        } else {
          cellak.push(t);
        }
        continue;
      }
      if (k === 0x0d || k === 0x0c) {              // bekezdés- vagy oldalvég
        const t = lezar();
        if (cellak.length) {
          if (t) cellak.push(t);
          bekezdesek.push({ sor: cellak });
          tablaSorok += 1;
          cellak = [];
        } else if (t) {
          bekezdesek.push({ szoveg: t });
          bekezdesekSzama += 1;
        }
        continue;
      }
      if (k === 0x0b) { mostani += ' '; continue; }         // sortörés
      if (k === 0x1e) { mostani += '-'; continue; }         // nem törhető kötőjel
      if (k === 0x1f) { continue; }                         // választható elválasztás
      if (k === 0xa0) { mostani += ' '; continue; }         // nem törhető szóköz
      if (k < 0x20 && k !== 0x09) { continue; }             // egyéb vezérlőjel

      mostani += nyers[i];
    }

    const maradek = lezar();
    if (maradek) { bekezdesek.push({ szoveg: maradek }); bekezdesekSzama += 1; }

    /* A táblázatsorokat egybefüggő táblázattá vonjuk össze. */
    const blokkok = [];
    let futoTabla = [];
    let tablak = 0;

    const tablatLezar = () => {
      if (futoTabla.length === 0) return;
      const md = tablazat(futoTabla);
      if (md) { blokkok.push(md); tablak += 1; }
      futoTabla = [];
    };

    for (const b of bekezdesek) {
      if (b.sor) {
        futoTabla.push(b.sor.map((c) => c));
      } else {
        tablatLezar();
        blokkok.push(vedd(b.szoveg));
      }
    }
    tablatLezar();

    return {
      markdown: osszefuz(blokkok),
      bekezdesek: bekezdesekSzama,
      tablak,
      tablaSorok,
    };
  }

  /* ------------------------------------------------------------------ *
   * XLS (Excel 97-2003, BIFF8)
   * ------------------------------------------------------------------ */

  const REKORD = {
    FORMULA: 0x0006, EOF: 0x000a, CONTINUE: 0x003c, DATEMODE: 0x0022,
    FORMAT: 0x041e, XF: 0x00e0, BOUNDSHEET: 0x0085, SST: 0x00fc,
    LABELSST: 0x00fd, LABEL: 0x0204, RSTRING: 0x00d6, NUMBER: 0x0203,
    RK: 0x027e, MULRK: 0x00bd, BOOLERR: 0x0205, STRING: 0x0207, BOF: 0x0809,
  };

  function olvasXls(bajtok) {
    const ole = olvasOle(bajtok);
    const konyv = ole.folyam('Workbook') || ole.folyam('Book');
    if (!konyv) throw new Error('hiányzik a Workbook adatfolyam – lehet, hogy nem Excel-fájl');

    const rekordok = xlsRekordok(konyv);
    const globalis = xlsGlobalis(rekordok);

    const blokkok = [];
    let osszesSor = 0;
    let tablak = 0;

    for (const lap of globalis.lapok) {
      const racs = xlsLapRacs(rekordok, lap.eltolas, globalis);
      const md = tablazat(racs);
      if (!md) continue;
      blokkok.push(`## ${vedd(lap.nev)}`);
      blokkok.push(md);
      osszesSor += racs.length;
      tablak += 1;
    }

    return {
      markdown: osszefuz(blokkok),
      bekezdesek: osszesSor,
      tablak,
      munkalapok: globalis.lapok.length,
    };
  }

  /** A BIFF fájl rekordok sorozata: típus, hossz, adat. */
  function xlsRekordok(folyam) {
    const dv = new DataView(folyam.buffer, folyam.byteOffset, folyam.byteLength);
    const ki = [];
    let i = 0;
    while (i + 4 <= folyam.length) {
      const tipus = dv.getUint16(i, true);
      const hossz = dv.getUint16(i + 2, true);
      if (i + 4 + hossz > folyam.length) break;
      const adat = folyam.subarray(i + 4, i + 4 + hossz);
      ki.push({
        tipus,
        helye: i,
        adat,
        dv: new DataView(adat.buffer, adat.byteOffset, adat.byteLength),
      });
      i += 4 + hossz;
    }
    return ki;
  }

  /** BIFF8 szöveg: hossz, jelzőbájt, majd 8 vagy 16 bites karakterek. */
  function xlsSzoveg(rek, eltolas, hosszKetBajton) {
    const dv = rek.dv;
    if (eltolas + (hosszKetBajton ? 3 : 2) > rek.adat.length) return '';

    const cch = hosszKetBajton ? dv.getUint16(eltolas, true) : dv.getUint8(eltolas);
    const jelzo = dv.getUint8(eltolas + (hosszKetBajton ? 2 : 1));
    let p = eltolas + (hosszKetBajton ? 3 : 2);

    const darabok = [];
    for (let i = 0; i < cch; i += 1) {
      if (jelzo & 0x01) {
        if (p + 1 >= rek.adat.length) break;
        darabok.push(String.fromCharCode(dv.getUint16(p, true)));
        p += 2;
      } else {
        if (p >= rek.adat.length) break;
        const b = dv.getUint8(p);
        darabok.push(String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_FELSO[b - 0x80] : b));
        p += 1;
      }
    }
    return darabok.join('');
  }

  function xlsGlobalis(rekordok) {
    const lapok = [];
    const formatumok = new Map();
    const stilusok = [];
    let szovegek = [];
    let ezerkilencszaznegy = false;

    for (let r = 0; r < rekordok.length; r += 1) {
      const rek = rekordok[r];
      if (rek.tipus === REKORD.EOF) break;

      if (rek.tipus === REKORD.BOUNDSHEET) {
        lapok.push({
          eltolas: rek.dv.getUint32(0, true),
          nev: xlsSzoveg(rek, 6, false),
        });
      } else if (rek.tipus === REKORD.DATEMODE) {
        ezerkilencszaznegy = rek.dv.getUint16(0, true) === 1;
      } else if (rek.tipus === REKORD.FORMAT) {
        formatumok.set(rek.dv.getUint16(0, true), xlsSzoveg(rek, 2, true));
      } else if (rek.tipus === REKORD.XF) {
        stilusok.push(rek.dv.getUint16(2, true));
      } else if (rek.tipus === REKORD.SST) {
        szovegek = xlsSst(rekordok, r);
      }
    }

    const cellaFormatum = stilusok.map((ifmt) => datumFormatum(ifmt, formatumok.get(ifmt)));
    return { lapok, szovegek, cellaFormatum, ezerkilencszaznegy };
  }

  /**
   * A közös szövegtábla (SST) átnyúlhat több rekordba. A folytatás elején
   * új jelzőbájt áll, ezért itt szegmensről szegmensre kell haladni.
   */
  function xlsSst(rekordok, kezdoIndex) {
    const szegmensek = [rekordok[kezdoIndex].adat];
    for (let i = kezdoIndex + 1; i < rekordok.length; i += 1) {
      if (rekordok[i].tipus !== REKORD.CONTINUE) break;
      szegmensek.push(rekordok[i].adat);
    }

    let szeg = 0;
    let poz = 0;

    const vege = () => szeg >= szegmensek.length;
    const igazit = () => {
      while (!vege() && poz >= szegmensek[szeg].length) { szeg += 1; poz = 0; }
    };
    const u8 = () => { igazit(); return vege() ? 0 : szegmensek[szeg][poz++]; };
    const u16 = () => { const a = u8(); return a | (u8() << 8); };
    const u32 = () => { const a = u16(); return (a | (u16() << 16)) >>> 0; };

    u32();                                   // összes hivatkozás
    const egyediek = u32();

    const ki = [];
    for (let n = 0; n < egyediek && !vege(); n += 1) {
      const cch = u16();
      let jelzo = u8();
      const gazdag = (jelzo & 0x08) !== 0;
      const kiterjesztett = (jelzo & 0x04) !== 0;
      const futamok = gazdag ? u16() : 0;
      const extraBajt = kiterjesztett ? u32() : 0;

      const darabok = [];
      let maradek = cch;

      while (maradek > 0) {
        igazit();
        if (vege()) break;

        const elerheto = szegmensek[szeg].length - poz;
        const szeles = (jelzo & 0x01) !== 0;
        const db = Math.min(maradek, szeles ? Math.floor(elerheto / 2) : elerheto);

        for (let i = 0; i < db; i += 1) {
          if (szeles) {
            darabok.push(String.fromCharCode(u16()));
          } else {
            const b = u8();
            darabok.push(String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_FELSO[b - 0x80] : b));
          }
        }
        maradek -= db;

        if (maradek > 0) {
          /* Új rekord következik: az elején megint jelzőbájt áll. */
          szeg += 1;
          poz = 0;
          if (vege()) break;
          jelzo = szegmensek[szeg][poz++];
        }
      }

      for (let i = 0; i < futamok; i += 1) { u16(); u16(); }
      for (let i = 0; i < extraBajt; i += 1) u8();

      ki.push(darabok.join(''));
    }

    return ki;
  }

  /** A tömörített számábrázolás (RK) kicsomagolása. */
  function rkErtek(rk) {
    const szazzal = (rk & 0x01) !== 0;
    let v;
    if (rk & 0x02) {
      v = rk >> 2;                         // előjeles egész a felső 30 biten
    } else {
      const puffer = new ArrayBuffer(8);
      const dv = new DataView(puffer);
      dv.setUint32(4, rk & 0xfffffffc, true);
      v = dv.getFloat64(0, true);
    }
    return szazzal ? v / 100 : v;
  }

  function xlsLapRacs(rekordok, bajtEltolas, globalis) {
    let kezdet = rekordok.findIndex((r) => r.helye === bajtEltolas);
    if (kezdet < 0) return [];
    kezdet += 1;

    const racs = [];
    const beir = (sor, oszlop, ertekSzoveg) => {
      while (racs.length <= sor) racs.push([]);
      const s = racs[sor];
      while (s.length <= oszlop) s.push('');
      s[oszlop] = ertekSzoveg;
    };

    const szam = (sor, oszlop, ixfe, nyers) => {
      beir(sor, oszlop, formazErtek(nyers, globalis.cellaFormatum[ixfe], globalis.ezerkilencszaznegy));
    };

    let utolsoKeplet = null;

    for (let i = kezdet; i < rekordok.length; i += 1) {
      const rek = rekordok[i];
      if (rek.tipus === REKORD.EOF) break;
      const dv = rek.dv;

      switch (rek.tipus) {
        case REKORD.LABELSST: {
          const isst = dv.getUint32(6, true);
          beir(dv.getUint16(0, true), dv.getUint16(2, true), globalis.szovegek[isst] || '');
          break;
        }
        case REKORD.LABEL:
        case REKORD.RSTRING:
          beir(dv.getUint16(0, true), dv.getUint16(2, true), xlsSzoveg(rek, 6, true));
          break;

        case REKORD.NUMBER:
          szam(dv.getUint16(0, true), dv.getUint16(2, true),
            dv.getUint16(4, true), dv.getFloat64(6, true));
          break;

        case REKORD.RK:
          szam(dv.getUint16(0, true), dv.getUint16(2, true),
            dv.getUint16(4, true), rkErtek(dv.getInt32(6, true)));
          break;

        case REKORD.MULRK: {
          const sor = dv.getUint16(0, true);
          const elso = dv.getUint16(2, true);
          const n = Math.floor((rek.adat.length - 6) / 6);
          for (let k = 0; k < n; k += 1) {
            const p = 4 + k * 6;
            szam(sor, elso + k, dv.getUint16(p, true), rkErtek(dv.getInt32(p + 2, true)));
          }
          break;
        }

        case REKORD.BOOLERR: {
          const hiba = dv.getUint8(7) === 1;
          const v = dv.getUint8(6);
          beir(dv.getUint16(0, true), dv.getUint16(2, true),
            hiba ? '#HIBA' : (v ? 'igaz' : 'hamis'));
          break;
        }

        case REKORD.FORMULA: {
          const sor = dv.getUint16(0, true);
          const oszlop = dv.getUint16(2, true);
          const ixfe = dv.getUint16(4, true);
          if (dv.getUint16(12, true) === 0xffff) {
            /* Nem szám az eredmény; szöveg esetén külön rekordban jön. */
            const fajtaja = dv.getUint8(6);
            if (fajtaja === 0) utolsoKeplet = { sor, oszlop };
            else if (fajtaja === 1) beir(sor, oszlop, dv.getUint8(8) ? 'igaz' : 'hamis');
            else if (fajtaja === 2) beir(sor, oszlop, '#HIBA');
            else beir(sor, oszlop, '');
          } else {
            szam(sor, oszlop, ixfe, dv.getFloat64(6, true));
          }
          break;
        }

        case REKORD.STRING:
          if (utolsoKeplet) {
            beir(utolsoKeplet.sor, utolsoKeplet.oszlop, xlsSzoveg(rek, 0, true));
            utolsoKeplet = null;
          }
          break;

        default:
          break;
      }
    }

    return racs;
  }

  /* ------------------------------------------------------------------ *
   * Közös kimenet
   * ------------------------------------------------------------------ */

  function osszefuz(blokkok) {
    return blokkok.filter((b) => b && b.trim() !== '').join('\n\n').trim();
  }

  /* ------------------------------------------------------------------ *
   * Nyilvános felület
   * ------------------------------------------------------------------ */

  async function feldolgoz(file) {
    const f = fajta(file.name);
    if (!f) throw new Error('nem támogatott formátum');
    if (file.size > MAX_MERET) {
      throw new Error(`túl nagy fájl (${Math.round(file.size / 1024 / 1024)} MB)`);
    }

    const bajtok = new Uint8Array(await file.arrayBuffer());

    let eredmeny;
    if (f === 'docx') eredmeny = olvasDocx(bajtok);
    else if (f === 'xlsx') eredmeny = olvasXlsx(bajtok);
    else if (f === 'doc') eredmeny = olvasDoc(bajtok);
    else eredmeny = olvasXls(bajtok);

    return Object.assign({ fajta: f, fajtaNev: FAJTA_NEVEK[f] }, eredmeny);
  }

  window.Iroda = { fajta, fajtaNev: (f) => FAJTA_NEVEK[f], feldolgoz };
})();
