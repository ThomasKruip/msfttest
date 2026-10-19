const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gezinsagenda-'));

// Gegevens van de eerste versie, met één naam per afspraak.
fs.writeFileSync(path.join(process.env.DATA_DIR, 'events.json'), JSON.stringify([
  { id: 'oud1', type: 'afspraak', date: '2026-11-01', time: '', endTime: '', title: 'Oud', person: 'Mama', notes: '' },
  { id: 'oud2', type: 'afspraak', date: '2026-11-02', time: '', endTime: '', title: 'Uitje', person: 'Iedereen', notes: '' },
]));

const { handler } = require('../server');
const server = http.createServer(handler);

let base;
const cookies = {}; // per gezinslid de sessiecookie

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
  // Iedereen kiest de eerste keer zijn eigen pincode.
  for (const [id, pin] of [['lid1', '1111'], ['lid2', '2222'], ['lid3', '3333'], ['lid4', '4444']]) {
    cookies[id] = await login(id, pin);
  }
});
after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function login(id, pin) {
  const res = await fetch(`${base}/api/login`, post({ id, pin }));
  assert.strictEqual(res.status, 200, `inloggen ${id}`);
  return res.headers.get('set-cookie').split(';')[0];
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Doe een verzoek als een bepaald gezinslid.
function as(id, url, { method = 'GET', body, headers = {} } = {}) {
  const isJson = body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body);
  return fetch(base + url, {
    method,
    headers: { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...headers, ...(id ? { Cookie: cookies[id] } : {}) },
    body: isJson ? JSON.stringify(body) : body,
  });
}
const create = async (id, ev) => (await as(id, '/api/events', { method: 'POST', body: ev })).json();
const list = async (id, from, to) => (await as(id, `/api/events?from=${from}&to=${to}`)).json();

// ---------- Inloggen en pincodes ----------

test('standaard vier gezinsleden, waarvan twee beheerders, zonder pincodes te tonen', async () => {
  const family = await (await fetch(`${base}/api/family`)).json();
  assert.strictEqual(family.length, 4);
  assert.deepStrictEqual(family.filter((m) => m.admin).map((m) => m.name), ['Papa', 'Mama']);
  assert.ok(family.every((m) => m.hasPin === true && !('pinHash' in m) && !('pinSalt' in m)));
});

test('zonder inloggen geen toegang tot de agenda of spraakberichten', async () => {
  assert.strictEqual((await as(null, '/api/events?from=2026-10-01&to=2026-10-31')).status, 401);
  assert.strictEqual((await as(null, '/api/events', { method: 'POST', body: { title: 'x', date: '2026-10-01' } })).status, 401);
  assert.strictEqual((await as(null, '/audio/iets.webm')).status, 401);
  assert.strictEqual((await as(null, '/api/me')).status, 401);
});

test('inloggen met de juiste pincode, en de sessiecookie is veilig ingesteld', async () => {
  const res = await fetch(`${base}/api/login`, post({ id: 'lid3', pin: '3333' }));
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Strict/);
  const me = await (await as('lid3', '/api/me')).json();
  assert.strictEqual(me.name, 'Kind 1');
});

