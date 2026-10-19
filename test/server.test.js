const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gezinsagenda-'));

// Gegevens van de vorige versie, met één naam per afspraak.
fs.writeFileSync(path.join(process.env.DATA_DIR, 'events.json'), JSON.stringify([
  { id: 'oud1', type: 'afspraak', date: '2026-11-01', time: '', endTime: '', title: 'Oud', person: 'Mama', notes: '' },
  { id: 'oud2', type: 'afspraak', date: '2026-11-02', time: '', endTime: '', title: 'Uitje', person: 'Iedereen', notes: '' },
]));

const { handler } = require('../server');
const server = http.createServer(handler);

let base;
before(() => new Promise((resolve) => server.listen(0, () => {
  base = `http://localhost:${server.address().port}`;
  resolve();
})));
after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('standaard zijn er vier gezinsleden', async () => {
  const family = await (await fetch(`${base}/api/family`)).json();
  assert.strictEqual(family.length, 4);
  assert.ok(family.every((m) => m.id && m.name && m.color));
});

test('oude afspraken worden omgezet naar het nieuwe formaat', async () => {
  const list = await (await fetch(`${base}/api/events?from=2026-11-01&to=2026-11-02`)).json();
  assert.deepStrictEqual(list.map((e) => [e.id, e.persons, e.shared]), [
    ['oud1', ['lid2'], false],
    ['oud2', [], true],
  ]);
});

test('eigen activiteit: zonder keuze is hij voor degene die hem invoert', async () => {
  const res = await fetch(`${base}/api/events`, json('POST', { title: 'Voetbal', date: '2026-10-21', createdBy: 'lid3' }));
  assert.strictEqual(res.status, 201);
  const ev = await res.json();
  assert.deepStrictEqual(ev.persons, ['lid3']);
  assert.strictEqual(ev.shared, false);
  assert.strictEqual(ev.createdBy, 'lid3');
});

test('activiteit voor meerdere gezinsleden, en onbekende leden worden genegeerd', async () => {
  const ev = await (await fetch(`${base}/api/events`, json('POST', {
    title: 'Ouderavond', date: '2026-10-22', persons: ['lid1', 'lid2', 'lid1', 'bestaatniet'], createdBy: 'lid1',
  }))).json();
  assert.deepStrictEqual(ev.persons, ['lid1', 'lid2']);
});

test('gezamenlijke activiteit', async () => {
  const ev = await (await fetch(`${base}/api/events`, json('POST', {
    title: 'Naar oma', date: '2026-10-25', shared: true, persons: ['lid1'], createdBy: 'lid2',
  }))).json();
  assert.strictEqual(ev.shared, true);
  assert.deepStrictEqual(ev.persons, []);
});

test('zonder gezinslid en zonder maker wordt geweigerd', async () => {
  const res = await fetch(`${base}/api/events`, json('POST', { title: 'X', date: '2026-10-21' }));
  assert.strictEqual(res.status, 400);
});

test('afspraak bewerken houdt de maker en verwijderen werkt', async () => {
  const ev = await (await fetch(`${base}/api/events`, json('POST', {
    title: 'Tandarts', date: '2026-10-21', time: '09:30', persons: ['lid2'], createdBy: 'lid2',
  }))).json();

  const updated = await (await fetch(`${base}/api/events/${ev.id}`,
    json('PUT', { time: '10:00', createdBy: 'lid4', shared: true }))).json();
  assert.strictEqual(updated.time, '10:00');
  assert.strictEqual(updated.shared, true);
  assert.strictEqual(updated.createdBy, 'lid2');

  const res = await fetch(`${base}/api/events/${ev.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 204);
});

test('ongeldige afspraak wordt geweigerd', async () => {
  let res = await fetch(`${base}/api/events`, json('POST', { title: 'X', date: 'morgen', createdBy: 'lid1' }));
  assert.strictEqual(res.status, 400);
  res = await fetch(`${base}/api/events`, json('POST', { title: '', date: '2026-10-21', createdBy: 'lid1' }));
  assert.strictEqual(res.status, 400);
});

test('spraakbericht opslaan en afspelen', async () => {
  const audio = Buffer.from('nep-audio-data');
  let res = await fetch(`${base}/api/voice?date=2026-12-24&person=lid1&person=lid4&createdBy=lid1&duration=4`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm;codecs=opus' },
    body: audio,
  });
  assert.strictEqual(res.status, 201);
  const ev = await res.json();
  assert.strictEqual(ev.type, 'spraak');
  assert.strictEqual(ev.title, 'Spraakbericht');
  assert.strictEqual(ev.duration, 4);
  assert.deepStrictEqual(ev.persons, ['lid1', 'lid4']);

  res = await fetch(`${base}/audio/${ev.audio}`);
  assert.strictEqual(res.headers.get('content-type'), 'audio/webm');
  assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), audio);

  res = await fetch(`${base}/audio/${ev.audio}`, { headers: { Range: 'bytes=0-2' } });
  assert.strictEqual(res.status, 206);
  assert.strictEqual(await res.text(), 'nep');

  await fetch(`${base}/api/events/${ev.id}`, { method: 'DELETE' });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'audio', ev.audio)));
});

test('gezamenlijk spraakbericht', async () => {
  const ev = await (await fetch(`${base}/api/voice?date=2026-12-24&shared=1&createdBy=lid2`, {
    method: 'POST', headers: { 'Content-Type': 'audio/mp4' }, body: 'x',
  })).json();
  assert.strictEqual(ev.shared, true);
  assert.ok(ev.audio.endsWith('.m4a'));
});

test('onbekend audioformaat wordt geweigerd', async () => {
  const res = await fetch(`${base}/api/voice?date=2026-12-24&shared=1`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x',
  });
  assert.strictEqual(res.status, 415);
});

test('gezinsleden aanpassen behoudt hun id', async () => {
  const res = await fetch(`${base}/api/family`, json('PUT', [
    { id: 'lid1', name: 'Thomas', color: '#123456' },
    { name: 'Nieuw', color: 'rood' },
    { name: '' },
  ]));
  const family = await res.json();
  assert.strictEqual(family.length, 2);
  assert.deepStrictEqual(family[0], { id: 'lid1', name: 'Thomas', color: '#123456' });
  assert.match(family[1].id, /^lid-/);
  assert.strictEqual(family[1].color, '#868e96');

  const empty = await fetch(`${base}/api/family`, json('PUT', []));
  assert.strictEqual(empty.status, 400);
});

test('app-bestanden voor de telefoon worden geserveerd', async () => {
  for (const [file, type] of [['manifest.webmanifest', 'application/manifest+json'], ['sw.js', 'text/javascript'], ['icon-192.png', 'image/png']]) {
    const res = await fetch(`${base}/${file}`);
    assert.strictEqual(res.status, 200, file);
    assert.ok(res.headers.get('content-type').startsWith(type), file);
  }
});

test('geen toegang buiten de public-map', async () => {
  const res = await fetch(`${base}/..%2fserver.js`);
  assert.notStrictEqual(res.status, 200);
});
