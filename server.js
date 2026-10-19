// Gezinsagenda - eenvoudige server zonder externe afhankelijkheden.
// Bewaart afspraken in data/events.json, gezinsleden in data/family.json,
// inlogsessies in data/sessions.json en spraakberichten in data/audio/.

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
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const CERT_DIR = path.join(DATA_DIR, 'cert');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const SESSION_DAYS = 365;

// Papa en Mama zijn standaard de beheerders: zij mogen gezinsleden aanpassen en pincodes wissen.
const DEFAULT_FAMILY = [
  { id: 'lid1', name: 'Papa', color: '#2f6fde', admin: true },
  { id: 'lid2', name: 'Mama', color: '#d6336c', admin: true },
  { id: 'lid3', name: 'Kind 1', color: '#2b9348', admin: false },
  { id: 'lid4', name: 'Kind 2', color: '#7048e8', admin: false },
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

let family = readJson(FAMILY_FILE, DEFAULT_FAMILY).map((m, i) => ({
  id: m.id || `lid${i + 1}`,
  admin: m.admin ?? i < 2,
  ...m,
}));
let events = readJson(EVENTS_FILE, []).map(migrateEvent);
// Sessies worden bewaard als hash van de sleutel, zodat een gelekt bestand geen inlog oplevert.
const sessions = new Map(Object.entries(readJson(SESSIONS_FILE, {})));

const saveEvents = () => writeJson(EVENTS_FILE, events);
const saveFamily = () => writeJson(FAMILY_FILE, family);
const saveSessions = () => writeJson(SESSIONS_FILE, Object.fromEntries(sessions));

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
const isPin = (s) => typeof s === 'string' && /^\d{4,8}$/.test(s);
const clean = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const memberIds = (list) =>
  [...new Set((Array.isArray(list) ? list : []).filter((id) => family.some((m) => m.id === id)))];
const publicMember = ({ id, name, color, admin, pinHash }) => ({ id, name, color, admin: !!admin, hasPin: !!pinHash });

// ---------- Pincodes en inloggen ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

function setPin(member, pin) {
  member.pinSalt = crypto.randomBytes(16).toString('hex');
  member.pinHash = hashPin(pin, member.pinSalt);
}

function checkPin(member, pin) {
  if (!member.pinHash || !isPin(pin)) return false;
  const a = Buffer.from(hashPin(pin, member.pinSalt), 'hex');
  const b = Buffer.from(member.pinHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Na 5 foute pogingen moet je wachten; elke volgende foute poging verdubbelt de wachttijd.
const attempts = new Map();

function lockedFor(id) {
  const a = attempts.get(id);
  return a && a.lockedUntil > Date.now() ? Math.ceil((a.lockedUntil - Date.now()) / 1000) : 0;
}

function registerFailure(id) {
  const a = attempts.get(id) || { fails: 0, lockedUntil: 0 };
  a.fails += 1;
  if (a.fails >= 5) a.lockedUntil = Date.now() + 30_000 * 2 ** Math.min(a.fails - 5, 10);
  attempts.set(id, a);
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v)
  );
}

// Achter een online host (proxy) komt https binnen als http; die geeft dat door in x-forwarded-proto.
const isSecure = (req) => !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

function sessionCookie(req, token, maxAge) {
  return `sessie=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
}

function startSession(req, member) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(sha256(token), { memberId: member.id, created: Date.now() });
  saveSessions();
  return sessionCookie(req, token, SESSION_DAYS * 24 * 3600);
}

function endSessionsOf(memberId, exceptHash) {
  for (const [hash, s] of sessions) if (s.memberId === memberId && hash !== exceptHash) sessions.delete(hash);
  saveSessions();
}

function currentUser(req) {
  const token = parseCookies(req).sessie;
  if (!token) return null;
  const hash = sha256(token);
  const session = sessions.get(hash);
  if (!session || Date.now() - session.created > SESSION_DAYS * 24 * 3600 * 1000) return null;
  const member = family.find((m) => m.id === session.memberId);
  return member ? { member, hash } : null;
}

// ---------- Herhalingen ----------
// Een herhalende activiteit wordt één keer bewaard, met `repeat`:
//   { freq: 'dag' | 'week' | '2weken' | 'maand' | 'jaar', days: [0-6] (0 = zondag), until: 'JJJJ-MM-DD' | '' }
// en een lijst `exceptions` met datums die zijn overgeslagen ("alleen deze keer verwijderen").

const FREQS = ['dag', 'week', '2weken', 'maand', 'jaar'];
const DAY_MS = 24 * 60 * 60 * 1000;

// Rekenen in UTC voorkomt problemen met zomer- en wintertijd.
const toUtc = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const mondayOf = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;

function validateRepeat(input, date) {
  if (!input || !FREQS.includes(input.freq)) return { repeat: null };
  const until = input.until || '';
  if (until && (!isDate(until) || until < date)) return { error: 'De einddatum van de herhaling ligt vóór de begindatum' };
  const repeat = { freq: input.freq, until };
  if (input.freq === 'week' || input.freq === '2weken') {
    const days = [...new Set((Array.isArray(input.days) ? input.days : []).map(Number))]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort();
    repeat.days = days.length ? days : [new Date(toUtc(date)).getUTCDay()];
  }
  return { repeat };
}

function occursOn(ev, key) {
  const { repeat } = ev;
  if (key < ev.date || (repeat.until && key > repeat.until) || ev.exceptions?.includes(key)) return false;
  const start = new Date(toUtc(ev.date));
  const day = new Date(toUtc(key));
  switch (repeat.freq) {
    case 'dag':
      return true;
    case 'week':
      return repeat.days.includes(day.getUTCDay());
    case '2weken': {
      const weeks = Math.round((mondayOf(day.getTime()) - mondayOf(start.getTime())) / (7 * DAY_MS));
      return weeks % 2 === 0 && repeat.days.includes(day.getUTCDay());
    }
    case 'maand':
      return day.getUTCDate() === start.getUTCDate();
    case 'jaar':
      return day.getUTCDate() === start.getUTCDate() && day.getUTCMonth() === start.getUTCMonth();
    default:
      return false;
  }
}

// Geeft voor elke dag in [from, to] waarop het item voorkomt een kopie met die datum.
// `startDate` is de begindatum van de reeks, nodig om de reeks te kunnen bewerken.
function expand(ev, from, to) {
  if (!ev.repeat) return ev.date >= from && ev.date <= to ? [ev] : [];
  const first = Math.max(toUtc(from), toUtc(ev.date));
  const last = ev.repeat.until ? Math.min(toUtc(to), toUtc(ev.repeat.until)) : toUtc(to);
  const result = [];
  for (let ms = first; ms <= last; ms += DAY_MS) {
    const key = fromUtc(ms);
    if (occursOn(ev, key)) result.push({ ...ev, date: key, startDate: ev.date });
  }
  return result;
}

function validateEvent(input, createdBy) {
  const ev = {
    date: input.date,
    time: input.time ?? '',
    endTime: input.endTime ?? '',
    title: clean(input.title, 200),
    notes: clean(input.notes, 2000),
    shared: input.shared === true || input.shared === '1',
    persons: memberIds(input.persons),
  };
  if (!isDate(ev.date)) return { error: 'Ongeldige datum' };
  if (!isTime(ev.time) || !isTime(ev.endTime)) return { error: 'Ongeldige tijd' };
  const { repeat, error } = validateRepeat(input.repeat, ev.date);
  if (error) return { error };
  ev.repeat = repeat;
  if (ev.shared) ev.persons = [];
  else if (!ev.persons.length) {
    if (!memberIds([createdBy]).length) return { error: 'Kies voor wie deze activiteit is' };
    ev.persons = [createdBy];
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

async function handleAuth(req, res, parts, user) {
  // Inloggen. Heeft het gezinslid nog geen pincode, dan wordt de opgegeven pincode de nieuwe.
  if (parts[1] === 'login' && req.method === 'POST') {
    const { id, pin } = await readJsonBody(req);
    const member = family.find((m) => m.id === id);
    if (!member) return send(res, 404, { error: 'Onbekend gezinslid' });
    const wait = lockedFor(member.id);
    if (wait) return send(res, 429, { error: `Te vaak een verkeerde pincode. Probeer het over ${wait} seconden opnieuw.` });
    if (!member.pinHash) {
      if (!isPin(pin)) return send(res, 400, { error: 'Kies een pincode van 4 tot 8 cijfers' });
      setPin(member, pin);
      saveFamily();
    } else if (!checkPin(member, pin)) {
      registerFailure(member.id);
      return send(res, 401, { error: 'Verkeerde pincode' });
    }
    attempts.delete(member.id);
    if (user) {
      sessions.delete(user.hash);
    }
    return send(res, 200, publicMember(member), { 'Set-Cookie': startSession(req, member) });
  }

  if (parts[1] === 'logout' && req.method === 'POST') {
    if (user) {
      sessions.delete(user.hash);
      saveSessions();
    }
    return send(res, 204, '', { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (parts[1] === 'me' && req.method === 'GET') {
    if (!user) return send(res, 401, { error: 'Niet ingelogd' });
    return send(res, 200, publicMember(user.member));
  }

  // Eigen pincode wijzigen; andere telefoons van dit gezinslid worden dan uitgelogd.
  if (parts[1] === 'pin' && req.method === 'POST') {
    if (!user) return send(res, 401, { error: 'Niet ingelogd' });
    const { oldPin, newPin } = await readJsonBody(req);
    const wait = lockedFor(user.member.id);
    if (wait) return send(res, 429, { error: `Te vaak een verkeerde pincode. Probeer het over ${wait} seconden opnieuw.` });
    if (!checkPin(user.member, oldPin)) {
      registerFailure(user.member.id);
      return send(res, 401, { error: 'Je huidige pincode klopt niet' });
    }
    if (!isPin(newPin)) return send(res, 400, { error: 'Kies een pincode van 4 tot 8 cijfers' });
    setPin(user.member, newPin);
    saveFamily();
    endSessionsOf(user.member.id, user.hash);
    return send(res, 204, '');
  }
  return null;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const user = currentUser(req);

  if (parts[1] === 'health') return send(res, 200, { ok: true });

  if (await handleAuth(req, res, parts, user) !== null) return;

  if (parts[1] === 'family' && req.method === 'GET') return send(res, 200, family.map(publicMember));

  // Alles hieronder is alleen voor ingelogde gezinsleden.
  if (!user) return send(res, 401, { error: 'Niet ingelogd' });
  const me = user.member;

  // Alleen beheerders mogen gezinsleden toevoegen, verwijderen, hernoemen en pincodes wissen.
  if (parts[1] === 'family' && req.method === 'PUT') {
    if (!me.admin) return send(res, 403, { error: 'Alleen een beheerder kan de gezinsleden aanpassen.' });
    const body = await readJsonBody(req);
    if (!Array.isArray(body)) return send(res, 400, { error: 'Verwacht een lijst' });
    const updated = body
      .map((m) => {
        const existing = family.find((f) => f.id === m.id);
        const member = {
          id: existing ? existing.id : 'lid-' + crypto.randomUUID().slice(0, 8),
          name: clean(m.name, 60),
          color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#868e96',
          admin: m.admin === true,
        };
        if (existing?.pinHash && !m.resetPin) Object.assign(member, { pinHash: existing.pinHash, pinSalt: existing.pinSalt });
        return member;
      })
      .filter((m) => m.name);
    if (!updated.length) return send(res, 400, { error: 'Er moet minstens één gezinslid zijn' });
    if (!updated.some((m) => m.admin)) return send(res, 400, { error: 'Er moet minstens één beheerder zijn' });
    if (!updated.some((m) => m.id === me.id && m.admin)) {
      return send(res, 400, { error: 'Je kunt jezelf niet verwijderen of je eigen beheerdersrechten afnemen.' });
    }
    for (const old of family) {
      const now = updated.find((m) => m.id === old.id);
      if (!now || (old.pinHash && !now.pinHash)) endSessionsOf(old.id);
    }
    family = updated;
    saveFamily();
    return send(res, 200, family.map(publicMember));
  }

  if (parts[1] === 'events' && parts.length === 2) {
    if (req.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!isDate(from) || !isDate(to) || toUtc(to) - toUtc(from) > 400 * DAY_MS) {
        return send(res, 400, { error: 'Geef een geldige periode op (from en to, maximaal 400 dagen)' });
      }
      return send(res, 200, sortEvents(events.flatMap((e) => expand(e, from, to))));
    }
    if (req.method === 'POST') {
      const { ev, error } = validateEvent(await readJsonBody(req), me.id);
      if (error) return send(res, 400, { error });
      if (!ev.title) return send(res, 400, { error: 'Titel is verplicht' });
      const created = { id: crypto.randomUUID(), type: 'afspraak', ...ev, createdBy: me.id, createdAt: new Date().toISOString() };
      events.push(created);
      saveEvents();
      return send(res, 201, created);
    }
  }

  if (parts[1] === 'events' && parts.length === 3) {
    const idx = events.findIndex((e) => e.id === parts[2]);
    if (idx === -1) return send(res, 404, { error: 'Niet gevonden' });
    // Alleen wie een item heeft ingevoerd mag het bewerken of verwijderen. Items zonder (bestaande)
    // maker, bijvoorbeeld van een verwijderd gezinslid, mag iedereen aanpassen.
    const owner = family.find((m) => m.id === events[idx].createdBy);
    if (owner && owner.id !== me.id) {
      return send(res, 403, { error: `Alleen ${owner.name} kan dit aanpassen of verwijderen.` });
    }
    if (req.method === 'PUT') {
      const current = events[idx];
      const { ev, error } = validateEvent({ ...current, ...(await readJsonBody(req)) }, current.createdBy || me.id);
      if (error) return send(res, 400, { error });
      if (current.type === 'afspraak' && !ev.title) return send(res, 400, { error: 'Titel is verplicht' });
      if (current.type === 'spraak') ev.repeat = null;
      events[idx] = { ...current, ...ev, updatedAt: new Date().toISOString() };
      saveEvents();
      return send(res, 200, events[idx]);
    }
    if (req.method === 'DELETE') {
      // Bij een herhalende activiteit kun je ook één keer overslaan met ?date=JJJJ-MM-DD.
      const date = url.searchParams.get('date');
      if (date && events[idx].repeat) {
        if (!isDate(date)) return send(res, 400, { error: 'Ongeldige datum' });
        events[idx].exceptions = [...new Set([...(events[idx].exceptions || []), date])];
        saveEvents();
        return send(res, 204, '');
      }
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
    }, me.id);
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
      createdBy: me.id,
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
      if (!currentUser(req)) return send(res, 401, 'Niet ingelogd');
      const name = path.basename(url.pathname);
      const type = AUDIO_MIME[path.extname(name)];
      if (!type) return send(res, 404, 'Niet gevonden');
      return serveFile(req, res, path.join(AUDIO_DIR, name), type, { 'Cache-Control': 'private, max-age=31536000, immutable' });
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
// Online (achter een host of tunnel die zelf https regelt) start je met --online of NO_TLS=1.
function tlsOptions() {
  if (process.env.NO_TLS || process.argv.includes('--online')) return null;
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
    if (!tls && !process.env.NO_TLS && !process.argv.includes('--online')) {
      console.log('Tip: voer `npm run certificaat` uit om op telefoons ook spraakberichten op te kunnen nemen.');
    }
  });
}

module.exports = { handler, lanAddresses, CERT_DIR };
