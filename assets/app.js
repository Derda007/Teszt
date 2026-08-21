/*
 * OCR Szövegkinyerő
 * ------------------------------------------------------------------
 * Képekből és PDF-ekből nyer ki szöveget a Tesseract OCR motorral,
 * majd Markdown dokumentumot állít elő belőle.
 *
 * Minden művelet a böngészőben fut: nincs szerver, nincs feltöltés,
 * és nincs mesterséges intelligencia – a Tesseract klasszikus,
 * szabályalapú/statisztikai OCR motor WebAssembly formában.
 */

/* A lábléc kiírja: így egy pillanat alatt látszik, ha a böngésző még a
   gyorsítótárból szolgálja ki a régi változatot. Frissítéskor az
   index.html "?v=" paramétereit is állítsd ugyanerre. */
const APP_VERSION = '1.1.0';

/* Az oldal saját címéhez képest oldjuk fel a hivatkozásokat, hogy a
   projekt alkönyvtárból kiszolgálva is működjön. */
const asset = (path) => new URL(path, document.baseURI).href;

/* A pdf.js ES-modul, ezért csak akkor töltjük be, amikor tényleg PDF
   érkezik. Így egy hiányzó vagy elérhetetlen pdf.js nem bénítja meg az
   egész oldalt – a képek felismerése ilyenkor is működik. */
let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(asset('vendor/pdfjs/pdf.min.mjs')).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = asset('vendor/pdfjs/pdf.worker.min.mjs');
      return lib;
    });
  }
  return pdfjsPromise;
}

const PDFJS_ASSETS = {
  get cMapUrl() { return asset('vendor/pdfjs/cmaps/'); },
  cMapPacked: true,
  get standardFontDataUrl() { return asset('vendor/pdfjs/standard_fonts/'); },
};

const TESSERACT_PATHS = {
  get workerPath() { return asset('vendor/tesseract/worker.min.js'); },
  get corePath() { return asset('vendor/tesseract/'); },
  get langPath() { return asset('vendor/tessdata'); },
};

/* Az Android-alkalmazásban a beágyazott böngészőmotor kapja ezt a lapot.
   A mentési híd jelenlétéből tudjuk, hogy ott futunk. */
const ANDROID_ALKALMAZAS = typeof window.OcrAndroid !== 'undefined';

/* A felismerésnél a Tesseract legfeljebb ekkora oldalt kap; e fölött
   arányosan kicsinyítünk, hogy a memóriahasználat kordában maradjon.
   Telefonon szűkösebb a memória, egy mai kameraképnél pedig 3200 képpont
   is bőven elég a jó felismeréshez. */
const MAX_SIDE = ANDROID_ALKALMAZAS ? 3200 : 4200;

const NYELV_NEVEK = { hun: 'magyar', eng: 'angol', deu: 'német' };