test('een verkeerde pincode wordt geweigerd en na 5 pogingen geblokkeerd', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${base}/api/login`, post({ id: 'lid1', pin: '9999' }));
    assert.strictEqual(res.status, 401);
  }
  // Ook de juiste pincode werkt nu even niet: zo kan niemand alle pincodes uitproberen.
  const res = await fetch(`${base}/api/login`, post({ id: 'lid1', pin: '1111' }));
  assert.strictEqual(res.status, 429);
});

test('een kind kan niet inloggen als Papa zonder Papa\'s pincode', async () => {
  const res = await fetch(`${base}/api/login`, post({ id: 'lid2', pin: '3333' }));
  assert.strictEqual(res.status, 401);
});

test('eigen pincode wijzigen', async () => {
  let res = await as('lid4', '/api/pin', { method: 'POST', body: { oldPin: '0000', newPin: '5555' } });
  assert.strictEqual(res.status, 401);
  res = await as('lid4', '/api/pin', { method: 'POST', body: { oldPin: '4444', newPin: '12' } });
  assert.strictEqual(res.status, 400);
  res = await as('lid4', '/api/pin', { method: 'POST', body: { oldPin: '4444', newPin: '5555' } });
  assert.strictEqual(res.status, 204);
  cookies.lid4 = await login('lid4', '5555');
});

test('afmelden maakt de sessie ongeldig', async () => {
  const cookie = await login('lid3', '3333');
  await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
  const res = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.strictEqual(res.status, 401);
});

// ---------- Beheerders ----------

test('alleen een beheerder kan gezinsleden aanpassen', async () => {
  const family = await (await fetch(`${base}/api/family`)).json();
  const res = await as('lid3', '/api/family', { method: 'PUT', body: family.map((m) => ({ ...m, admin: true })) });
  assert.strictEqual(res.status, 403);
});

test('beheerder past gezinsleden aan; pincodes en id\'s blijven behouden', async () => {
  const family = await (await fetch(`${base}/api/family`)).json();
  const res = await as('lid2', '/api/family', {
    method: 'PUT',
    body: [...family.map((m) => (m.id === 'lid1' ? { ...m, name: 'Thomas' } : m)), { name: 'Oma', color: 'rood' }],
  });
  assert.strictEqual(res.status, 200);
  const updated = await res.json();
  assert.strictEqual(updated.length, 5);
  assert.strictEqual(updated[0].name, 'Thomas');
  assert.strictEqual(updated[0].hasPin, true);
  assert.match(updated[4].id, /^lid-/);
  assert.strictEqual(updated[4].color, '#868e96');
  assert.strictEqual(updated[4].hasPin, false);
  // Oma weer weghalen.
  await as('lid2', '/api/family', { method: 'PUT', body: updated.slice(0, 4) });
});

test('een beheerder kan zichzelf niet verwijderen of zijn rechten afnemen', async () => {
  const family = await (await fetch(`${base}/api/family`)).json();
  let res = await as('lid2', '/api/family', { method: 'PUT', body: family.filter((m) => m.id !== 'lid2') });
  assert.strictEqual(res.status, 400);
  res = await as('lid2', '/api/family', { method: 'PUT', body: family.map((m) => ({ ...m, admin: false })) });
  assert.strictEqual(res.status, 400);
});

test('beheerder wist de pincode van een kind; het kind kiest een nieuwe', async () => {
  const kindCookie = await login('lid3', '3333');
  const family = await (await fetch(`${base}/api/family`)).json();
  const res = await as('lid2', '/api/family', {
    method: 'PUT', body: family.map((m) => (m.id === 'lid3' ? { ...m, resetPin: true } : m)),
  });
  assert.strictEqual((await res.json()).find((m) => m.id === 'lid3').hasPin, false);
  // Het kind is overal uitgelogd en kiest bij het inloggen een nieuwe pincode.
  assert.strictEqual((await fetch(`${base}/api/me`, { headers: { Cookie: kindCookie } })).status, 401);
  cookies.lid3 = await login('lid3', '7777');
  assert.strictEqual((await fetch(`${base}/api/login`, post({ id: 'lid3', pin: '3333' }))).status, 401);
});

// ---------- Activiteiten ----------

test('oude afspraken worden omgezet naar het nieuwe formaat', async () => {
  const items = await list('lid1', '2026-11-01', '2026-11-02');
  assert.deepStrictEqual(items.map((e) => [e.id, e.persons, e.shared]), [
    ['oud1', ['lid2'], false],
    ['oud2', [], true],
  ]);
});

test('eigen activiteit: de maker komt uit de inlog, niet uit wat de app meestuurt', async () => {
  const ev = await create('lid3', { title: 'Voetbal', date: '2026-10-21', createdBy: 'lid1' });
  assert.deepStrictEqual(ev.persons, ['lid3']);
  assert.strictEqual(ev.createdBy, 'lid3');
  assert.strictEqual(ev.shared, false);
});

test('activiteit voor meerdere gezinsleden, en onbekende leden worden genegeerd', async () => {
  const ev = await create('lid1', { title: 'Ouderavond', date: '2026-10-22', persons: ['lid1', 'lid2', 'lid1', 'bestaatniet'] });
  assert.deepStrictEqual(ev.persons, ['lid1', 'lid2']);
});

test('gezamenlijke activiteit', async () => {
  const ev = await create('lid2', { title: 'Naar oma', date: '2026-10-25', shared: true, persons: ['lid1'] });
  assert.strictEqual(ev.shared, true);
  assert.deepStrictEqual(ev.persons, []);
});

test('ongeldige activiteit wordt geweigerd', async () => {
  assert.strictEqual((await as('lid1', '/api/events', { method: 'POST', body: { title: 'X', date: 'morgen' } })).status, 400);
  assert.strictEqual((await as('lid1', '/api/events', { method: 'POST', body: { title: '', date: '2026-10-21' } })).status, 400);
  assert.strictEqual((await as('lid1', '/api/events?from=2026-01-01')).status, 400);
});

test('alleen de maker mag een item bewerken of verwijderen', async () => {
  const ev = await create('lid4', { title: 'Pianoles', date: '2026-10-23' });

  let res = await as('lid3', `/api/events/${ev.id}`, { method: 'PUT', body: { title: 'Gehackt' } });
  assert.strictEqual(res.status, 403);
  assert.match((await res.json()).error, /Alleen Kind 2/);
  assert.strictEqual((await as('lid1', `/api/events/${ev.id}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await list('lid1', '2026-10-23', '2026-10-23'))[0].title, 'Pianoles');

  res = await as('lid4', `/api/events/${ev.id}`, { method: 'PUT', body: { time: '16:00', shared: true } });
  const updated = await res.json();
  assert.strictEqual(updated.time, '16:00');
  assert.strictEqual(updated.createdBy, 'lid4');
  assert.strictEqual((await as('lid4', `/api/events/${ev.id}`, { method: 'DELETE' })).status, 204);
});

