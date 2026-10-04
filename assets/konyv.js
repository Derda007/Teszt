/*
 * Könyvek és sima szöveg olvasása – TXT, EPUB, MOBI.
 * ------------------------------------------------------------------
 *   .txt           sima szöveg, kódolásfelismeréssel
 *   .epub          ZIP + XHTML (a fejezetek a gerinc sorrendjében)
 *   .mobi / .prc   Palm-adatbázis (PDB) + Mobipocket HTML
 *
 * Mindegyikben valódi, gépi szöveg van, ezért itt sincs OCR.
 *
 * A modul a window.Konyv objektumot teszi elérhetővé.
 */

(function () {
  'use strict';

  const MAX_MERET = 120 * 1024 * 1024;

  const KITERJESZTESEK = {
    txt: 'txt', text: 'txt',
    epub: 'epub',
    mobi: 'mobi', prc: 'mobi', azw: 'mobi',
  };

  const FAJTA_NEVEK = {
    txt: 'szövegfájl',
    epub: 'EPUB e-könyv',
    mobi: 'MOBI e-könyv',
  };

  function kiterjesztes(nev) {
    const m = /\.([A-Za-z0-9]+)$/.exec(nev || '');
    return m ? m[1].toLowerCase() : '';
  }

  function fajta(nev) {
    return KITERJESZTESEK[kiterjesztes(nev)] || null;
  }

  /* ------------------------------------------------------------------ *
   * Szövegkódolás felismerése
   * ------------------------------------------------------------------ */

  /* Régi magyar szövegfájlok jellemzően közép-európai kódlapon készültek.
     A sorrend számít: az UTF-8-at pontosan el tudjuk dönteni, a többinél
     a magyar ékezetek száma dönt. */
  const KODLAPOK = ['windows-1250', 'iso-8859-2', 'windows-1252'];

  const MAGYAR_BETUK = 'áéíóöőúüűÁÉÍÓÖŐÚÜŰ';
  const GYANUS_BETUK = '�\u0000õûÕÛ¶§¤¬­¯°±²³·¸¹º¼½¾';

  /** @return a legvalószínűbb olvasat, kódolás szerint pontozva. */
  function szovegDekodol(bajtok) {
    if (bajtok.length >= 3 && bajtok[0] === 0xef && bajtok[1] === 0xbb && bajtok[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bajtok.subarray(3));
    }
    if (bajtok.length >= 2 && bajtok[0] === 0xff && bajtok[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(bajtok.subarray(2));
    }
    if (bajtok.length >= 2 && bajtok[0] === 0xfe && bajtok[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(bajtok.subarray(2));
    }

    /* Az UTF-8 nem találgatás kérdése: vagy érvényes, vagy nem. */
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bajtok);
    } catch (e) {
      /* nem UTF-8, megyünk tovább a kódlapokra */
    }

    let legjobb = null;
    let legjobbPont = -Infinity;

    for (const kodlap of KODLAPOK) {
      let szoveg;
      try {
        szoveg = new TextDecoder(kodlap).decode(bajtok);
      } catch (e) {
        continue;
      }
      const pont = kodlapPontszam(szoveg);
      if (pont > legjobbPont) { legjobbPont = pont; legjobb = szoveg; }
    }

    return legjobb !== null ? legjobb : new TextDecoder('windows-1252').decode(bajtok);
  }

  function kodlapPontszam(szoveg) {
    let pont = 0;
    const minta = szoveg.length > 200000 ? szoveg.slice(0, 200000) : szoveg;
    for (const ch of minta) {
      if (MAGYAR_BETUK.includes(ch)) pont += 2;
      else if (GYANUS_BETUK.includes(ch)) pont -= 3;
    }
    return pont;
  }

  /* ------------------------------------------------------------------ *
   * HTML -> Markdown
   * ------------------------------------------------------------------ */

  const BLOKK_ELEMEK = new Set([
    'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'div',
    'dl', 'dt', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
    'section', 'table', 'ul',
  ]);

  /* Ezekben nincs olvasható tartalom. */
  const KIHAGYOTT = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'svg']);

  /* A MOBI saját jelölői (pl. <mbp:pagebreak/>) nem önzáródnak a HTML
     szabályai szerint, ezért a mögöttük álló tartalom a belsejükbe kerül.
     Ezzel a szelektorral derítjük ki, hogy egy ismeretlen elem valójában
     blokkokat rejt-e – különben az egész fejezet egyetlen bekezdéssé
     olvadna össze. */
  const BLOKK_SZELEKTOR = Array.from(BLOKK_ELEMEK).join(',');

  function veddJelek(szoveg) {
    return String(szoveg).replace(/([\\`*[\]])/g, '\\$1');
  }

  function veddSorEleje(szoveg) {
    return String(szoveg)
      .replace(/^(\s*)([#>+-])/, '$1\\$2')
      .replace(/^(\s*)(\d{1,3})\./, '$1$2\\.');
  }

  function cellaSzoveg(szoveg) {
    return String(szoveg).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
  }

  /** Egy HTML-törzs Markdown-blokkokká alakítása. */
  function htmlMarkdown(torzs) {
    const blokkok = [];
    blokkBejar(torzs, blokkok);
    return blokkok
      .map((b) => b.replace(/[ \t]+$/gm, '').trim())
      .filter((b) => b !== '')
      .join('\n\n');
  }

  function blokkBejar(elem, ki) {
    let bekezdes = '';

    const lezar = () => {
      const t = bekezdes.replace(/[ \t]{2,}/g, ' ').trim();
      bekezdes = '';
      if (t) ki.push(veddSorEleje(t));
    };

    for (let cs = elem.firstChild; cs; cs = cs.nextSibling) {
      if (cs.nodeType === 3) {                       // szövegcsomópont
        bekezdes += veddJelek(cs.data.replace(/\s+/g, ' '));
        continue;
      }
      if (cs.nodeType !== 1) continue;

      const nev = cs.localName.toLowerCase();
      if (KIHAGYOTT.has(nev)) continue;

      if (BLOKK_ELEMEK.has(nev) || rejtBlokkot(cs)) {
        lezar();
        blokkElem(cs, nev, ki);
      } else {
        bekezdes += sorkoz(cs);
      }
    }

    lezar();
  }

  /** Ismeretlen elem, amelyben blokkszintű tartalom van? */
  function rejtBlokkot(elem) {
    return elem.firstElementChild !== null && elem.querySelector(BLOKK_SZELEKTOR) !== null;
  }

  function blokkElem(elem, nev, ki) {
    const cimsor = /^h([1-6])$/.exec(nev);
    if (cimsor) {
      const szoveg = sorkozTartalom(elem).trim();
      /* A fájlnévből lesz a # szintű cím, ezért a könyv címsorai eggyel lejjebb. */
      if (szoveg) ki.push(`${'#'.repeat(Math.min(Number(cimsor[1]) + 1, 6))} ${szoveg}`);
      return;
    }

    switch (nev) {
      case 'p': {
        /* A MOBI nem használ h1-h6 elemeket: a címsor nagyobb betűs,
           félkövér bekezdés. Ezt visszafordítjuk valódi címsorrá. */
        const szint = betumeretCimsor(elem);
        if (szint) {
          const szoveg = veddJelek(elem.textContent.replace(/\s+/g, ' ').trim());
          if (szoveg) { ki.push(`${'#'.repeat(szint)} ${szoveg}`); return; }
        }
        blokkBejar(elem, ki);
        return;
      }

      case 'hr':
        ki.push('---');
        return;

      case 'pre': {
        const szoveg = elem.textContent.replace(/\s+$/, '');
        if (szoveg.trim()) ki.push(['```', szoveg, '```'].join('\n'));
        return;
      }

      case 'blockquote': {
        const belso = [];
        blokkBejar(elem, belso);
        const szoveg = belso.join('\n\n').split('\n').map((s) => `> ${s}`).join('\n');
        if (szoveg.trim()) ki.push(szoveg);
        return;
      }

      case 'ul':
      case 'ol':
        listaElem(elem, nev === 'ol', 0, ki);
        return;

      case 'table':
        tablaElem(elem, ki);
        return;

      default:
        blokkBejar(elem, ki);
    }
  }

  /**
   * Címsor-e ez a bekezdés a betűmérete alapján?
   * A MOBI 1-7 közötti betűméretet használ; a 4 fölöttiek a címsorok.
   * @return a Markdown-címsor szintje, vagy 0.
   */
  function betumeretCimsor(p) {
    const font = p.querySelector('font[size]');
    if (!font) return 0;

    const meret = Number(font.getAttribute('size'));
    if (!Number.isFinite(meret) || meret < 4) return 0;

    const egesz = p.textContent.replace(/\s+/g, ' ').trim();
    if (!egesz || egesz.length > 120) return 0;

    /* Csak akkor címsor, ha gyakorlatilag az egész bekezdés nagyobb betűs. */
    const nagy = font.textContent.replace(/\s+/g, ' ').trim();
    if (nagy.length < egesz.length * 0.9) return 0;

    if (meret >= 7) return 2;
    if (meret >= 5) return 3;
    return 4;
  }

  function listaElem(lista, szamozott, szint, ki) {
    const sorok = [];
    let sorszam = 1;

    for (let cs = lista.firstElementChild; cs; cs = cs.nextElementSibling) {
      if (cs.localName.toLowerCase() !== 'li') continue;

      /* Az elemen belüli újabb lista külön sorokba kerül, behúzással. */
      const belso = [];
      const sajat = liTartalom(cs, belso);

      const jel = szamozott ? `${sorszam}.` : '-';
      sorszam += 1;
      sorok.push(`${'  '.repeat(szint)}${jel} ${sajat}`);

      for (const b of belso) sorok.push(b);
    }

    if (sorok.length) ki.push(sorok.join('\n'));
  }

  /** @return a listaelem saját szövege; a beágyazott listák a `ki` tömbbe. */
  function liTartalom(li, ki) {
    let szoveg = '';

    for (let cs = li.firstChild; cs; cs = cs.nextSibling) {
      if (cs.nodeType === 3) { szoveg += veddJelek(cs.data.replace(/\s+/g, ' ')); continue; }
      if (cs.nodeType !== 1) continue;

      const nev = cs.localName.toLowerCase();
      if (KIHAGYOTT.has(nev)) continue;

      if (nev === 'ul' || nev === 'ol') {
        const belso = [];
        listaElem(cs, nev === 'ol', 1, belso);
        for (const b of belso) ki.push(b.split('\n').map((s) => `  ${s}`).join('\n'));
      } else if (BLOKK_ELEMEK.has(nev)) {
        szoveg += `${szoveg ? ' ' : ''}${sorkozTartalom(cs)}`;
      } else {
        szoveg += sorkoz(cs);
      }
    }

    return szoveg.replace(/\s{2,}/g, ' ').trim();
  }

  function tablaElem(tabla, ki) {
    const racs = [];
    const sorok = tabla.getElementsByTagName('tr');

    for (let i = 0; i < sorok.length; i += 1) {
      const sor = [];
      for (let cs = sorok[i].firstElementChild; cs; cs = cs.nextElementSibling) {
        const nev = cs.localName.toLowerCase();
        if (nev !== 'td' && nev !== 'th') continue;
        let szoveg = cellaSzoveg(sorkozTartalom(cs));
        /* A fejléccella amúgy is kiemelve jelenik meg: a félkövér jelölés
           csak zajt vinne a forrásba. */
        if (nev === 'th') szoveg = szoveg.replace(/^\*\*(.*)\*\*$/, '$1');
        sor.push(szoveg);
      }
      if (sor.length) racs.push(sor);
    }

    if (racs.length === 0) return;

    const szelesseg = Math.max(...racs.map((s) => s.length));
    const kiegeszit = (s) => {
      const m = s.slice();
      while (m.length < szelesseg) m.push('');
      return m;
    };

    const sorMd = (s) => `| ${kiegeszit(s).join(' | ')} |`;
    const elvalaszto = `| ${Array(szelesseg).fill('---').join(' | ')} |`;

    ki.push([sorMd(racs[0]), elvalaszto].concat(racs.slice(1).map(sorMd)).join('\n'));
  }

  /** Sorközi (inline) elem Markdown-alakja. */
  function sorkoz(elem) {
    const nev = elem.localName.toLowerCase();

    if (nev === 'br') return '  \n';
    if (nev === 'img') {
      const alt = (elem.getAttribute('alt') || '').trim();
      return alt ? `*[kép: ${veddJelek(alt)}]*` : '';
    }

    const belso = sorkozTartalom(elem);
    if (!belso.trim()) return belso;

    if (nev === 'strong' || nev === 'b') return jelol(belso, '**');
    if (nev === 'em' || nev === 'i' || nev === 'cite') return jelol(belso, '*');
    if (nev === 'code' || nev === 'kbd' || nev === 'samp') return `\`${belso.replace(/`/g, '')}\``;
    if (nev === 'sup') return `^${belso}^`;
    if (nev === 'sub') return `~${belso}~`;

    if (nev === 'a') {
      const cim = (elem.getAttribute('href') || '').trim();
      /* A könyvön belüli ugrások célja a Markdownban nem létezik. */
      if (cim && /^(https?:|mailto:)/i.test(cim)) return `[${belso}](${cim})`;
      return belso;
    }

    return belso;
  }

  /** A jelölés csak a tényleges szövegre kerüljön, a széli szóközökre ne. */
  function jelol(szoveg, jel) {
    const eleje = szoveg.match(/^\s*/)[0];
    const vege = szoveg.match(/\s*$/)[0];
    const mag = szoveg.slice(eleje.length, szoveg.length - vege.length);
    return mag ? `${eleje}${jel}${mag}${jel}${vege}` : szoveg;
  }

  function sorkozTartalom(elem) {
    let ki = '';
    for (let cs = elem.firstChild; cs; cs = cs.nextSibling) {
      if (cs.nodeType === 3) ki += veddJelek(cs.data.replace(/\s+/g, ' '));
      else if (cs.nodeType === 1 && !KIHAGYOTT.has(cs.localName.toLowerCase())) ki += sorkoz(cs);
    }
    return ki;
  }

  function htmlDokumentum(szoveg) {
    const doc = new DOMParser().parseFromString(szoveg, 'text/html');
    return doc && doc.body ? doc.body : null;
  }

  /* ------------------------------------------------------------------ *
   * TXT
   * ------------------------------------------------------------------ */

  function olvasTxt(bajtok) {
    const szoveg = szovegDekodol(bajtok).replace(/\r\n?/g, '\n');
    if (!szoveg.trim()) throw new Error('a fájl nem tartalmaz szöveget');

    /* A sima szöveg szerkezetét az alkalmazás közös Markdown-építője
       rakja össze, a felhasználó beállításai szerint. */
    return { nyersSzoveg: szoveg, sorok: szoveg.split('\n').length };
  }

  /* ------------------------------------------------------------------ *
   * EPUB
   * ------------------------------------------------------------------ */

  const UTF8 = new TextDecoder('utf-8');

  function csomagSzoveg(csomag, ut) {
    const nyers = csomag[ut];
    return nyers ? UTF8.decode(nyers) : null;
  }

  function xmlDoc(szoveg) {
    const doc = new DOMParser().parseFromString(szoveg, 'application/xml');
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
  }

  /** Az EPUB-on belüli hivatkozások feloldása az OPF könyvtárához képest. */
  function utvonalEgyesit(alap, relativ) {
    const cim = decodeURIComponent(String(relativ).split('#')[0]);
    if (!alap) return cim;

    const reszek = alap.split('/').slice(0, -1).concat(cim.split('/'));
    const ki = [];
    for (const r of reszek) {
      if (r === '' || r === '.') continue;
      if (r === '..') ki.pop();
      else ki.push(r);
    }
    return ki.join('/');
  }

  function olvasEpub(csomag) {
    if (csomag['META-INF/encryption.xml']) {
      throw new Error('a könyv másolásvédett (DRM), a tartalma nem olvasható ki');
    }

    const konteiner = csomagSzoveg(csomag, 'META-INF/container.xml');
    if (!konteiner) throw new Error('hiányzik a META-INF/container.xml – lehet, hogy nem EPUB');

    const kdoc = xmlDoc(konteiner);
    const rootfile = kdoc && kdoc.getElementsByTagName('rootfile')[0];
    const opfUt = rootfile && rootfile.getAttribute('full-path');
    if (!opfUt) throw new Error('nem található a könyv leíró fájlja (OPF)');

    const opfSzoveg = csomagSzoveg(csomag, opfUt);
    if (!opfSzoveg) throw new Error(`hiányzik a leíró fájl: ${opfUt}`);
    const opf = xmlDoc(opfSzoveg);
    if (!opf) throw new Error('sérült a könyv leíró fájlja');

    const meta = epubMetaadat(opf);
    const elemek = new Map();
    const osszes = opf.getElementsByTagName('*');

    for (let i = 0; i < osszes.length; i += 1) {
      const e = osszes[i];
      if (e.localName !== 'item') continue;
      elemek.set(e.getAttribute('id'), {
        href: e.getAttribute('href'),
        tipus: e.getAttribute('media-type') || '',
      });
    }

    const blokkok = [];
    let fejezetek = 0;

    for (let i = 0; i < osszes.length; i += 1) {
      const e = osszes[i];
      if (e.localName !== 'itemref') continue;

      const elem = elemek.get(e.getAttribute('idref'));
      if (!elem || !elem.href) continue;
      if (elem.tipus && !/x?html/i.test(elem.tipus)) continue;

      const szoveg = csomagSzoveg(csomag, utvonalEgyesit(opfUt, elem.href));
      if (!szoveg) continue;

      const torzs = htmlDokumentum(szoveg);
      if (!torzs) continue;

      const md = htmlMarkdown(torzs);
      if (!md) continue;

      /* Ha a fejezet nem kezdődik címsorral, a lap saját címét használjuk. */
      if (!/^#{2,6}\s/.test(md)) {
        const cim = fejezetCim(szoveg);
        if (cim) blokkok.push(`## ${veddJelek(cim)}`);
      }

      blokkok.push(md);
      fejezetek += 1;
    }

    if (blokkok.length === 0) throw new Error('a könyv nem tartalmaz olvasható fejezetet');

    return {
      markdown: blokkok.join('\n\n'),
      cim: meta.cim,
      szerzo: meta.szerzo,
      fejezetek,
    };
  }

  function fejezetCim(szoveg) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(szoveg);
    if (!m) return null;
    const cim = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return cim && cim.length <= 120 ? cim : null;
  }

  function epubMetaadat(opf) {
    const ki = { cim: null, szerzo: null };
    const elemek = opf.getElementsByTagName('*');
    for (let i = 0; i < elemek.length; i += 1) {
      const e = elemek[i];
      const szoveg = (e.textContent || '').trim();
      if (!szoveg) continue;
      if (e.localName === 'title' && !ki.cim) ki.cim = szoveg;
      else if (e.localName === 'creator' && !ki.szerzo) ki.szerzo = szoveg;
    }
    return ki;
  }

  /* ------------------------------------------------------------------ *
   * MOBI
   * ------------------------------------------------------------------ */

  function olvasMobi(bajtok) {
    const dv = new DataView(bajtok.buffer, bajtok.byteOffset, bajtok.byteLength);

    if (bajtok.length < 78) throw new Error('a fájl túl rövid egy MOBI könyvhöz');

    const tipus = String.fromCharCode(...bajtok.subarray(60, 68));
    if (!/^(BOOK|TEXt)(MOBI|REAd)$/.test(tipus)) {
      throw new Error('a fájl nem Mobipocket/MOBI könyv');
    }

    /* A Palm-adatbázis rekordok sorozata; a fejléc mondja meg, hol kezdődnek. */
    const rekordSzam = dv.getUint16(76, false);
    const rekordok = [];
    for (let i = 0; i < rekordSzam; i += 1) {
      const p = 78 + i * 8;
      if (p + 8 > bajtok.length) break;
      rekordok.push(dv.getUint32(p, false));
    }
    rekordok.push(bajtok.length);

    const rekord = (i) => (i + 1 < rekordok.length
      ? bajtok.subarray(rekordok[i], Math.min(rekordok[i + 1], bajtok.length))
      : null);

    const fej = rekord(0);
    if (!fej || fej.length < 16) throw new Error('hiányzik a könyv fejléce');
    const fdv = new DataView(fej.buffer, fej.byteOffset, fej.byteLength);

    const tomorites = fdv.getUint16(0, false);
    const szovegHossz = fdv.getUint32(4, false);
    const szovegRekordok = fdv.getUint16(8, false);
    const titkositas = fdv.getUint16(12, false);

    if (titkositas !== 0) {
      throw new Error('a könyv másolásvédett (DRM), a tartalma nem olvasható ki');
    }
    if (tomorites === 17480) {
      throw new Error('a könyv az Amazon saját tömörítését használja (HUFF/CDIC), '
        + 'amit ez az alkalmazás nem bont ki – alakítsd át EPUB-ba (pl. Calibre-rel)');
    }
    if (tomorites !== 1 && tomorites !== 2) {
      throw new Error(`ismeretlen tömörítés a könyvben (${tomorites})`);
    }

    const mobi = fej.length > 20 && String.fromCharCode(...fej.subarray(16, 20)) === 'MOBI';
    const kodolas = mobi ? fdv.getUint32(28, false) : 1252;
    const mobiHossz = mobi ? fdv.getUint32(20, false) : 0;

    /* A rekordok végén szolgálati adatok lehetnek; azokat le kell vágni,
       különben szemét kerül a szöveg közé. */
    let extraJelzok = 0;
    if (mobi && mobiHossz >= 0xe4 && fej.length >= 0xf4) extraJelzok = fdv.getUint16(0xf2, false);
    const tobbBajtos = extraJelzok & 1;
    let vegzodesek = 0;
    for (let v = extraJelzok >> 1; v; v >>= 1) vegzodesek += v & 1;

    const darabok = [];
    let osszHossz = 0;

    for (let i = 1; i <= szovegRekordok; i += 1) {
      let adat = rekord(i);
      if (!adat) break;

      adat = vagdVegzodeseket(adat, vegzodesek, tobbBajtos);
      const kibontva = tomorites === 2 ? palmDocKibont(adat) : adat;
      darabok.push(kibontva);
      osszHossz += kibontva.length;
      if (osszHossz >= szovegHossz && szovegHossz > 0) break;
    }

    let nyers = new Uint8Array(osszHossz);
    let p = 0;
    for (const d of darabok) { nyers.set(d, p); p += d.length; }
    if (szovegHossz > 0 && nyers.length > szovegHossz) nyers = nyers.subarray(0, szovegHossz);

    const html = kodolas === 65001
      ? new TextDecoder('utf-8').decode(nyers)
      : szovegDekodol(nyers);

    const torzs = htmlDokumentum(html);
    if (!torzs) throw new Error('a könyv tartalmát nem sikerült értelmezni');

    const markdown = htmlMarkdown(torzs);
    if (!markdown) throw new Error('a könyv nem tartalmaz olvasható szöveget');

    return {
      markdown,
      cim: mobiCim(fej, fdv, mobi),
      szerzo: exthSzerzo(fej, fdv, mobi, mobiHossz),
      fejezetek: 0,
    };
  }

  /** A rekordok végére fűzött szolgálati adatok levágása. */
  function vagdVegzodeseket(adat, vegzodesek, tobbBajtos) {
    let vege = adat.length;

    for (let i = 0; i < vegzodesek; i += 1) {
      let meret = 0;
      for (let k = Math.max(0, vege - 4); k < vege; k += 1) {
        const b = adat[k];
        if (b & 0x80) meret = 0;
        meret = (meret << 7) | (b & 0x7f);
      }
      vege -= meret;
      if (vege <= 0) return adat.subarray(0, 0);
    }

    if (tobbBajtos && vege > 0) {
      vege -= (adat[vege - 1] & 3) + 1;
      if (vege < 0) vege = 0;
    }

    return adat.subarray(0, vege);
  }

  /** PalmDOC LZ77-kibontás. */
  function palmDocKibont(adat) {
    const ki = [];
    let i = 0;

    while (i < adat.length) {
      const b = adat[i];
      i += 1;

      if (b === 0) {
        ki.push(0);
      } else if (b <= 8) {                       // következő b bájt szó szerint
        for (let k = 0; k < b && i < adat.length; k += 1) { ki.push(adat[i]); i += 1; }
      } else if (b <= 0x7f) {
        ki.push(b);
      } else if (b <= 0xbf) {                    // visszahivatkozás a már kiírtra
        if (i >= adat.length) break;
        const parosit = (b << 8) | adat[i];
        i += 1;
        const tavolsag = (parosit >> 3) & 0x07ff;
        const hossz = (parosit & 7) + 3;
        if (tavolsag === 0 || tavolsag > ki.length) break;
        for (let k = 0; k < hossz; k += 1) ki.push(ki[ki.length - tavolsag]);
      } else {                                   // szóköz + betű egy bájton
        ki.push(32);
        ki.push(b ^ 0x80);
      }
    }

    return Uint8Array.from(ki);
  }

  function mobiCim(fej, fdv, mobi) {
    if (!mobi || fej.length < 92) return null;
    const eltolas = fdv.getUint32(84, false);
    const hossz = fdv.getUint32(88, false);
    if (!hossz || eltolas + hossz > fej.length) return null;
    const cim = new TextDecoder('utf-8').decode(fej.subarray(eltolas, eltolas + hossz)).trim();
    return cim || null;
  }

  /** A szerző az EXTH kiegészítő rekordok 100-as mezőjében van. */
  function exthSzerzo(fej, fdv, mobi, mobiHossz) {
    if (!mobi || fej.length < 132) return null;
    const jelzok = fdv.getUint32(128, false);
    if (!(jelzok & 0x40)) return null;

    const kezdet = 16 + mobiHossz;
    if (kezdet + 12 > fej.length) return null;
    if (String.fromCharCode(...fej.subarray(kezdet, kezdet + 4)) !== 'EXTH') return null;

    const darab = fdv.getUint32(kezdet + 8, false);
    let p = kezdet + 12;

    for (let i = 0; i < darab && p + 8 <= fej.length; i += 1) {
      const tipus = fdv.getUint32(p, false);
      const hossz = fdv.getUint32(p + 4, false);
      if (hossz < 8 || p + hossz > fej.length) break;
      if (tipus === 100) {
        const nev = new TextDecoder('utf-8').decode(fej.subarray(p + 8, p + hossz)).trim();
        if (nev) return nev;
      }
      p += hossz;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Nyilvános felület
   * ------------------------------------------------------------------ */

  function tarolo(bajtok) {
    if (bajtok.length >= 4 && bajtok[0] === 0x50 && bajtok[1] === 0x4b
        && (bajtok[2] === 0x03 || bajtok[2] === 0x05 || bajtok[2] === 0x07)) {
      return 'zip';
    }
    if (bajtok.length >= 68) {
      const tipus = String.fromCharCode(...bajtok.subarray(60, 68));
      if (/^(BOOK|TEXt)(MOBI|REAd)$/.test(tipus)) return 'pdb';
    }
    return null;
  }

  async function feldolgoz(file) {
    const f = fajta(file.name);
    if (!f) throw new Error('nem támogatott formátum');
    if (file.size > MAX_MERET) {
      throw new Error(`túl nagy fájl (${Math.round(file.size / 1024 / 1024)} MB)`);
    }

    const bajtok = new Uint8Array(await file.arrayBuffer());
    const t = tarolo(bajtok);

    if (t === 'zip') {
      if (typeof fflate === 'undefined') throw new Error('a ZIP-olvasó nem töltődött be');
      let csomag;
      try {
        csomag = fflate.unzipSync(bajtok);
      } catch (e) {
        throw new Error('a fájl sérült vagy nem nyitható meg');
      }
      return Object.assign({ fajta: 'epub', fajtaNev: FAJTA_NEVEK.epub }, olvasEpub(csomag));
    }

    if (t === 'pdb') {
      return Object.assign({ fajta: 'mobi', fajtaNev: FAJTA_NEVEK.mobi }, olvasMobi(bajtok));
    }

    if (f === 'txt') {
      return Object.assign({ fajta: 'txt', fajtaNev: FAJTA_NEVEK.txt }, olvasTxt(bajtok));
    }

    throw new Error('a fájl tartalma nem egyezik a kiterjesztésével');
  }

  window.Konyv = { fajta, fajtaNev: (f) => FAJTA_NEVEK[f], feldolgoz };
})();