const STATUS_SZOTAR = {
  'loading tesseract core': 'OCR motor betöltése',
  'initializing tesseract': 'OCR motor indítása',
  'initialized tesseract': 'OCR motor kész',
  'loading language traineddata': 'Nyelvi adatok betöltése',
  'loaded language traineddata': 'Nyelvi adatok betöltve',
  'initializing api': 'Felismerés előkészítése',
  'initialized api': 'Felismerés előkészítve',
  'recognizing text': 'Szöveg felismerése',
};

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const el = {
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  fileList: $('fileList'),
  emptyHint: $('emptyHint'),
  pasteBtn: $('pasteBtn'),
  lang: $('langSelect'),
  psm: $('psmSelect'),
  dpi: $('dpiSelect'),
  rotate: $('rotateSelect'),
  optGray: $('optGray'),
  optContrast: $('optContrast'),
  optBinarize: $('optBinarize'),
  optUpscale: $('optUpscale'),
  optJoin: $('optJoin'),
  optHyphen: $('optHyphen'),
  optHeadings: $('optHeadings'),
  optLists: $('optLists'),
  optPageMarks: $('optPageMarks'),
  optFrontMatter: $('optFrontMatter'),
  optPdfText: $('optPdfText'),
  startBtn: $('startBtn'),
  cancelBtn: $('cancelBtn'),
  clearBtn: $('clearBtn'),
  progressBox: $('progressBox'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  statusMsg: $('statusMsg'),
  resultCard: $('resultCard'),
  tabPreview: $('tabPreview'),
  tabSource: $('tabSource'),
  previewPane: $('previewPane'),
  sourcePane: $('sourcePane'),
  resultMeta: $('resultMeta'),
  downloadBtn: $('downloadBtn'),
  downloadEachBtn: $('downloadEachBtn'),
  copyBtn: $('copyBtn'),
  appVersion: $('appVersion'),
};

/* ------------------------------------------------------------------ *
 * Állapot
 * ------------------------------------------------------------------ */

const state = {
  files: [],          // { id, file, kind, status, note, noteClass }
  results: [],        // { name, markdown }
  running: false,
  cancelled: false,
  blocked: false,
  blockedMessage: null,
  worker: null,
  workerLang: null,
  nextId: 1,
  pasteCount: 1,
};

/* ------------------------------------------------------------------ *
 * Fájlkezelés
 * ------------------------------------------------------------------ */

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isImage = (file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|tiff?|pnm)$/i.test(file.name);

function addFiles(list, addedMessage = null) {
  if (state.running) {
    setStatus('Feldolgozás közben nem lehet új fájlt hozzáadni. Várd meg a végét, vagy szakítsd meg.', 'warn');
    return 0;
  }

  const beforeCount = state.files.length;
  let skipped = 0;

  for (const file of list) {
    if (!isPdf(file) && !isImage(file)) { skipped += 1; continue; }
    const dup = state.files.some((f) => f.file.name === file.name && f.file.size === file.size);
    if (dup) { skipped += 1; continue; }

    state.files.push({
      id: state.nextId++,
      file,
      kind: isPdf(file) ? 'pdf' : 'image',
      status: 'varakozik',
      note: formatSize(file.size),
      noteClass: '',
    });
  }

  renderFiles();

  const added = state.files.length - beforeCount;

  if (skipped > 0) {
    setStatus(`${skipped} fájl kimaradt (nem támogatott formátum vagy már a listán van).`, 'warn');
  } else if (added > 0 && addedMessage) {
    setStatus(addedMessage(added), 'ok');
  } else if (added > 0) {
    hideStatus();
  }

  return added;
}

/* ------------------------------------------------------------------ *
 * Beillesztés a vágólapról
 * ------------------------------------------------------------------ */

/** A vágólapról érkező képek neve üres vagy általános ("image.png"),
 *  ezért sorszámozott, beszédes nevet adunk nekik. */
function nameClipboardImage(blob) {
  const generic = !blob.name || /^(image|kép)\.\w+$/i.test(blob.name);
  if (!generic) return blob;
  const ext = ((blob.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg');
  return new File([blob], `vagolap-${state.pasteCount++}.${ext}`, {
    type: blob.type || 'image/png',
    lastModified: Date.now(),
  });
}

const pasteMessage = (n) => (n === 1
  ? 'Kép beillesztve a vágólapról.'
  : `${n} kép beillesztve a vágólapról.`);

/** Ctrl+V az oldalon: képernyőkép vagy másolt fájl beillesztése. */
function handlePaste(event) {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;

  const data = event.clipboardData;
  if (!data) return;

  const collected = [];

  for (const file of data.files || []) {
    if (isPdf(file)) collected.push(file);
    else if (isImage(file)) collected.push(nameClipboardImage(file));
  }

  if (collected.length === 0) {
    for (const item of data.items || []) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const blob = item.getAsFile();
      if (blob) collected.push(nameClipboardImage(blob));
    }
  }

  if (collected.length === 0) return;

  event.preventDefault();
  addFiles(collected, pasteMessage);
}

/** A "Beillesztés vágólapról" gomb – ott is működik, ahol a Ctrl+V
 *  nem jut el az oldalig (a böngésző engedélyt kérhet rá). */
async function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    setStatus('Ez a böngésző nem engedi a vágólap kiolvasását. Használd a Ctrl+V billentyűt.', 'warn');
    return;
  }

  try {
    const collected = [];
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/')) || item.types.find((t) => t === 'application/pdf');
      if (!type) continue;
      const blob = await item.getType(type);
      collected.push(nameClipboardImage(new File([blob], '', { type })));
    }

    if (collected.length === 0) {
      setStatus('A vágólapon nincs kép. Készíts képernyőképet, majd próbáld újra.', 'warn');
      return;
    }

    addFiles(collected, pasteMessage);
  } catch {
    setStatus('A vágólap olvasásához a böngésző engedélye kell. Engedélyezd, vagy használd a Ctrl+V billentyűt.', 'warn');
  }
}

function removeFile(id) {
  state.files = state.files.filter((f) => f.id !== id);
  renderFiles();
}

function renderFiles() {
  el.fileList.textContent = '';

  for (const item of state.files) {
    const li = document.createElement('li');
    li.className = 'fileitem';

    const icon = document.createElement('span');
    icon.className = 'fileitem__icon';
    icon.textContent = item.kind === 'pdf' ? '📕' : '🖼️';
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'fileitem__name';
    name.textContent = item.file.name;
    const meta = document.createElement('div');
    meta.className = `fileitem__meta${item.noteClass ? ` ${item.noteClass}` : ''}`;
    meta.textContent = item.note;
    body.append(name, meta);

    const del = document.createElement('button');
    del.className = 'iconbtn';
    del.type = 'button';
    del.title = 'Eltávolítás a listáról';
    del.setAttribute('aria-label', `${item.file.name} eltávolítása`);
    del.textContent = '✕';
    del.disabled = state.running;
    del.addEventListener('click', () => removeFile(item.id));

    li.append(icon, body, del);
    el.fileList.append(li);
  }

  const has = state.files.length > 0;
  el.emptyHint.hidden = has;
  el.startBtn.disabled = !has || state.running || state.blocked;
  el.clearBtn.disabled = !has || state.running;

  /* Letiltott gomb sose maradjon magyarázat nélkül. */
  if (state.blocked) el.startBtn.title = state.blockedMessage || '';
  else if (state.running) el.startBtn.title = 'Feldolgozás folyamatban…';
  else if (!has) el.startBtn.title = 'Előbb adj hozzá legalább egy képet vagy PDF-et.';
  else el.startBtn.title = '';
}

