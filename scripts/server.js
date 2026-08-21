#!/usr/bin/env node
/*
 * Pehelysúlyú, függőség nélküli statikus kiszolgáló az OCR Szövegkinyerőhöz.
 * Csak akkor van rá szükség, ha nincs Python a gépen.
 *
 *   node scripts/server.js [port]
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIRST_PORT = Number(process.argv[2]) || 8080;
const LAST_PORT = FIRST_PORT + 20;

const TIPUSOK = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let relative;
  try {
    relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Hibás kérés');
    return;
  }

  if (relative.endsWith('/')) relative += 'index.html';

  const file = path.join(ROOT, relative);

  /* Kilépés a projektkönyvtárból nem megengedett. */
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end('Tiltott');
    return;
  }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(`Nincs ilyen fájl: ${relative}`);
      return;
    }

    res.writeHead(200, {
      'Content-Type': TIPUSOK[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

let port = FIRST_PORT;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && port < LAST_PORT) {
    port += 1;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(`Nem sikerült elindítani a kiszolgálót: ${err.message}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log('');
  console.log('  OCR Szövegkinyerő elindult.');
  console.log(`  Nyisd meg a böngészőben:  http://localhost:${port}`);
  console.log('');
  console.log('  Leállítás: Ctrl+C');
  console.log('');
});
