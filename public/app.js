'use strict';

const $ = (sel) => document.querySelector(sel);
const SHARED_COLOR = '#f08c00';
const STORAGE_ME = 'gezinsagenda.ik';
const STORAGE_FILTER = 'gezinsagenda.filter';

const state = {
  month: startOfMonth(new Date()),
  selected: toKey(new Date()),
  events: [],
  family: [],
  me: storageGet(STORAGE_ME),
  filter: storageGet(STORAGE_FILTER) || 'all',
  editing: null,
};

// ---------- Hulpfuncties ----------

function pad(n) { return String(n).padStart(2, '0'); }
function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function formatDuration(sec) { return `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`; }

// Op sommige telefoons (privévenster) is localStorage niet beschikbaar; de app werkt dan gewoon zonder.
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* negeren */ } }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null) node.append(c);
  return node;
}

const member = (id) => state.family.find((m) => m.id === id);
const memberName = (id) => member(id)?.name || 'onbekend';

function avatar(m, cls = 'avatar') {
  return el('span', { class: cls, style: { '--c': m.color }, 'aria-hidden': 'true' }, m.name.charAt(0).toUpperCase());
}

function colorsOf(ev) {
  if (ev.shared) return [SHARED_COLOR];
  const colors = ev.persons.map((id) => member(id)?.color).filter(Boolean);
  return colors.length ? colors : ['#868e96'];
}

// Eén kleur per gezinslid; bij meerdere personen een gestreepte balk.
function chipBackground(ev) {
  const colors = colorsOf(ev);
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

function isVisible(ev) {
  return state.filter === 'all' || ev.shared || ev.persons.includes(state.filter);
}

// Alleen wie een item heeft ingevoerd mag het aanpassen (de server controleert dit ook).
// Items van een verwijderd gezinslid mag iedereen aanpassen.
function isMine(ev) {
  return ev.createdBy === state.me || !member(ev.createdBy);
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : headers),
      'X-Gezinslid': state.me || '',
    },
    body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
  return data;
}

function showError(form, msg) {
  const p = form.querySelector('.error');
  p.textContent = msg || '';
  p.hidden = !msg;
}

// ---------- Gegevens laden ----------

function visibleRange() {
  const first = state.month;
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // maandag als eerste dag
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  return { start, end };
}

async function loadEvents() {
  const { start, end } = visibleRange();
  state.events = await api('GET', `/api/events?from=${toKey(start)}&to=${toKey(end)}`);
  render();
}

// ---------- Weergave ----------

function render() {
  renderHeader();
  renderFilters();
  renderMonth();
  renderDay();
}

function renderHeader() {
  $('#monthTitle').textContent = state.month.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  const me = member(state.me);
  const btn = $('#meBtn');
  btn.textContent = me ? me.name.charAt(0).toUpperCase() : '?';
  btn.style.setProperty('--c', me?.color || '#868e96');
  btn.title = me ? `Je bent ${me.name} (tik om te wisselen)` : 'Kies wie je bent';
}

function renderFilters() {
  const make = (value, label, m) => el('button', {
    class: m ? '' : 'all',
    'aria-pressed': String(state.filter === value),
    onclick: () => {
      state.filter = value;
      storageSet(STORAGE_FILTER, value);
      render();
    },
  }, m ? avatar(m) : null, label);
  $('#filters').replaceChildren(
    make('all', 'Iedereen'),
    ...state.family.map((m) => make(m.id, m.id === state.me ? `${m.name} (ik)` : m.name, m))
  );
}

function renderMonth() {
  const { start } = visibleRange();
  const todayKey = toKey(new Date());
  const byDate = new Map();
  for (const e of state.events.filter(isVisible)) byDate.set(e.date, [...(byDate.get(e.date) || []), e]);

  const grid = $('#grid');
  grid.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = toKey(d);
    const items = byDate.get(key) || [];
    const classes = ['cell'];
    if (d.getMonth() !== state.month.getMonth()) classes.push('other');
    if (key === todayKey) classes.push('today');
    if (key === state.selected) classes.push('selected');

    const chips = items.slice(0, 3).map((e) =>
      el('span', { class: 'chip', style: { '--c': chipBackground(e) }, title: e.title },
        (e.type === 'spraak' ? '🎤 ' : '') + (e.time ? e.time + ' ' : '') + e.title));
    if (items.length > 3) chips.push(el('span', { class: 'more' }, `+${items.length - 3}`));

    grid.append(el('button', {
      class: classes.join(' '),
      'aria-label': d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) + `, ${items.length} items`,
      onclick: () => selectDay(key),
      ondblclick: () => openEventDialog(),
    }, el('span', { class: 'num' }, d.getDate()), chips));
  }
}