function setNote(item, text, cls = '') {
  item.note = text;
  item.noteClass = cls;
  renderFiles();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ *
 * Visszajelzés
 * ------------------------------------------------------------------ */

function setStatus(text, kind = 'ok') {
  /* Amíg a működésnek valódi akadálya van, az marad a képernyőn. */
  if (state.blockedMessage && kind !== 'err') {
    text = state.blockedMessage;
    kind = 'err';
  }
  el.statusMsg.textContent = text;
  el.statusMsg.className = `status is-${kind}`;
  el.statusMsg.hidden = false;
}

function hideStatus() {
  /* A működést gátló hibát nem söpörjük el – különben a felhasználó
     csak egy megmagyarázatlanul letiltott gombot látna. */
  if (state.blockedMessage) {
    setStatus(state.blockedMessage, 'err');
    return;
  }
  el.statusMsg.hidden = true;
}

function setProgress(ratio, text) {
  el.progressFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  if (text) el.progressText.textContent = text;
}

/* ------------------------------------------------------------------ *
 * Képelőkészítés
 * ------------------------------------------------------------------ */

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Forgatás + méretezés egy rajzolható forrásból (kép vagy vászon). */
function drawTransformed(source, srcW, srcH, rotation, scale) {
  const w = srcW * scale;
  const h = srcH * scale;
  const swap = rotation === 90 || rotation === 270;
  const canvas = makeCanvas(swap ? h : w, swap ? w : h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
  return canvas;
}

/** Szürkeárnyalat, kontrasztnyújtás és küszöbölés a beállítások szerint. */
function enhance(canvas, opts) {
  if (!opts.gray && !opts.contrast && !opts.binarize) return canvas;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const luma = new Uint8ClampedArray(px.length / 4);

  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
    luma[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
  }

  let lo = 0;
  let hi = 255;
  if (opts.contrast) {
    const hist = new Uint32Array(256);
    for (let j = 0; j < luma.length; j += 1) hist[luma[j]] += 1;
    const cut = Math.floor(luma.length * 0.005);   // alsó/felső 0,5% levágása
    let acc = 0;
    for (let v = 0; v < 256; v += 1) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v -= 1) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 32) { lo = 0; hi = 255; }        // túl lapos hisztogram: ne rontsunk rajta
  }

  const span = hi - lo || 1;
  for (let j = 0; j < luma.length; j += 1) {
    let v = luma[j];
    if (opts.contrast) v = Math.max(0, Math.min(255, ((v - lo) * 255) / span));
    luma[j] = v;
  }

  const threshold = opts.binarize ? otsu(luma) : 0;

  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
    let v = luma[j];
    if (opts.binarize) v = v > threshold ? 255 : 0;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Otsu-küszöb: a kétcsúcsú hisztogram optimális szétválasztása. */
function otsu(luma) {
  const hist = new Uint32Array(256);
  for (let j = 0; j < luma.length; j += 1) hist[luma[j]] += 1;

  const total = luma.length;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) sum += v * hist[v];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;

  for (let v = 0; v < 256; v += 1) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = v; }
  }
  return best;
}

function readOptions() {
  return {
    lang: el.lang.value,
    psm: el.psm.value,
    dpi: Number(el.dpi.value),
    rotation: Number(el.rotate.value),
    gray: el.optGray.checked,
    contrast: el.optContrast.checked,
    binarize: el.optBinarize.checked,
    upscale: el.optUpscale.checked,
    join: el.optJoin.checked,
    hyphen: el.optHyphen.checked,
    headings: el.optHeadings.checked,
    lists: el.optLists.checked,
    pageMarks: el.optPageMarks.checked,
    frontMatter: el.optFrontMatter.checked,
    pdfText: el.optPdfText.checked,
  };
}

/* ------------------------------------------------------------------ *
 * OCR motor
 * ------------------------------------------------------------------ */

/* A Tesseract logger már a worker létrejötte előtt is tüzel, ezért a
   pillanatnyi visszajelzés-kezelőt modulszinten tartjuk. */
let progressHook = null;

async function getWorker(lang, onProgress) {
  progressHook = onProgress;

  if (state.worker && state.workerLang === lang) return state.worker;

  if (state.worker) {
    await state.worker.terminate();
    state.worker = null;
    state.workerLang = null;
  }

  state.worker = await Tesseract.createWorker(lang, 1, {
    ...TESSERACT_PATHS,
    /* A beágyazott böngészőmotor egyes változatai nem engedik át a
       blob:-ból indított háttérszál kéréseit, ezért ott a worker fájlját
       közvetlenül a saját címéről töltjük be. */
    workerBlobURL: !ANDROID_ALKALMAZAS,
    logger: (m) => { if (progressHook) progressHook(m); },
  });
  state.workerLang = lang;
  return state.worker;
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

/**
 * A PDF beágyazott szövegrétegének kiolvasása: a darabkákat sorokká,
 * a sorokat a függőleges térközök alapján bekezdésekké rendezi.
 * A visszaadott alak megegyezik az OCR-ből származóval.
 */
function textLayerToParagraphs(textContent) {
  const items = textContent.items
    .filter((it) => typeof it.str === 'string' && it.str.length > 0)
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      width: it.width || 0,
      size: Math.abs(it.transform[3]) || it.height || 0,
    }));

  if (items.length === 0) return { paragraphs: [], text: '' };

  items.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));

  const lines = [];
  let current = null;

  for (const it of items) {
    if (!current || Math.abs(it.y - current.y) > 2) {
      current = { y: it.y, parts: [], sizes: [], lastEnd: null };
      lines.push(current);
    }
    if (current.lastEnd !== null && it.x - current.lastEnd > 1 && !/\s$/.test(current.parts.at(-1) || '')) {
      current.parts.push(' ');
    }
    current.parts.push(it.str);
    current.sizes.push(it.size);
    current.lastEnd = it.x + it.width;
  }

  const rows = lines
    .map((l) => ({
      y: l.y,
      text: l.parts.join('').replace(/\s+/g, ' ').trim(),
      size: median(l.sizes.filter((s) => s > 0)),
    }))
    .filter((l) => l.text.length > 0);

  if (rows.length === 0) return { paragraphs: [], text: '' };

  /* Bekezdéshatár ott van, ahol a sorköz észrevehetően nagyobb a szokásosnál. */
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i - 1].y - rows[i].y);
  const typical = median(gaps);

  const paragraphs = [[rows[0]]];
  for (let i = 1; i < rows.length; i += 1) {
    const bigGap = typical > 0 && rows[i - 1].y - rows[i].y > typical * 1.4;
    if (bigGap) paragraphs.push([rows[i]]);
    else paragraphs[paragraphs.length - 1].push(rows[i]);
  }

  return {
    paragraphs: paragraphs.map((p) => p.map(({ text, size }) => ({ text, size }))),
    text: rows.map((r) => r.text).join('\n'),
  };
}

