'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  month: startOfMonth(new Date()),
  selected: toKey(new Date()),
  events: [],
  family: [],
  editingId: null,
};

// ---------- Hulpfuncties ----------

function pad(n) { return String(n).padStart(2, '0'); }
function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function formatDuration(sec) { return `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`; }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function colorFor(person) {
  return state.family.find((m) => m.name === person)?.color || '#868e96';
}

async function api(method, url, body, headers) {
  const res = await fetch(url, {
    method,
    headers: body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : headers,
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
  renderMonth();
  renderDay();
  renderLegend();
}

function renderMonth() {
  $('#monthTitle').textContent = state.month.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  const { start } = visibleRange();
  const todayKey = toKey(new Date());
  const byDate = Map.groupBy
    ? Map.groupBy(state.events, (e) => e.date)
    : state.events.reduce((m, e) => m.set(e.date, [...(m.get(e.date) || []), e]), new Map());

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
      el('span', {
        class: 'chip' + (e.type === 'spraak' ? ' voice-chip' : ''),
        style: { background: colorFor(e.person) },
        title: e.title,
      }, (e.type === 'spraak' ? '🎤 ' : '') + (e.time ? e.time + ' ' : '') + e.title)
    );
    if (items.length > 3) chips.push(el('span', { class: 'more' }, `+${items.length - 3} meer`));

    grid.append(el('button', {
      class: classes.join(' '),
      'aria-label': d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) + `, ${items.length} items`,
      onclick: () => selectDay(key),
      ondblclick: () => openEventDialog(),
    }, el('span', { class: 'num' }, d.getDate()), chips));
  }
}

function renderDay() {
  const date = fromKey(state.selected);
  $('#dayTitle').textContent = date.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const items = state.events.filter((e) => e.date === state.selected);
  const list = $('#dayList');
  list.replaceChildren();
  if (!items.length) {
    list.append(el('li', { class: 'empty' }, 'Nog niets gepland op deze dag.'));
    return;
  }
  for (const e of items) {
    const when = e.time ? (e.endTime ? `${e.time} – ${e.endTime}` : e.time) : 'Hele dag';
    const meta = [when, e.person, e.type === 'spraak' && e.duration ? `🎤 ${formatDuration(e.duration)}` : null]
      .filter(Boolean).join(' · ');
    list.append(el('li', { class: 'item', style: { '--c': colorFor(e.person) } },
      el('div', { class: 'item-head' },
        el('div', {},
          el('div', { class: 'item-title' }, (e.type === 'spraak' ? '🎤 ' : '') + e.title),
          el('div', { class: 'item-meta' }, meta)),
        el('div', { class: 'item-buttons' },
          e.type === 'afspraak' ? el('button', { 'aria-label': 'Bewerken', onclick: () => openEventDialog(e) }, '✏️') : null,
          el('button', { 'aria-label': 'Verwijderen', onclick: () => removeEvent(e) }, '🗑️'))),
      e.notes ? el('p', { class: 'item-notes' }, e.notes) : null,
      e.audio ? el('audio', { controls: '', preload: 'metadata', src: `/audio/${e.audio}` }) : null));
  }
}

function renderLegend() {
  $('#legend').replaceChildren(...state.family.map((m) => el('span', { style: { '--c': m.color } }, m.name)));
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
  state.selected = toKey(state.month);
  loadEvents();
}

function fillPersonSelect(select, value) {
  select.replaceChildren(
    el('option', { value: '' }, '—'),
    ...state.family.map((m) => el('option', { value: m.name }, m.name))
  );
  select.value = value || '';
}

// ---------- Afspraken ----------

function openEventDialog(ev) {
  const form = $('#eventForm');
  form.reset();
  showError(form);
  state.editingId = ev?.id || null;
  $('#eventDialogTitle').textContent = ev ? 'Afspraak bewerken' : 'Nieuwe afspraak';
  fillPersonSelect(form.person, ev?.person);
  form.title.value = ev?.title || '';
  form.date.value = ev?.date || state.selected;
  form.time.value = ev?.time || '';
  form.endTime.value = ev?.endTime || '';
  form.notes.value = ev?.notes || '';
  $('#eventDialog').showModal();
  form.title.focus();
}

$('#eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (state.editingId) await api('PUT', `/api/events/${state.editingId}`, data);
    else await api('POST', '/api/events', data);
    $('#eventDialog').close();
    state.selected = data.date;
    state.month = startOfMonth(fromKey(data.date));
    await loadEvents();
  } catch (err) {
    showError(form, err.message);
  }
});

async function removeEvent(ev) {
  const what = ev.type === 'spraak' ? 'dit spraakbericht' : `"${ev.title}"`;
  if (!confirm(`Weet je zeker dat je ${what} wilt verwijderen?`)) return;
  try {
    await api('DELETE', `/api/events/${ev.id}`);
    await loadEvents();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Spraakberichten ----------

const rec = { recorder: null, stream: null, chunks: [], blob: null, started: 0, timer: null, duration: 0 };

function pickMimeType() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return options.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

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
  fillPersonSelect(form.person);
  form.date.value = state.selected;
  setRecording(null, 0);
  $('#recTime').textContent = '0:00';
  $('#recStatus').textContent = navigator.mediaDevices?.getUserMedia && window.MediaRecorder
    ? 'Druk op de rode knop om op te nemen'
    : 'Opnemen wordt hier niet ondersteund (gebruik https). Kies hieronder een geluidsbestand.';
  $('#voiceDialog').showModal();
}

async function toggleRecording() {
  const form = $('#voiceForm');
  const btn = $('#recBtn');
  if (rec.recorder && rec.recorder.state === 'recording') {
    rec.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError(form, 'Je browser kan hier niet opnemen. Open de agenda via https of localhost, of kies een geluidsbestand.');
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
    $('#recStatus').textContent = 'Opname klaar. Luister terug of neem opnieuw op.';
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
  $('#recStatus').textContent = `Bestand gekozen: ${file.name}`;
});

$('#voiceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!rec.blob) return showError(form, 'Neem eerst een bericht op.');
  const params = new URLSearchParams({
    date: form.date.value,
    time: form.time.value,
    person: form.person.value,
    title: form.title.value,
    duration: String(Math.round(rec.duration)),
  });
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

function familyRow(member = { name: '', color: '#868e96' }) {
  const li = el('li', {},
    el('input', { type: 'color', value: member.color, 'aria-label': 'Kleur' }),
    el('input', { type: 'text', value: member.name, placeholder: 'Naam', maxlength: '60' }),
    el('button', { type: 'button', class: 'danger', 'aria-label': 'Verwijderen', onclick: () => li.remove() }, '✕'));
  return li;
}

$('#familyBtn').addEventListener('click', () => {
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
    color: li.querySelector('input[type=color]').value,
    name: li.querySelector('input[type=text]').value.trim(),
  })).filter((m) => m.name);
  try {
    state.family = await api('PUT', '/api/family', members);
    $('#familyDialog').close();
    render();
  } catch (err) {
    alert(err.message);
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

// Ververs regelmatig zodat je ziet wat andere gezinsleden hebben toegevoegd.
setInterval(() => {
  if (!document.hidden && !document.querySelector('dialog[open]')) loadEvents().catch(() => {});
}, 30000);

(async function init() {
  try {
    state.family = await api('GET', '/api/family');
    await loadEvents();
  } catch (err) {
    $('#dayList').replaceChildren(el('li', { class: 'empty' }, 'Kan de agenda niet laden: ' + err.message));
  }
})();