function whoLine(ev) {
  if (ev.shared) return el('span', { class: 'badge-shared' }, 'Gezamenlijk');
  return ev.persons.filter(member).map((id) => [avatar(member(id)), el('span', {}, memberName(id) + ' ')]);
}

function renderDay() {
  const date = fromKey(state.selected);
  $('#dayTitle').textContent = date.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const items = state.events.filter((e) => e.date === state.selected && isVisible(e));
  const list = $('#dayList');
  list.replaceChildren();
  if (!items.length) {
    list.append(el('li', { class: 'empty' }, 'Nog niets gepland op deze dag.'));
    return;
  }
  for (const e of items) {
    const when = e.time ? (e.endTime ? `${e.time} – ${e.endTime}` : e.time) : 'Hele dag';
    const meta = [
      when,
      e.type === 'spraak' && e.duration ? `🎤 ${formatDuration(e.duration)}` : null,
      e.createdBy ? `door ${memberName(e.createdBy)}` : null,
    ].filter(Boolean).join(' · ');
    const mine = isMine(e);
    const editable = mine && e.type === 'afspraak';
    list.append(el('li', {
      class: 'item' + (editable ? ' editable' : ''),
      style: { '--c': colorsOf(e)[0] },
      onclick: editable ? () => openEventDialog(e) : undefined,
    },
      el('div', { class: 'item-head' },
        el('div', {},
          el('div', { class: 'item-title' }, (e.type === 'spraak' ? '🎤 ' : '') + e.title),
          el('div', { class: 'item-meta' }, meta)),
        el('div', { class: 'item-buttons' },
          !mine ? null
            : editable
              ? el('button', { 'aria-label': 'Bewerken' }, '✏️')
              : el('button', { 'aria-label': 'Verwijderen', onclick: () => removeEvent(e) }, '🗑️'))),
      el('div', { class: 'item-who' }, whoLine(e)),
      e.notes ? el('p', { class: 'item-notes' }, e.notes) : null,
      e.audio ? el('audio', { controls: '', preload: 'none', src: `/audio/${e.audio}` }) : null));
  }
}

function selectDay(key) {
  state.selected = key;
  const d = fromKey(key);
  if (d.getMonth() !== state.month.getMonth() || d.getFullYear() !== state.month.getFullYear()) {
    state.month = startOfMonth(d);
    loadEvents();
  } else {
    render();
  }
}

function changeMonth(delta) {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
  const today = new Date();
  const isThisMonth = state.month.getMonth() === today.getMonth() && state.month.getFullYear() === today.getFullYear();
  state.selected = toKey(isThisMonth ? today : state.month);
  loadEvents();
}

// ---------- Voor wie: één of meer gezinsleden, of gezamenlijk ----------

function whoPicker(container, initial) {
  const value = { shared: !!initial.shared, persons: new Set(initial.persons || []) };
  const draw = () => {
    container.replaceChildren(
      ...state.family.map((m) => el('button', {
        type: 'button',
        style: { '--c': m.color },
        'aria-pressed': String(!value.shared && value.persons.has(m.id)),
        onclick: () => {
          if (value.shared) { value.shared = false; value.persons.clear(); }
          value.persons.has(m.id) ? value.persons.delete(m.id) : value.persons.add(m.id);
          draw();
        },
      }, avatar(m), m.name)),
      el('button', {
        type: 'button',
        class: 'shared',
        'aria-pressed': String(value.shared),
        onclick: () => { value.shared = !value.shared; draw(); },
      }, '👨‍👩‍👧‍👦 Gezamenlijk')
    );
  };
  draw();
  return () => ({ shared: value.shared, persons: [...value.persons] });
}

// ---------- Wie ben ik ----------

function openMeDialog() {
  const list = $('#meList');
  list.replaceChildren(...state.family.map((m) => el('button', {
    type: 'button',
    'aria-pressed': String(m.id === state.me),
    onclick: () => {
      state.me = m.id;
      storageSet(STORAGE_ME, m.id);
      $('#meDialog').close();
      render();
    },
  }, avatar(m, 'avatar big'), m.name)));
  if (!$('#meDialog').open) $('#meDialog').showModal();
}

// Zonder naam kun je het venster niet wegklikken.
$('#meDialog').addEventListener('cancel', (e) => { if (!member(state.me)) e.preventDefault(); });
$('#meBtn').addEventListener('click', openMeDialog);