/* ------------------------------------------------------------------ *
 * Feldolgozási folyamat
 * ------------------------------------------------------------------ */

async function run() {
  if (state.running || state.files.length === 0) return;

  const opts = readOptions();

  state.running = true;
  state.cancelled = false;
  state.results = [];

  el.startBtn.disabled = true;
  el.clearBtn.disabled = true;
  el.cancelBtn.hidden = false;
  el.progressBox.hidden = false;
  el.resultCard.hidden = true;
  hideStatus();
  renderFiles();
  setProgress(0, 'Előkészítés…');

  const total = state.files.length;
  let done = 0;
  let failed = 0;

  try {
    for (const item of state.files) {
      if (state.cancelled) break;

      const label = `${done + 1}/${total} – ${item.file.name}`;
      const fileProgress = (frac, text) => setProgress((done + frac) / total, `${label} · ${text}`);

      setNote(item, 'feldolgozás alatt…');
      try {
        const result = item.kind === 'pdf'
          ? await processPdf(item.file, opts, fileProgress)
          : await processImage(item.file, opts, fileProgress);

        if (state.cancelled) break;

        state.results.push({ name: item.file.name, markdown: result.markdown });
        setNote(item, describeResult(result), result.confidence !== null && result.confidence < 70 ? 'is-warn' : 'is-ok');
      } catch (err) {
        failed += 1;
        console.error(err);
        setNote(item, `hiba: ${err && err.message ? err.message : 'ismeretlen hiba'}`, 'is-err');
      }

      done += 1;
      setProgress(done / total, `${done}/${total} fájl kész`);
    }
  } finally {
    state.running = false;
    el.cancelBtn.hidden = true;
    el.progressBox.hidden = true;
    renderFiles();
  }

  if (state.results.length > 0) showResults();

  if (state.cancelled) {
    setStatus(`Megszakítva. ${state.results.length} fájl eredménye elkészült.`, 'warn');
  } else if (failed > 0) {
    setStatus(`Kész: ${state.results.length} sikeres, ${failed} sikertelen fájl.`, 'warn');
  } else if (state.results.length > 0) {
    setStatus(`Kész: ${state.results.length} fájl feldolgozva.`, 'ok');
  } else {
    setStatus('Egyetlen fájlt sem sikerült feldolgozni.', 'err');
  }
}

function describeResult(result) {
  const parts = [];
  parts.push(result.pages === 1 ? '1 oldal' : `${result.pages} oldal`);
  parts.push(`${result.chars.toLocaleString('hu-HU')} karakter`);
  if (result.confidence !== null) parts.push(`megbízhatóság: ${result.confidence}%`);
  if (result.fromTextLayer) parts.push('beágyazott PDF-szövegből');
  return parts.join(' · ');
}

async function processImage(file, opts, onProgress) {
  onProgress(0.05, 'kép előkészítése');

  const input = await prepareImageInput(file, opts);
  const page = await recognize(input, opts, (p) => onProgress(0.1 + p * 0.85, 'szöveg felismerése'));

  onProgress(0.98, 'Markdown összeállítása');

  const markdown = buildDocument({
    title: baseName(file.name),
    source: file.name,
    pages: [page],
    opts,
    fromTextLayer: false,
  });

  return {
    markdown,
    pages: 1,
    chars: page.text.length,
    confidence: page.confidence,
    fromTextLayer: false,
  };
}

/** Képfájlból vászon (előfeldolgozással); ha a böngésző nem tudja
 *  dekódolni (pl. TIFF), a nyers fájl megy tovább a Tesseractnak. */
async function prepareImageInput(file, opts) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  let scale = 1;
  const shortSide = Math.min(bitmap.width, bitmap.height);
  if (opts.upscale && shortSide < 1000) scale = Math.min(2, 1400 / shortSide);

  const longSide = Math.max(bitmap.width, bitmap.height) * scale;
  if (longSide > MAX_SIDE) scale *= MAX_SIDE / longSide;

  const canvas = drawTransformed(bitmap, bitmap.width, bitmap.height, opts.rotation, scale);
  bitmap.close();
  return enhance(canvas, opts);
}

