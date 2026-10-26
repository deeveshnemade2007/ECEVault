/**
 * ECEVault — Server
 * Files saved permanently to /uploads folder on disk
 * Metadata saved to data.json
 * No npm packages required — pure Node.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE   = path.join(__dirname, 'data.json');

// ── Ensure uploads folder exists ──────────────────────
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('  Created uploads/ folder');
}

// ── Data helpers ──────────────────────────────────────
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { subjects: {}, files: [] };
  try   { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { subjects: {}, files: [] }; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── MIME types for static files ───────────────────────
const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif' : 'image/gif',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

// ── Response helpers ──────────────────────────────────
function jsonRes(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type'  : 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const filePath = path.join(__dirname, urlPath);
  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const mime = MIME_MAP[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data',  c   => chunks.push(c));
    req.on('end',   ()  => resolve(Buffer.concat(chunks)));
    req.on('error', err => reject(err));
  });
}

// ── HTTP Server ───────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];
  const method  = req.method;

  try {

    // ════════════════════════════════════════
    //  GET /api/data  — return all metadata
    // ════════════════════════════════════════
    if (urlPath === '/api/data' && method === 'GET') {
      jsonRes(res, loadData());
      return;
    }

    // ════════════════════════════════════════
    //  POST /api/upload
    //  Binary file in body, metadata in headers
    // ════════════════════════════════════════
    if (urlPath === '/api/upload' && method === 'POST') {
      const name     = decodeURIComponent(req.headers['x-file-name'] || 'file');
      const subject  = decodeURIComponent(req.headers['x-subject']   || '');
      const semId    = req.headers['x-semid']    || '';
      const category = decodeURIComponent(req.headers['x-category']  || 'Other');
      const desc     = decodeURIComponent(req.headers['x-desc']      || '');
      const mimeType = req.headers['x-mime']     || 'application/octet-stream';
      const size     = parseInt(req.headers['x-size'] || '0', 10);

      const id   = genId();
      const body = await readBody(req);

      fs.writeFileSync(path.join(UPLOADS_DIR, id), body);

      const data = loadData();
      data.files.push({
        id, name, semId, subject, category,
        size, mimeType,
        date: new Date().toISOString(),
        desc,
      });
      saveData(data);

      console.log(`  ⬆  Uploaded: ${name} → uploads/${id}`);
      jsonRes(res, { success: true, id });
      return;
    }

    // ════════════════════════════════════════
    //  DELETE /api/file/:id
    // ════════════════════════════════════════
    const delFileMatch = urlPath.match(/^\/api\/file\/([^/]+)$/);
    if (delFileMatch && method === 'DELETE') {
      const id   = delFileMatch[1];
      const data = loadData();
      const file = data.files.find(f => f.id === id);

      data.files = data.files.filter(f => f.id !== id);
      saveData(data);

      const fp = path.join(UPLOADS_DIR, id);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);

      console.log(`  🗑  Deleted: ${file ? file.name : id}`);
      jsonRes(res, { success: true });
      return;
    }

    // ════════════════════════════════════════
    //  GET /api/download/:id
    // ════════════════════════════════════════
    const dlMatch = urlPath.match(/^\/api\/download\/([^/]+)$/);
    if (dlMatch && method === 'GET') {
      const id   = dlMatch[1];
      const data = loadData();
      const file = data.files.find(f => f.id === id);
      if (!file) { jsonRes(res, { error: 'File not found' }, 404); return; }

      const fp = path.join(UPLOADS_DIR, id);
      if (!fs.existsSync(fp)) { jsonRes(res, { error: 'File missing on disk' }, 404); return; }

      const buf        = fs.readFileSync(fp);
      const safeName   = encodeURIComponent(file.name).replace(/%20/g, '+');
      res.writeHead(200, {
        'Content-Type'       : file.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${safeName}`,
        'Content-Length'     : buf.length,
      });
      res.end(buf);

      console.log(`  ⬇  Downloaded: ${file.name}`);
      return;
    }

    // ════════════════════════════════════════
    //  POST /api/subject  { semId, name }
    // ════════════════════════════════════════
    if (urlPath === '/api/subject' && method === 'POST') {
      const body             = JSON.parse((await readBody(req)).toString());
      const { semId, name }  = body;
      if (!semId || !name)   { jsonRes(res, { error: 'Missing semId or name' }, 400); return; }

      const data = loadData();
      if (!data.subjects[semId]) data.subjects[semId] = [];
      if (!data.subjects[semId].includes(name)) {
        data.subjects[semId].push(name);
        saveData(data);
        console.log(`  📚 Subject added: ${name} (${semId})`);
      }
      jsonRes(res, { success: true });
      return;
    }

    // ════════════════════════════════════════
    //  DELETE /api/subject/:semId/:name
    // ════════════════════════════════════════
    const delSubMatch = urlPath.match(/^\/api\/subject\/([^/]+)\/(.+)$/);
    if (delSubMatch && method === 'DELETE') {
      const semId = delSubMatch[1];
      const name  = decodeURIComponent(delSubMatch[2]);
      const data  = loadData();

      // Delete all files for this subject from disk
      const toDelete = data.files.filter(f => f.semId === semId && f.subject === name);
      for (const f of toDelete) {
        const fp = path.join(UPLOADS_DIR, f.id);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
      data.files         = data.files.filter(f => !(f.semId === semId && f.subject === name));
      data.subjects[semId] = (data.subjects[semId] || []).filter(s => s !== name);
      saveData(data);

      console.log(`  🗑  Subject deleted: ${name} (${semId}), ${toDelete.length} files removed`);
      jsonRes(res, { success: true });
      return;
    }

    // ════════════════════════════════════════
    //  Static file serving
    // ════════════════════════════════════════
    const staticPath = urlPath === '/' ? '/index.html' : urlPath;
    serveStatic(res, staticPath);

  } catch (err) {
    console.error('  Server error:', err);
    jsonRes(res, { error: 'Internal server error' }, 500);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ⚡ ECEVault is running!');
  console.log('');
  console.log('  Open   →  http://localhost:' + PORT);
  console.log('  Files  →  ' + UPLOADS_DIR);
  console.log('  Data   →  ' + DATA_FILE);
  console.log('');
  console.log('  Uploaded files are saved permanently to the uploads/ folder.');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