test('items zonder maker (van vóór de inlog) mag iedereen aanpassen', async () => {
  const res = await as('lid3', '/api/events/oud1', { method: 'PUT', body: { title: 'Oud (aangepast)' } });
  assert.strictEqual(res.status, 200);
});

// ---------- Herhalingen ----------

const dates = async (from, to, title) =>
  (await list('lid1', from, to)).filter((e) => e.title === title).map((e) => e.date);

test('elke week op maandag en donderdag, tot en met een einddatum', async () => {
  const ev = await create('lid3', {
    title: 'Training', date: '2026-11-02', time: '18:30',
    repeat: { freq: 'week', days: [1, 4], until: '2026-11-16' },
  });
  assert.deepStrictEqual(ev.repeat, { freq: 'week', until: '2026-11-16', days: [1, 4] });
  assert.deepStrictEqual(await dates('2026-10-26', '2026-11-30', 'Training'),
    ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-16']);
  const occurrence = (await list('lid1', '2026-11-09', '2026-11-09')).find((e) => e.title === 'Training');
  assert.strictEqual(occurrence.startDate, '2026-11-02');
  assert.strictEqual(occurrence.id, ev.id);
});

test('om de week, standaard op de weekdag van de begindatum', async () => {
  await create('lid1', { title: 'Oud papier', date: '2026-11-04', repeat: { freq: '2weken' } });
  assert.deepStrictEqual(await dates('2026-11-01', '2026-12-10', 'Oud papier'),
    ['2026-11-04', '2026-11-18', '2026-12-02']);
});

test('elke dag, elke maand en elk jaar', async () => {
  await create('lid1', { title: 'Tanden', date: '2026-11-28', repeat: { freq: 'dag', until: '2026-12-01' } });
  assert.deepStrictEqual(await dates('2026-11-01', '2026-12-31', 'Tanden'),
    ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);

  // De 31e komt niet in elke maand voor; die maanden worden overgeslagen.
  await create('lid1', { title: 'Huur', date: '2026-10-31', repeat: { freq: 'maand' } });
  assert.deepStrictEqual(await dates('2026-10-01', '2027-01-31', 'Huur'), ['2026-10-31', '2026-12-31', '2027-01-31']);

  await create('lid2', { title: 'Verjaardag oma', date: '2026-03-14', shared: true, repeat: { freq: 'jaar' } });
  assert.deepStrictEqual(await dates('2026-03-01', '2027-03-31', 'Verjaardag oma'), ['2026-03-14', '2027-03-14']);
});

test('één keer overslaan of de hele reeks verwijderen', async () => {
  const ev = await create('lid2', { title: 'Zwemles', date: '2026-11-07', repeat: { freq: 'week' } });
  assert.strictEqual((await as('lid3', `/api/events/${ev.id}?date=2026-11-14`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await as('lid2', `/api/events/${ev.id}?date=2026-11-14`, { method: 'DELETE' })).status, 204);
  assert.deepStrictEqual(await dates('2026-11-01', '2026-11-30', 'Zwemles'), ['2026-11-07', '2026-11-21', '2026-11-28']);

  assert.strictEqual((await as('lid2', `/api/events/${ev.id}`, { method: 'DELETE' })).status, 204);
  assert.deepStrictEqual(await dates('2026-11-01', '2026-11-30', 'Zwemles'), []);
});

test('herhaling kan worden aangepast of uitgezet, en een einddatum vóór de begindatum mag niet', async () => {
  const ev = await create('lid1', { title: 'Hockey', date: '2026-11-03', repeat: { freq: 'week' } });
  let res = await as('lid1', `/api/events/${ev.id}`, { method: 'PUT', body: { repeat: { freq: 'week', until: '2026-11-01' } } });
  assert.strictEqual(res.status, 400);
  res = await as('lid1', `/api/events/${ev.id}`, { method: 'PUT', body: { repeat: null } });
  assert.strictEqual((await res.json()).repeat, null);
  assert.deepStrictEqual(await dates('2026-11-01', '2026-11-30', 'Hockey'), ['2026-11-03']);
});

// ---------- Spraakberichten ----------

test('spraakbericht opslaan en afspelen', async () => {
  const audio = Buffer.from('nep-audio-data');
  let res = await as('lid1', '/api/voice?date=2026-12-24&person=lid1&person=lid4&duration=4', {
    method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, body: audio,
  });
  assert.strictEqual(res.status, 201);
  const ev = await res.json();
  assert.strictEqual(ev.type, 'spraak');
  assert.strictEqual(ev.title, 'Spraakbericht');
  assert.strictEqual(ev.duration, 4);
  assert.strictEqual(ev.createdBy, 'lid1');
  assert.deepStrictEqual(ev.persons, ['lid1', 'lid4']);

  res = await as('lid3', `/audio/${ev.audio}`);
  assert.strictEqual(res.headers.get('content-type'), 'audio/webm');
  assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), audio);

  res = await as('lid3', `/audio/${ev.audio}`, { headers: { Range: 'bytes=0-2' } });
  assert.strictEqual(res.status, 206);
  assert.strictEqual(await res.text(), 'nep');

  assert.strictEqual((await as('lid4', `/api/events/${ev.id}`, { method: 'DELETE' })).status, 403);
  assert.strictEqual((await as('lid1', `/api/events/${ev.id}`, { method: 'DELETE' })).status, 204);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'audio', ev.audio)));
});