async function processPdf(file, opts, onProgress) {
  onProgress(0.02, 'PDF megnyitása');

  const pdfjsLib = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), ...PDFJS_ASSETS }).promise;
  const pageCount = pdf.numPages;
  const pages = [];
  let usedTextLayer = false;

  try {
    for (let n = 1; n <= pageCount; n += 1) {
      if (state.cancelled) break;

      const base = (n - 1) / pageCount;
      const slice = 1 / pageCount;
      const step = (frac, text) => onProgress(0.02 + (base + slice * frac) * 0.96, `${n}/${pageCount}. oldal – ${text}`);

      step(0, 'megnyitás');
      const page = await pdf.getPage(n);

      if (opts.pdfText) {
        const layer = textLayerToParagraphs(await page.getTextContent());
        if (layer.text.replace(/\s/g, '').length >= 40) {
          pages.push({ ...layer, confidence: null, number: n });
          usedTextLayer = true;
          page.cleanup();
          step(1, 'beágyazott szöveg');
          continue;
        }
      }

      step(0.1, 'oldal képpé alakítása');
      const canvas = await renderPdfPage(page, opts);
      page.cleanup();

      const result = await recognize(canvas, opts, (p) => step(0.15 + p * 0.85, 'szöveg felismerése'));
      pages.push({ ...result, number: n });
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await pdf.destroy();
  }

  const markdown = buildDocument({
    title: baseName(file.name),
    source: file.name,
    pages,
    opts,
    fromTextLayer: usedTextLayer,
  });

  const scored = pages.filter((p) => p.confidence !== null);

  return {
    markdown,
    pages: pages.length,
    chars: pages.reduce((sum, p) => sum + p.text.length, 0),
    confidence: scored.length ? Math.round(scored.reduce((s, p) => s + p.confidence, 0) / scored.length) : null,
    fromTextLayer: usedTextLayer,
  };
}

async function renderPdfPage(page, opts) {
  let scale = opts.dpi / 72;
  const base = page.getViewport({ scale: 1 });
  const longSide = Math.max(base.width, base.height) * scale;
  if (longSide > MAX_SIDE) scale *= MAX_SIDE / longSide;

  const viewport = page.getViewport({ scale, rotation: (page.rotate + opts.rotation) % 360 });
  const canvas = makeCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  return enhance(canvas, opts);
}

async function recognize(input, opts, onProgress) {
  const worker = await getWorker(opts.lang, (m) => {
    const label = STATUS_SZOTAR[m.status] || m.status;
    if (m.status === 'recognizing text') {
      onProgress(typeof m.progress === 'number' ? m.progress : 0);
    } else {
      el.progressText.textContent = `${label}…`;
    }
  });

  await worker.setParameters({
    tessedit_pageseg_mode: opts.psm,
    preserve_interword_spaces: '1',
  });

  const { data } = await worker.recognize(input, {}, { blocks: true, text: true });

  /* A Tesseract saját blokk-/bekezdésfelosztása sokkal megbízhatóbb,
     mint utólag üres sorok mentén darabolni a nyers szöveget. A sorok
     magasságát is megőrizzük: ebből ismerhetők fel a címsorok. */
  const paragraphs = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      const lines = (paragraph.lines || [])
        .map((line) => ({
          text: (line.text || '').replace(/\s+/g, ' ').trim(),
          size: medianFontSize(line.words),
        }))
        .filter((line) => line.text.length > 0);
      if (lines.length > 0) paragraphs.push(lines);
    }
  }

  return {
    text: data.text || '',
    paragraphs: paragraphs.length > 0 ? paragraphs : null,
    confidence: typeof data.confidence === 'number' ? Math.round(data.confidence) : null,
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianFontSize(words) {
  return median((words || []).map((w) => w.font_size).filter((s) => typeof s === 'number' && s > 0));
}

/* ------------------------------------------------------------------ *
 * Markdown előállítása
 * ------------------------------------------------------------------ */

function baseName(fileName) {
  return fileName.replace(/\.[^.]+$/, '');
}

function normalizeRaw(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD/g, '')         // lágy elválasztójel
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const RE_BULLET = /^([-–—•*·▪●○])\s+(?=\S)/;
const RE_NUMBERED = /^(\d{1,3})[.)]\s+(?=\S)/;

/* A pontszerű felsorolásjeleket az OCR gyakran betűnek nézi. Ezeket
   csak akkor fogadjuk el jelölésnek, ha a blokkban több sor is
   ugyanazzal a karakterrel kezdődik. */
const GYANUS_JELEK = ['e', 'o', '©', '@', '»', '>', '+', '¢', 'a'];

