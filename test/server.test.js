const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gezinsagenda-'));
const { server } = require('../server');

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

test('afspraak toevoegen, bewerken en verwijderen', async () => {
  let res = await fetch(`${base}/api/events`, json('POST', { title: 'Tandarts', date: '2026-10-21', time: '09:30', person: 'Mama' }));
  assert.strictEqual(res.status, 201);
  const ev = await res.json();
  assert.strictEqual(ev.type, 'afspraak');

  res = await fetch(`${base}/api/events/${ev.id}`, json('PUT', { time: '10:00' }));
  assert.strictEqual((await res.json()).time, '10:00');

  res = await fetch(`${base}/api/events?from=2026-10-01&to=2026-10-31`);
  assert.deepStrictEqual((await res.json()).map((e) => e.id), [ev.id]);

  res = await fetch(`${base}/api/events/${ev.id}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 204);
});

test('ongeldige afspraak wordt geweigerd', async () => {
  let res = await fetch(`${base}/api/events`, json('POST', { title: 'X', date: 'morgen' }));
  assert.strictEqual(res.status, 400);
  res = await fetch(`${base}/api/events`, json('POST', { title: '', date: '2026-10-21' }));
  assert.strictEqual(res.status, 400);
});

test('spraakbericht opslaan en afspelen', async () => {
  const audio = Buffer.from('nep-audio-data');
  let res = await fetch(`${base}/api/voice?date=2026-12-24&person=Papa&duration=4`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm;codecs=opus' },
    body: audio,
  });
  assert.strictEqual(res.status, 201);
  const ev = await res.json();
  assert.strictEqual(ev.type, 'spraak');
  assert.strictEqual(ev.title, 'Spraakbericht');
  assert.strictEqual(ev.duration, 4);

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

test('onbekend audioformaat wordt geweigerd', async () => {
  const res = await fetch(`${base}/api/voice?date=2026-12-24`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x',
  });
  assert.strictEqual(res.status, 415);
});

test('gezinsleden aanpassen', async () => {
  let res = await fetch(`${base}/api/family`, json('PUT', [{ name: 'Thomas', color: '#123456' }, { name: '' }]));
  assert.deepStrictEqual(await res.json(), [{ name: 'Thomas', color: '#123456' }]);
});

test('geen toegang buiten de public-map', async () => {
  const res = await fetch(`${base}/..%2fserver.js`);
  assert.notStrictEqual(res.status, 200);
});