test('gezamenlijk spraakbericht', async () => {
  const ev = await (await as('lid2', '/api/voice?date=2026-12-24&shared=1', {
    method: 'POST', headers: { 'Content-Type': 'audio/mp4' }, body: 'x',
  })).json();
  assert.strictEqual(ev.shared, true);
  assert.ok(ev.audio.endsWith('.m4a'));
});

test('onbekend audioformaat wordt geweigerd', async () => {
  const res = await as('lid1', '/api/voice?date=2026-12-24&shared=1', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x',
  });
  assert.strictEqual(res.status, 415);
});

// ---------- Overig ----------

test('app-bestanden voor de telefoon worden geserveerd', async () => {
  for (const [file, type] of [['manifest.webmanifest', 'application/manifest+json'], ['sw.js', 'text/javascript'], ['icon-192.png', 'image/png']]) {
    const res = await fetch(`${base}/${file}`);
    assert.strictEqual(res.status, 200, file);
    assert.ok(res.headers.get('content-type').startsWith(type), file);
  }
  assert.strictEqual((await fetch(`${base}/api/health`)).status, 200);
});

test('geen toegang buiten de public-map', async () => {
  const res = await fetch(`${base}/..%2fserver.js`);
  assert.notStrictEqual(res.status, 200);
});
