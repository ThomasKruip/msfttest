// Gezinsagenda - eenvoudige server zonder externe afhankelijkheden.
// Bewaart afspraken in data/events.json en spraakberichten in data/audio/.

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const FAMILY_FILE = path.join(DATA_DIR, 'family.json');
const CERT_DIR = path.join(DATA_DIR, 'cert');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const DEFAULT_FAMILY = [
  { id: 'lid1', name: 'Papa', color: '#2f6fde' },
  { id: 'lid2', name: 'Mama', color: '#d6336c' },
  { id: 'lid3', name: 'Kind 1', color: '#2b9348' },
  { id: 'lid4', name: 'Kind 2', color: '#7048e8' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const AUDIO_EXT = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/3gpp': '.3gp',
  'audio/amr': '.amr',
};

const AUDIO_MIME = Object.fromEntries(
  Object.entries(AUDIO_EXT).map(([mime, ext]) => [ext, mime])
);

fs.mkdirSync(AUDIO_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Schrijf eerst naar een tijdelijk bestand zodat een crash nooit een half bestand achterlaat.
function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

let family = readJson(FAMILY_FILE, DEFAULT_FAMILY).map((m, i) => ({ id: m.id || `lid${i + 1}`, ...m }));
let events = readJson(EVENTS_FILE, []).map(migrateEvent);
const saveEvents = () => writeJson(EVENTS_FILE, events);

// Oudere versies bewaarden één naam in `person`; nu zijn het gezinslid-id's in `persons`.
function migrateEvent(ev) {
  if (Array.isArray(ev.persons)) return ev;
  const { person, ...rest } = ev;
  const member = family.find((m) => m.name === person);
  return {
    ...rest,
    persons: member ? [member.id] : [],
    shared: person === 'Iedereen',
    createdBy: rest.createdBy || '',
  };
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isTime = (s) => s === '' || (typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const memberIds = (list) =>
  [...new Set((Array.isArray(list) ? list : []).filter((id) => family.some((m) => m.id === id)))];

function validateEvent(input) {
  const ev = {
    date: input.date,
    time: input.time ?? '',
    endTime: input.endTime ?? '',
    title: clean(input.title, 200),
    notes: clean(input.notes, 2000),
    shared: input.shared === true || input.shared === '1',
    persons: memberIds(input.persons),
    createdBy: memberIds([input.createdBy])[0] || '',
  };
  if (!isDate(ev.date)) return { error: 'Ongeldige datum' };
  if (!isTime(ev.time) || !isTime(ev.endTime)) return { error: 'Ongeldige tijd' };
  if (ev.shared) ev.persons = [];
  else if (!ev.persons.length) {
    if (!ev.createdBy) return { error: 'Kies voor wie deze activiteit is' };
    ev.persons = [ev.createdBy];
  }
  return { ev };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? MIME['.json'] : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Bestand is te groot'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req, 100 * 1024);
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Ongeldige JSON'), { status: 400 });
  }
}

function sortEvents(list) {
  return list.slice().sort((a, b) =>
    (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00'))
  );
}

function deleteAudio(ev) {
  if (ev.audio) fs.rm(path.join(AUDIO_DIR, ev.audio), { force: true }, () => {});
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (parts[1] === 'family') {
    if (req.method === 'GET') return send(res, 200, family);
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Verwacht een lijst' });
      const updated = body
        .map((m) => ({
          id: typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) ? m.id : 'lid-' + crypto.randomUUID().slice(0, 8),
          name: clean(m.name, 60),
          color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#868e96',
        }))
        .filter((m) => m.name);
      if (!updated.length) return send(res, 400, { error: 'Er moet minstens één gezinslid zijn' });
      family = updated;
      writeJson(FAMILY_FILE, family);
      return send(res, 200, family);
    }
  }

  if (parts[1] === 'events' && parts.length === 2) {
    if (req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const list = events.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
      return send(res, 200, sortEvents(list));
    }
    if (req.method === 'POST') {
      const { ev, error } = validateEvent(await readJsonBody(req));
      if (error) return send(res, 400, { error });
      if (!ev.title) return send(res, 400, { error: 'Titel is verplicht' });
      const created = { id: crypto.randomUUID(), type: 'afspraak', ...ev, createdAt: new Date().toISOString() };
      events.push(created);
      saveEvents();
      return send(res, 201, created);
    }
  }

  if (parts[1] === 'events' && parts.length === 3) {
    const idx = events.findIndex((e) => e.id === parts[2]);
    if (idx === -1) return send(res, 404, { error: 'Niet gevonden' });
    if (req.method === 'PUT') {
      // De maker van een item blijft altijd dezelfde.
      const input = { ...events[idx], ...(await readJsonBody(req)), createdBy: events[idx].createdBy };
      const { ev, error } = validateEvent(input);
      if (error) return send(res, 400, { error });
      if (events[idx].type === 'afspraak' && !ev.title) return send(res, 400, { error: 'Titel is verplicht' });
      events[idx] = { ...events[idx], ...ev, updatedAt: new Date().toISOString() };
      saveEvents();
      return send(res, 200, events[idx]);
    }
    if (req.method === 'DELETE') {
      const [removed] = events.splice(idx, 1);
      deleteAudio(removed);
      saveEvents();
      return send(res, 204, '');
    }
  }

  // Spraakbericht: de ruwe audio zit in de body, de gegevens in de query string.
  if (parts[1] === 'voice' && req.method === 'POST') {
    const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = AUDIO_EXT[mime];
    if (!ext) return send(res, 415, { error: 'Onbekend audioformaat: ' + (mime || 'leeg') });
    const q = url.searchParams;
    const { ev, error } = validateEvent({
      date: q.get('date'),
      time: q.get('time') || '',
      title: q.get('title') || '',
      notes: q.get('notes') || '',
      shared: q.get('shared'),
      persons: q.getAll('person'),
      createdBy: q.get('createdBy'),
    });
    if (error) return send(res, 400, { error });
    const audio = await readBody(req, MAX_AUDIO_BYTES);
    if (!audio.length) return send(res, 400, { error: 'Geen audio ontvangen' });
    const id = crypto.randomUUID();
    const file = id + ext;
    fs.writeFileSync(path.join(AUDIO_DIR, file), audio);
    const duration = Number(q.get('duration'));
    const created = {
      id,
      type: 'spraak',
      ...ev,
      title: ev.title || 'Spraakbericht',
      audio: file,
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      createdAt: new Date().toISOString(),
    };
    events.push(created);
    saveEvents();
    return send(res, 201, created);
  }

  return send(res, 404, { error: 'Onbekende API-route' });
}

function serveFile(req, res, file, contentType, extraHeaders = {}) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Niet gevonden');
    const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', ...extraHeaders };
    // Range-ondersteuning is nodig om audio te kunnen afspelen in Safari/iOS.
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` });
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    if (url.pathname.startsWith('/audio/')) {
      const name = path.basename(url.pathname);
      const type = AUDIO_MIME[path.extname(name)];
      if (!type) return send(res, 404, 'Niet gevonden');
      return serveFile(req, res, path.join(AUDIO_DIR, name), type, { 'Cache-Control': 'max-age=31536000, immutable' });
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Verboden');
    serveFile(req, res, file, MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Serverfout' });
    if (!err.status) console.error(err);
  }
}

// Microfoontoegang in de browser werkt alleen via https of op localhost.
// Met `npm run certificaat` wordt een certificaat in data/cert gemaakt; dat wordt dan automatisch gebruikt.
// Je kunt ook zelf een certificaat opgeven met TLS_CERT en TLS_KEY.
function tlsOptions() {
  const cert = process.env.TLS_CERT || path.join(CERT_DIR, 'cert.pem');
  const key = process.env.TLS_KEY || path.join(CERT_DIR, 'key.pem');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

if (require.main === module) {
  const tls = tlsOptions();
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const proto = tls ? 'https' : 'http';
  server.listen(PORT, () => {
    console.log(`Gezinsagenda draait op ${proto}://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`Op de telefoon (zelfde wifi): ${proto}://${ip}:${PORT}`);
    if (!tls) console.log('Tip: voer `npm run certificaat` uit om op telefoons ook spraakberichten op te kunnen nemen.');
  });
}

module.exports = { handler, lanAddresses, CERT_DIR };