function escapeBlockStart(line) {
  return line.replace(/^([#>|])/, '\\$1').replace(/^(\d{1,3})\.\s/, '$1\\. ');
}

/** Egy blokk soraiból bekezdés: elválasztójelek összevonása, sorfűzés. */
function joinLines(lines, opts) {
  let out = '';
  lines.forEach((line, i) => {
    if (i === 0) { out = line; return; }
    if (opts.hyphen && /\p{L}-$/u.test(out) && /^\p{Ll}/u.test(line)) {
      out = out.slice(0, -1) + line;
    } else if (opts.join) {
      out += ` ${line}`;
    } else {
      out += `  \n${line}`;   // Markdown sortörés
    }
  });
  return out;
}

function looksLikeHeading(line) {
  if (line.length > 70 || /[.!?:;,]$/.test(line)) return false;
  const letters = line.match(/\p{L}/gu);
  if (!letters || letters.length < 3) return false;
  const upper = line.match(/\p{Lu}/gu) || [];
  const upperRatio = upper.length / letters.length;
  if (upperRatio >= 0.75) return true;
  return /^\d+(\.\d+)*\.?\s+\p{Lu}/u.test(line) && line.split(/\s+/).length <= 9;
}

/** A blokk utolsó sora félbeszakadt mondatnak látszik? */
function looksUnfinished(line) {
  return !/[.!?:;»"')\]]$/.test(line) && !looksLikeHeading(line);
}

/** A sor eleji felsorolásjel (vagy annak félreolvasott alakja). */
function leadingMarker(line) {
  const bullet = line.match(RE_BULLET);
  if (bullet) return bullet[1];
  const suspicious = line.match(/^(\S)\s+(?=\S)/);
  if (suspicious && GYANUS_JELEK.includes(suspicious[1])) return suspicious[1];
  return null;
}

/**
 * A Tesseract néha egyetlen bekezdést is kettévág, a nagyobb betűs
 * címsorokat viszont a szomszédos szöveghez ragasztja, a felsorolás
 * pontjait pedig külön bekezdésnek látja. Ezeket a betűméretek és a
 * mondathatárok alapján igazítjuk ki.
 */
function regroupBlocks(paragraphs, opts) {
  const sizes = paragraphs.flat().map((l) => l.size).filter((s) => s > 0);
  const base = median(sizes);
  const isBig = (line) => base > 0
    && line.size >= base * 1.08
    && line.text.length <= 80
    && !/[.!?,;]$/.test(line.text);

  /* 1. lépés: a nagyobb betűs sorok saját, címsorként jelölt blokkot kapnak. */
  const split = [];
  for (const paragraph of paragraphs) {
    let current = null;
    for (const line of paragraph) {
      if (opts.headings && isBig(line)) {
        split.push({ lines: [line], heading: line.size >= base * 1.22 ? 2 : 3 });
        current = null;
      } else {
        if (!current) { current = { lines: [], heading: 0 }; split.push(current); }
        current.lines.push(line);
      }
    }
  }

  /* 2. lépés: a félbevágott bekezdések összefűzése. */
  const merged = [];
  for (const block of split) {
    if (block.lines.length === 0) continue;
    const prev = merged[merged.length - 1];
    const first = block.lines[0].text;
    const canMerge = prev && prev.heading === 0 && block.heading === 0
      && !leadingMarker(first)
      && /^[\p{Ll}(]/u.test(first)
      && looksUnfinished(prev.lines[prev.lines.length - 1].text);
    if (canMerge) prev.lines.push(...block.lines);
    else merged.push(block);
  }

  /* 3. lépés: a szétesett felsorolások egyetlen blokkba gyűjtése. */
  if (!opts.lists) return merged;

  const grouped = [];
  for (const block of merged) {
    const allMarked = block.heading === 0 && block.lines.every((l) => leadingMarker(l.text));
    const marker = allMarked ? leadingMarker(block.lines[0].text) : null;
    const prev = grouped[grouped.length - 1];
    if (marker && prev && prev.marker === marker) {
      prev.lines.push(...block.lines);
    } else {
      grouped.push({ ...block, marker });
    }
  }

  return grouped;
}

/** Az OCR által félreolvasott felsorolásjel megkeresése egy blokkban. */
function findMisreadBullet(lines) {
  const counts = new Map();
  for (const line of lines) {
    const m = line.match(/^(\S)\s+(?=\S)/);
    if (m && GYANUS_JELEK.includes(m[1])) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  for (const [char, count] of counts) {
    if (count >= 2 && count >= lines.length * 0.5) return char;
  }
  return null;
}

/** Egy szövegblokk (bekezdés) Markdown-alakja. */
function blockToMarkdown(rawLines, opts, headingLevel = 0) {
  const lines = rawLines.map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  if (headingLevel > 0) {
    const level = Math.min(6, headingLevel + (opts.headingShift || 0));
    return `${'#'.repeat(level)} ${lines.join(' ')}`;
  }

  const misread = opts.lists ? findMisreadBullet(lines) : null;
  const bulletOf = (line) => {
    const m = line.match(RE_BULLET);
    if (m) return m[0].length;
    if (misread && line.startsWith(`${misread} `)) return line.match(/^\S\s+/)[0].length;
    return 0;
  };

  const marked = lines.filter((l) => bulletOf(l) > 0 || RE_NUMBERED.test(l)).length;

  if (opts.lists && marked >= 2 && marked >= Math.ceil(lines.length * 0.5)) {
    const items = [];
    for (const line of lines) {
      const cut = bulletOf(line);
      const numbered = line.match(RE_NUMBERED);
      if (cut > 0) {
        items.push({ marker: '-', text: line.slice(cut).trim() });
      } else if (numbered) {
        items.push({ marker: `${numbered[1]}.`, text: line.slice(numbered[0].length).trim() });
      } else if (items.length > 0) {
        const last = items[items.length - 1];
        last.text = joinLines([last.text, line], { ...opts, join: true });
      } else {
        items.push({ marker: '-', text: line });
      }
    }
    return items.map((it) => `${it.marker} ${it.text}`).join('\n');
  }

  if (opts.headings && lines.length === 1 && looksLikeHeading(lines[0])) {
    return `### ${lines[0]}`;
  }

  return escapeBlockStart(joinLines(lines, opts));
}

/**
 * Egy oldal Markdown-alakja.
 * Ha van bekezdésszerkezet (OCR-ből), azt használjuk; egyébként a nyers
 * szöveget daraboljuk üres sorok mentén.
 */
function pageToMarkdown(page, opts) {
  const paragraphs = page.paragraphs
    ? page.paragraphs
    : normalizeRaw(page.text || '')
      .split(/\n{2,}/)
      .map((block) => block.split('\n').map((text) => ({ text: text.trim(), size: 0 })))
      .map((block) => block.filter((l) => l.text.length > 0))
      .filter((block) => block.length > 0);

  const out = [];
  for (const block of regroupBlocks(paragraphs, opts)) {
    const lines = block.lines.map((l) => normalizeRaw(l.text)).filter(Boolean);
    const md = blockToMarkdown(lines, opts, block.heading);
    if (md) out.push(md);
  }
  return out.join('\n\n');
}

function buildDocument({ title, source, pages, opts, fromTextLayer }) {
  const scored = pages.filter((p) => p.confidence !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, p) => s + p.confidence, 0) / scored.length) : null;
  const now = new Date();
  const parts = [];

  if (opts.frontMatter) {
    parts.push([
      '---',
      `cim: ${yamlString(title)}`,
      `forras: ${yamlString(source)}`,
      `oldalak: ${pages.length}`,
      `nyelv: ${yamlString(opts.lang)}`,
      avg === null ? 'megbizhatosag: null' : `megbizhatosag: ${avg}`,
      `letrehozva: ${yamlString(now.toISOString())}`,
      'eszkoz: "OCR Szövegkinyerő (Tesseract.js)"',
      '---',
    ].join('\n'));
  }

  parts.push(`# ${title}`);

  const meta = [
    `Forrás: \`${source}\``,
    pages.length === 1 ? '1 oldal' : `${pages.length} oldal`,
    `Nyelv: ${describeLang(opts.lang)}`,
  ];
  if (avg !== null) meta.push(`átlagos megbízhatóság: ${avg}%`);
  if (fromTextLayer) meta.push('részben a PDF beágyazott szövegéből');
  meta.push(`felismerve: ${formatDateTime(now)}`);
  parts.push(`*${meta.join(' · ')}*`);

  const usePageMarks = pages.length > 1 && opts.pageMarks;
  const pageOpts = { ...opts, headingShift: usePageMarks ? 1 : 0 };

  for (const page of pages) {
    const body = pageToMarkdown(page, pageOpts);
    if (usePageMarks) {
      parts.push(`## ${page.number || parts.length}. oldal`);
    }
    parts.push(body || '*(Ezen az oldalon nem sikerült szöveget felismerni.)*');
  }

  return `${parts.join('\n\n')}\n`;
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function describeLang(code) {
  return code.split('+').map((c) => NYELV_NEVEK[c] || c).join(' + ');
}

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * Eredmény megjelenítése
 * ------------------------------------------------------------------ */

function combinedMarkdown() {
  return state.results.map((r) => r.markdown.trim()).join('\n\n---\n\n') + '\n';
}

function showResults() {
  el.sourcePane.value = combinedMarkdown();
  el.resultCard.hidden = false;
  el.downloadEachBtn.hidden = state.results.length < 2;
  el.resultMeta.textContent = state.results.length === 1
    ? `${el.sourcePane.value.length.toLocaleString('hu-HU')} karakter`
    : `${state.results.length} dokumentum · ${el.sourcePane.value.length.toLocaleString('hu-HU')} karakter`;
  renderPreview();
  el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPreview() {
  el.previewPane.innerHTML = markdownToHtml(el.sourcePane.value);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\\([#>|.])/g, '$1')
    .replace(/ {2}\n/g, '<br>\n');
}

/** Szándékosan minimalista Markdown-megjelenítő az előnézethez. */
function markdownToHtml(md) {
  const html = [];
  let text = md;

  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    html.push(`<pre><code>${escapeHtml(fm[1])}</code></pre>`);
    text = text.slice(fm[0].length);
  }

  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    if (/^-{3,}$/.test(trimmed)) { html.push('<hr>'); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading && !trimmed.includes('\n')) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const lines = trimmed.split('\n');
    if (lines.every((l) => /^-\s+/.test(l))) {
      html.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^-\s+/, ''))}</li>`).join('')}</ul>`);
      continue;
    }
    if (lines.every((l) => /^\d+\.\s+/.test(l))) {
      html.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
      continue;
    }

    html.push(`<p>${inline(trimmed)}</p>`);
  }

  return html.join('\n');
}

/* ------------------------------------------------------------------ *
 * Mentés
 * ------------------------------------------------------------------ */

function safeFileName(name) {
  return (baseName(name).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'ocr-szoveg') + '.md';
}

function downloadMarkdown(text, fileName) {
  /* Az Android-alkalmazásban a natív mentést használjuk: a WebView a
     letöltési hivatkozásokat (főleg a blob: címeket) nem kezeli
     megbízhatóan. Böngészőben ez a híd nem létezik. */
  if (window.OcrAndroid && typeof window.OcrAndroid.mentes === 'function') {
    try {
      window.OcrAndroid.mentes(fileName, text);
      return;
    } catch (err) {
      console.warn('A natív mentés nem sikerült, marad a böngészős út.', err);
    }
  }

  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * Eseménykezelők
 * ------------------------------------------------------------------ */

/* A "tallózz" felirat <label>, azt a böngésző maga kezeli – csak a
   terület többi részére teszünk kattintáskezelőt, hogy a fájlválasztó
   ne nyíljon meg kétszer. */
el.dropzone.addEventListener('click', (e) => {
  if (e.target.closest('label')) return;
  el.fileInput.click();
});

el.fileInput.addEventListener('change', () => {
  addFiles(Array.from(el.fileInput.files || []));
  el.fileInput.value = '';
});

['dragenter', 'dragover'].forEach((type) => {
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('is-over');
  });
});
['dragleave', 'drop'].forEach((type) => {
  el.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('is-over');
  });
});
el.dropzone.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) addFiles(Array.from(e.dataTransfer.files));
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