// ---------- Activiteiten ----------

let getEventWho;

function openEventDialog(ev) {
  const form = $('#eventForm');
  form.reset();
  showError(form);
  state.editing = ev || null;
  $('#eventDialogTitle').textContent = ev ? 'Activiteit bewerken' : 'Nieuwe activiteit';
  $('#eventDelete').hidden = !ev;
  getEventWho = whoPicker(form.querySelector('.who'), ev || { persons: state.me ? [state.me] : [] });
  form.title.value = ev?.title || '';
  form.date.value = ev?.date || state.selected;
  form.time.value = ev?.time || '';
  form.endTime.value = ev?.endTime || '';
  form.notes.value = ev?.notes || '';
  $('#eventDialog').showModal();
  if (!ev && matchMedia('(pointer: fine)').matches) form.title.focus();
}

$('#eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const who = getEventWho();
  if (!who.shared && !who.persons.length) return showError(form, 'Kies voor wie deze activiteit is.');
  const data = { ...Object.fromEntries(new FormData(form)), ...who, createdBy: state.me };
  try {
    if (state.editing) await api('PUT', `/api/events/${state.editing.id}`, data);
    else await api('POST', '/api/events', data);
    $('#eventDialog').close();
    state.selected = data.date;
    state.month = startOfMonth(fromKey(data.date));
    await loadEvents();
  } catch (err) {
    showError(form, err.message);
  }
});

$('#eventDelete').addEventListener('click', async () => {
  if (await removeEvent(state.editing)) $('#eventDialog').close();
});

async function removeEvent(ev) {
  const what = ev.type === 'spraak' ? 'dit spraakbericht' : `"${ev.title}"`;
  if (!confirm(`Weet je zeker dat je ${what} wilt verwijderen?`)) return false;
  try {
    await api('DELETE', `/api/events/${ev.id}`);
    await loadEvents();
    return true;
  } catch (err) {
    alert(err.message);
    return false;
  }
}

// ---------- Spraakberichten ----------

const rec = { recorder: null, stream: null, chunks: [], blob: null, started: 0, timer: null, duration: 0 };
let getVoiceWho;

function pickMimeType() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return options.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

function setRecording(blob, duration) {
  rec.blob = blob;
  rec.duration = duration;
  const preview = $('#recPreview');
  if (preview.src) URL.revokeObjectURL(preview.src);
  if (blob) {
    preview.src = URL.createObjectURL(blob);
    preview.hidden = false;
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
  }
  $('#voiceSave').disabled = !blob;
}

function stopStream() {
  rec.stream?.getTracks().forEach((t) => t.stop());
  rec.stream = null;
  clearInterval(rec.timer);
}

function openVoiceDialog() {
  const form = $('#voiceForm');
  form.reset();
  showError(form);
  getVoiceWho = whoPicker(form.querySelector('.who'), { shared: true });
  form.date.value = state.selected;
  setRecording(null, 0);
  $('#recTime').textContent = '0:00';
  $('#recBtn').hidden = !canRecord();
  $('#recStatus').textContent = canRecord()
    ? 'Druk op de rode knop om op te nemen'
    : 'Opnemen kan hier alleen via een https-adres. Je kunt wel een spraakmemo kiezen.';
  $('#voiceDialog').showModal();
}

async function toggleRecording() {
  const form = $('#voiceForm');
  const btn = $('#recBtn');
  if (rec.recorder && rec.recorder.state === 'recording') {
    rec.recorder.stop();
    return;
  }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showError(form, 'Geen toegang tot de microfoon. Sta microfoongebruik toe in je browser.');
    return;
  }
  showError(form);
  setRecording(null, 0);
  const mimeType = pickMimeType();
  rec.recorder = new MediaRecorder(rec.stream, mimeType ? { mimeType } : undefined);
  rec.chunks = [];
  rec.recorder.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
  rec.recorder.onstop = () => {
    const duration = (Date.now() - rec.started) / 1000;
    stopStream();
    const type = (rec.recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
    setRecording(new Blob(rec.chunks, { type }), duration);
    btn.classList.remove('recording');
    btn.textContent = '●';
    btn.setAttribute('aria-label', 'Opnieuw opnemen');
    $('#recStatus').textContent = 'Klaar! Luister terug of neem opnieuw op.';
  };
  rec.recorder.start();
  rec.started = Date.now();
  btn.classList.add('recording');
  btn.textContent = '■';
  btn.setAttribute('aria-label', 'Opname stoppen');
  $('#recStatus').textContent = 'Bezig met opnemen… druk om te stoppen';
  rec.timer = setInterval(() => {
    $('#recTime').textContent = formatDuration((Date.now() - rec.started) / 1000);
  }, 250);
}

