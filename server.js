// Gezinsagenda - eenvoudige server zonder externe afhankelijkheden.
// Bewaart afspraken in data/events.json en spraakberichten in data/audio/.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const FAMILY_FILE = path.join(DATA_DIR, 'family.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const DEFAULT_FAMILY = [
  { name: 'Papa', color: '#2f6fde' },
  { name: 'Mama', color: '#d6336c' },
  { name: 'Kind', color: '#2b9348' },
  { name: 'Iedereen', color: '#f08c00' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
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

let events = readJson(EVENTS_FILE, []);
const saveEvents = () => writeJson(EVENTS_FILE, events);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isTime = (s) => s === '' || (typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

function validateEvent(input) {
  const ev = {
    date: input.date,
    time: input.time ?? '',
    endTime: input.endTime ?? '',
    title: clean(input.title, 200),
    person: clean(input.person, 60),
    notes: clean(input.notes, 2000),
  };
  if (!isDate(ev.date)) return { error: 'Ongeldige datum' };
  if (!isTime(ev.time) || !isTime(ev.endTime)) return { error: 'Ongeldige tijd' };
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
    (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99'))
  );
}

function deleteAudio(ev) {
  if (ev.audio) fs.rm(path.join(AUDIO_DIR, ev.audio), { force: true }, () => {});
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  if (parts[1] === 'family') {
    if (req.method === 'GET') return send(res, 200, readJson(FAMILY_FILE, DEFAULT_FAMILY));
    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Verwacht een lijst' });
      const family = body
        .map((m) => ({
          name: clean(m.name, 60),
          color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#868e96',
        }))
        .filter((m) => m.name);
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
      const { ev, error } = validateEvent({ ...events[idx], ...(await readJsonBody(req)) });
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
    const { ev, error } = validateEvent({
      date: url.searchParams.get('date'),
      time: url.searchParams.get('time') || '',
      title: url.searchParams.get('title') || '',
      person: url.searchParams.get('person') || '',
      notes: url.searchParams.get('notes') || '',
    });
    if (error) return send(res, 400, { error });
    const audio = await readBody(req, MAX_AUDIO_BYTES);
    if (!audio.length) return send(res, 400, { error: 'Geen audio ontvangen' });
    const id = crypto.randomUUID();
    const file = id + ext;
    fs.writeFileSync(path.join(AUDIO_DIR, file), audio);
    const duration = Number(url.searchParams.get('duration'));
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

function serveFile(req, res, file, contentType) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Niet gevonden');
    const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' };
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
      return serveFile(req, res, path.join(AUDIO_DIR, name), type);
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Verboden');
    serveFile(req, res, file, MIME[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Serverfout' });
    if (!err.status) console.error(err);
  }
}

// Microfoontoegang in de browser werkt alleen via https of op localhost.
// Geef TLS_CERT en TLS_KEY op om de agenda via https in het thuisnetwerk aan te bieden.
const server =
  process.env.TLS_CERT && process.env.TLS_KEY
    ? https.createServer(
        { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) },
        handler
      )
    : http.createServer(handler);

if (require.main === module) {
  server.listen(PORT, () => {
    const proto = server instanceof https.Server ? 'https' : 'http';
    console.log(`Gezinsagenda draait op ${proto}://localhost:${PORT}`);
  });
}

module.exports = { server };