document.addEventListener('paste', handlePaste);
el.pasteBtn.addEventListener('click', pasteFromClipboard);

el.startBtn.addEventListener('click', run);

el.cancelBtn.addEventListener('click', () => {
  state.cancelled = true;
  el.cancelBtn.disabled = true;
  setProgress(1, 'Megszakítás…');
  setTimeout(() => { el.cancelBtn.disabled = false; }, 1500);
});

el.clearBtn.addEventListener('click', async () => {
  state.files = [];
  state.results = [];
  el.resultCard.hidden = true;
  hideStatus();
  renderFiles();

  /* Az OCR motor több tíz megabájt memóriát tart életben; ha nincs
     több munka, engedjük el. */
  if (state.worker) {
    const worker = state.worker;
    state.worker = null;
    state.workerLang = null;
    await worker.terminate();
  }
});

el.tabPreview.addEventListener('click', () => switchTab('preview'));
el.tabSource.addEventListener('click', () => switchTab('source'));

function switchTab(which) {
  const preview = which === 'preview';
  if (preview) renderPreview();
  el.previewPane.hidden = !preview;
  el.sourcePane.hidden = preview;
  el.tabPreview.classList.toggle('is-active', preview);
  el.tabSource.classList.toggle('is-active', !preview);
  el.tabPreview.setAttribute('aria-selected', String(preview));
  el.tabSource.setAttribute('aria-selected', String(!preview));
}