$('#recBtn').addEventListener('click', toggleRecording);

$('#recFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (rec.recorder?.state === 'recording') rec.recorder.stop();
  setRecording(file, 0);
  // Lees de duur uit het bestand zodra de metadata geladen is.
  $('#recPreview').onloadedmetadata = (ev) => {
    const d = ev.target.duration;
    if (Number.isFinite(d)) {
      rec.duration = d;
      $('#recTime').textContent = formatDuration(d);
    }
  };
  $('#recStatus').textContent = `Gekozen: ${file.name}`;
});

$('#voiceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!rec.blob) return showError(form, 'Neem eerst een bericht op.');
  const who = getVoiceWho();
  if (!who.shared && !who.persons.length) return showError(form, 'Kies voor wie dit bericht is.');
  const params = new URLSearchParams({
    date: form.date.value,
    time: form.time.value,
    title: form.title.value,
    duration: String(Math.round(rec.duration)),
    shared: who.shared ? '1' : '0',
    createdBy: state.me || '',
  });
  who.persons.forEach((id) => params.append('person', id));
  const type = (rec.blob.type || 'audio/webm').split(';')[0];
  $('#voiceSave').disabled = true;
  try {
    await api('POST', `/api/voice?${params}`, rec.blob, { 'Content-Type': type });
    $('#voiceDialog').close();
    state.selected = form.date.value;
    state.month = startOfMonth(fromKey(form.date.value));
    await loadEvents();
  } catch (err) {
    showError(form, err.message);
    $('#voiceSave').disabled = false;
  }
});

$('#voiceDialog').addEventListener('close', () => {
  if (rec.recorder?.state === 'recording') rec.recorder.stop();
  stopStream();
});

// ---------- Gezinsleden ----------

function familyRow(m = { id: '', name: '', color: '#868e96' }) {
  const li = el('li', { 'data-id': m.id },
    el('input', { type: 'color', value: m.color, 'aria-label': 'Kleur' }),
    el('input', { type: 'text', value: m.name, placeholder: 'Naam', maxlength: '60' }),
    el('button', { type: 'button', class: 'danger', 'aria-label': 'Verwijderen', onclick: () => li.remove() }, '✕'));
  return li;
}

$('#familyBtn').addEventListener('click', () => {
  showError($('#familyForm'));
  $('#familyList').replaceChildren(...state.family.map(familyRow));
  $('#familyDialog').showModal();
});

$('#familyAdd').addEventListener('click', () => {
  const row = familyRow();
  $('#familyList').append(row);
  row.querySelector('input[type=text]').focus();
});

$('#familyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const members = [...$('#familyList').children].map((li) => ({
    id: li.dataset.id || undefined,
    color: li.querySelector('input[type=color]').value,
    name: li.querySelector('input[type=text]').value.trim(),
  })).filter((m) => m.name);
  try {
    state.family = await api('PUT', '/api/family', members);
    $('#familyDialog').close();
    if ($('#meDialog').open) openMeDialog();
    render();
  } catch (err) {
    showError(e.target, err.message);
  }
});

// ---------- Algemeen ----------

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));

$('#prev').addEventListener('click', () => changeMonth(-1));
$('#next').addEventListener('click', () => changeMonth(1));
$('#today').addEventListener('click', () => selectDay(toKey(new Date())));
$('#addEvent').addEventListener('click', () => openEventDialog());
$('#addVoice').addEventListener('click', openVoiceDialog);

// Veeg naar links of rechts over de kalender om van maand te wisselen.
let touchStart = null;
$('#grid').addEventListener('touchstart', (e) => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
$('#grid').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 50) changeMonth(dx < 0 ? 1 : -1);
});

// Ververs regelmatig, en zodra de app weer geopend wordt, zodat je ziet wat de anderen hebben toegevoegd.
const refresh = () => {
  if (!document.hidden && !document.querySelector('dialog[open]')) loadEvents().catch(() => {});
};
setInterval(refresh, 30000);
document.addEventListener('visibilitychange', refresh);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async function init() {
  try {
    state.family = await api('GET', '/api/family');
    if (state.filter !== 'all' && !member(state.filter)) state.filter = 'all';
    await loadEvents();
    if (!member(state.me)) openMeDialog();
  } catch (err) {
    $('#dayList').replaceChildren(el('li', { class: 'empty' }, 'Kan de agenda niet laden: ' + err.message));
  }
})();