el.sourcePane.addEventListener('input', () => {
  el.resultMeta.textContent = `${el.sourcePane.value.length.toLocaleString('hu-HU')} karakter · szerkesztve`;
});

el.downloadBtn.addEventListener('click', () => {
  const name = state.results.length === 1 ? safeFileName(state.results[0].name) : 'ocr-szoveg.md';
  downloadMarkdown(el.sourcePane.value, name);
});

el.downloadEachBtn.addEventListener('click', () => {
  state.results.forEach((r, i) => {
    setTimeout(() => downloadMarkdown(r.markdown, safeFileName(r.name)), i * 250);
  });
});

el.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.sourcePane.value);
    setStatus('A Markdown szöveg a vágólapra került.', 'ok');
  } catch {
    el.sourcePane.hidden = false;
    el.sourcePane.select();
    setStatus('A vágólap nem elérhető – a szöveg ki van jelölve, másold a Ctrl+C billentyűvel.', 'warn');
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.running) { e.preventDefault(); e.returnValue = ''; }
});

/* A böngésző biztonsági szabályai miatt a WebAssembly-motor és a nyelvi
   fájlok nem tölthetők be közvetlenül a fájlrendszerről. */
/**
 * Csak az igazi akadály tiltsa le a felismerést. Egy meg nem jelenő
 * favicon vagy stíluslap nem az – azt legfeljebb figyelmeztetésként
 * érdemes jelezni.
 */
function checkEnvironment() {
  if (location.protocol === 'file:') {
    block('Az oldalt közvetlenül a fájlrendszerről nyitottad meg (file://). A böngésző '
      + 'biztonsági szabályai miatt így nem tölthető be az OCR motor. Indítsd inkább a '
      + 'projekt könyvtárában lévő inditas.bat (Windows) vagy inditas.sh (macOS, Linux) '
      + 'fájllal: az elindítja a helyi kiszolgálót és megnyitja a jó címet. Kézzel: '
      + 'python3 -m http.server 8080, majd http://localhost:8080');
    return;
  }

  if (typeof Tesseract === 'undefined') {
    block('Az OCR motor (vendor/tesseract/tesseract.min.js) nem töltődött be. Ellenőrizd, '
      + 'hogy a vendor/ könyvtár a helyén van-e: npm install && npm run vendor');
    return;
  }

  if (window.__ocrHiba) setStatus(window.__ocrHiba, 'warn');
}

function block(message) {
  state.blocked = true;
  state.blockedMessage = message;
  el.startBtn.title = message;
  setStatus(message, 'err');
  renderFiles();
}

/* Jelezzük az index.html-ben futó tartaléknak, hogy az alkalmazás elindult. */
window.__ocrIndult = true;

if (el.appVersion) el.appVersion.textContent = `verzió: ${APP_VERSION}`;

renderFiles();
checkEnvironment();
