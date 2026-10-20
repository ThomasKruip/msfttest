'use strict';

const O = window.Offerte;
const $ = (sel) => document.querySelector(sel);

// ---------- Onthouden in deze browser ----------

const opslag = {
  lees(sleutel, standaard) {
    try {
      const v = localStorage.getItem(`offertetool.${sleutel}`);
      return v === null ? standaard : JSON.parse(v);
    } catch { return standaard; }
  },
  schrijf(sleutel, waarde) {
    try { localStorage.setItem(`offertetool.${sleutel}`, JSON.stringify(waarde)); } catch { /* niet beschikbaar */ }
  },
};

// De gekozen bestanden zelf staan in IndexedDB (localStorage is daar te klein voor).
function database() {
  return new Promise((resolve, reject) => {
    const verzoek = indexedDB.open('offertetool', 1);
    verzoek.onupgradeneeded = () => verzoek.result.createObjectStore('bestanden');
    verzoek.onsuccess = () => resolve(verzoek.result);
    verzoek.onerror = () => reject(verzoek.error);
  });
}

async function bewaarBestand(soort, naam, buffer) {
  try {
    const db = await database();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('bestanden', 'readwrite');
      tx.objectStore('bestanden').put({ naam, buffer }, soort);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* dan moet het bestand de volgende keer opnieuw gekozen worden */ }
}

async function haalBestand(soort) {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const verzoek = db.transaction('bestanden').objectStore('bestanden').get(soort);
      verzoek.onsuccess = () => resolve(verzoek.result || null);
      verzoek.onerror = () => reject(verzoek.error);
    });
  } catch { return null; }
}

// ---------- Toestand ----------

const staat = {
  tabellen: [],
  sjabloon: null,
  // Per tabel (op sleutel): { aan, index, kop, boven, onder }
  instellingen: opslag.lees('tabellen', {}),
  volgorde: opslag.lees('volgorde', []),
};

const vandaag = () => new Date().toISOString().slice(0, 10);

function getal(tekst) {
  const s = String(tekst ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const algemeenProcent = () => getal($('#index-algemeen').value) || 0;
const afronding = () => Number($('#afronding').value) || 0.01;

function instelling(t) {
  if (!staat.instellingen[t.sleutel]) {
    staat.instellingen[t.sleutel] = {
      aan: t.rijen.length > 15 || /track/i.test(t.titel),
      index: '',
      kop: t.titel,
      boven: t.soort === 'staffel' ? 'Per adres, exclusief BTW en vrachtwagenheffing' : '',
      onder: '',
    };
  }
  return staat.instellingen[t.sleutel];
}

function procentVoor(t) {
  const eigen = getal(instelling(t).index);
  return eigen === null || Number.isNaN(eigen) ? algemeenProcent() : eigen;
}

function bewaarInstellingen() {
  opslag.schrijf('tabellen', staat.instellingen);
  opslag.schrijf('volgorde', staat.volgorde);
}

function gekozenTabellen() {
  const aan = staat.tabellen.filter((t) => instelling(t).aan);
  // Nieuw aangevinkte tabellen komen achteraan, staffels vóór losse lijsten.
  const nieuw = aan.filter((t) => !staat.volgorde.includes(t.sleutel));
  nieuw.sort((a, b) => (a.soort === 'staffel' ? 0 : 1) - (b.soort === 'staffel' ? 0 : 1));
  for (const t of nieuw) staat.volgorde.push(t.sleutel);
  return aan.sort((a, b) => staat.volgorde.indexOf(a.sleutel) - staat.volgorde.indexOf(b.sleutel));
}

// ---------- Bestanden ----------

function toonBestand(soort, naam) {
  const el = $(soort === 'excel' ? '#excel-naam' : '#sjabloon-naam');
  el.textContent = naam || 'Nog geen bestand gekozen';
  el.classList.toggle('gekozen', Boolean(naam));
}

function toonFout(tekst) {
  const el = $('#bestand-fout');
  el.textContent = tekst || '';
  el.hidden = !tekst;
}

async function laadExcel(naam, buffer, { nieuw }) {
  const tabellen = O.vindTabellen(await O.leesExcel(buffer));
  if (!tabellen.length) throw new Error(`In ${naam} zijn geen tarieftabellen gevonden.`);
  staat.tabellen = tabellen;
  toonBestand('excel', naam);
  const eind = O.einddatumUitNaam(naam);
  if (eind && (nieuw || !$('#v-geldig_tm').value)) $('#v-geldig_tm').value = eind;
  tekenTabellen();
}

async function laadSjabloon(naam, buffer) {
  const zip = await O.leesZip(buffer);
  if (!zip.heeft('word/document.xml')) throw new Error(`${naam} is geen Word-bestand (.docx).`);
  staat.sjabloon = buffer;
  toonBestand('sjabloon', naam);
  werkKnopBij();
}

function kiesBestand(invoer, soort) {
  invoer.addEventListener('change', async () => {
    const bestand = invoer.files[0];
    invoer.value = '';
    if (!bestand) return;
    toonFout('');
    try {
      const buffer = await bestand.arrayBuffer();
      if (soort === 'excel') await laadExcel(bestand.name, buffer, { nieuw: true });
      else await laadSjabloon(bestand.name, buffer);
      await bewaarBestand(soort, bestand.name, buffer);
    } catch (e) {
      toonFout(e.message);
    }
  });
}

// ---------- Tabellen tekenen ----------

function element(tag, eigenschappen = {}, ...kinderen) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(eigenschappen)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kind of kinderen) if (kind !== null && kind !== undefined) el.append(kind);
  return el;
}

function voorbeeldTabel(t) {
  const procent = procentVoor(t);
  const stap = afronding();
  const veranderd = procent !== 0 || stap !== 0.01;
  const tabel = element('table');
  tabel.append(element('tr', {}, ...t.kolommen.map((k) => element('th', { textContent: k.kop }))));
  for (const rij of t.rijen) {
    const tr = element('tr');
    rij.forEach((w, i) => {
      const k = t.kolommen[i];
      const td = element('td', { class: t.soort === 'lijst' && i === 0 ? 'links' : '' });
      const nieuw = O.celTekst(w, k, procent, stap);
      if (k.prijs && typeof w === 'number' && veranderd) {
        td.append(element('span', { class: 'oud', textContent: O.celTekst(w, k, 0, 0.01) }), element('span', { class: 'nieuw', textContent: nieuw }));
      } else {
        td.textContent = nieuw;
      }
      tr.append(td);
    });
    tabel.append(tr);
  }
  return element('div', { class: 'voorbeeld' }, tabel);
}

function tekenTabellen() {
  const vak = $('#tabellen');
  vak.replaceChildren();
  if (!staat.tabellen.length) {
    vak.append(element('p', { class: 'leeg', textContent: 'Kies eerst een Excel-bestand met tarieven.' }));
    werkVolgordeBij();
    return;
  }
  const bladen = [...new Set(staat.tabellen.map((t) => t.blad))];
  for (const blad of bladen) {
    const groep = element('div', { class: 'blad' }, element('h3', { textContent: `Werkblad: ${blad}` }));
    for (const t of staat.tabellen.filter((x) => x.blad === blad)) groep.append(tabelBlok(t));
    vak.append(groep);
  }
  werkVolgordeBij();
}

function tabelBlok(t) {
  const inst = instelling(t);
  const blok = element('div', { class: `tabel${inst.aan ? ' aan' : ''}` });
  const prijzen = t.kolommen.filter((k) => k.prijs).length;
  const voorbeeldVak = element('div');
  const vernieuwVoorbeeld = () => {
    if (details.open) voorbeeldVak.replaceChildren(voorbeeldTabel(t));
  };
  blok.vernieuw = vernieuwVoorbeeld;

  const vink = element('input', {
    type: 'checkbox', checked: inst.aan,
    onchange: () => {
      inst.aan = vink.checked;
      blok.classList.toggle('aan', inst.aan);
      bewaarInstellingen();
      werkVolgordeBij();
    },
  });
  const eigenIndex = element('input', {
    value: inst.index, inputmode: 'decimal', placeholder: String(algemeenProcent()).replace('.', ','),
    title: 'Leeg laten om het algemene percentage te gebruiken',
    oninput: () => {
      inst.index = eigenIndex.value;
      eigenIndex.setCustomValidity(Number.isNaN(getal(inst.index)) ? 'Vul een getal in' : '');
      bewaarInstellingen();
      vernieuwVoorbeeld();
      werkVolgordeBij();
    },
  });
  eigenIndex.classList.add('eigen-index');

  const tekstveld = (label, sleutel) => element('label', {}, label, element('input', {
    value: inst[sleutel],
    oninput: (e) => { inst[sleutel] = e.target.value; bewaarInstellingen(); werkVolgordeBij(); },
  }));

  const details = element('details', {
    ontoggle: () => { if (details.open) vernieuwVoorbeeld(); },
  },
  element('summary', { textContent: 'Tekst en voorbeeld' }),
  element('div', { class: 'opties' },
    tekstveld('Kop boven de tabel', 'kop'),
    tekstveld('Regel onder de kop', 'boven'),
    tekstveld('Tekst onder de tabel', 'onder'),
    voorbeeldVak));

  blok.append(
    element('div', { class: 'tabel-kop' },
      element('label', { class: 'kies' }, vink, element('span', { textContent: t.titel })),
      element('span', { class: 'info', textContent: `${t.rijen.length} regels · ${prijzen} ${prijzen === 1 ? 'prijskolom' : 'prijskolommen'}` }),
      element('label', { class: 'procent' }, 'Indexatie', eigenIndex, '%')),
    details);
  return blok;
}

function werkVolgordeBij() {
  const lijst = $('#volgorde');
  lijst.replaceChildren();
  const gekozen = gekozenTabellen();
  if (!gekozen.length) lijst.append(element('li', { class: 'leeg', textContent: 'Nog geen tabellen aangevinkt.' }));
  gekozen.forEach((t, i) => {
    const verschuif = (richting) => {
      const ander = gekozen[i + richting];
      const a = staat.volgorde.indexOf(t.sleutel);
      const b = staat.volgorde.indexOf(ander.sleutel);
      [staat.volgorde[a], staat.volgorde[b]] = [staat.volgorde[b], staat.volgorde[a]];
      bewaarInstellingen();
      werkVolgordeBij();
    };
    const procent = procentVoor(t);
    lijst.append(element('li', {},
      instelling(t).kop || t.titel,
      element('span', { class: 'extra', textContent: `(${t.blad}${procent ? `, +${O.procentTekst(procent)}` : ''})` }),
      i > 0 ? element('button', { type: 'button', textContent: '↑', title: 'Hoger', onclick: () => verschuif(-1) }) : null,
      i < gekozen.length - 1 ? element('button', { type: 'button', textContent: '↓', title: 'Lager', onclick: () => verschuif(1) }) : null));
  });
  werkKnopBij();
}

function werkKnopBij() {
  $('#maak').disabled = !staat.sjabloon || !staat.tabellen.length;
}

// ---------- Offerte maken ----------

function waarde(id) { return $(`#v-${id}`).value.trim(); }

function velden() {
  const tav = waarde('tav');
  const geldigVan = $('#v-geldig_van').value;
  const geldigTm = $('#v-geldig_tm').value;
  const datum = $('#v-datum').value;
  return {
    adresblok: [waarde('bedrijf'), tav && `T.a.v. ${tav}`, waarde('adres'), waarde('postcode_plaats')].filter(Boolean).join('\n'),
    bedrijf: waarde('bedrijf'),
    tav,
    adres: waarde('adres'),
    postcode_plaats: waarde('postcode_plaats'),
    contactpersoon: waarde('contactpersoon') || tav || 'heer/mevrouw',
    onderwerp: waarde('onderwerp'),
    afzender: waarde('afzender'),
    datum: O.datumLang(datum),
    datum_kort: O.datumKort(datum),
    geldig_van: O.datumKort(geldigVan),
    geldig_tm: O.datumKort(geldigTm),
    geldig_van_lang: O.datumLang(geldigVan),
    geldig_tm_lang: O.datumLang(geldigTm),
    jaar: (geldigVan || datum || vandaag()).slice(0, 4),
    indexatie: O.procentTekst(algemeenProcent()),
  };
}

function melding(soort, tekst) {
  const el = $('#melding');
  el.className = soort;
  el.textContent = tekst;
  el.hidden = false;
}

function bestandsnaam() {
  const klant = (waarde('bedrijf') || 'klant').replace(/[\\/:*?"<>|]+/g, '').trim();
  return `Offerte ${klant} ${O.datumKort($('#v-datum').value || vandaag())}.docx`;
}

async function maakOfferte() {
  const ongeldig = [...document.querySelectorAll('.eigen-index, #index-algemeen')].find((el) => Number.isNaN(getal(el.value)));
  if (ongeldig) {
    melding('fout', `"${ongeldig.value}" is geen geldig percentage.`);
    ongeldig.focus();
    return;
  }
  const stap = afronding();
  const onderdelen = gekozenTabellen().map((t) => {
    const inst = instelling(t);
    return { kop: inst.kop, boven: inst.boven, onder: inst.onder, soort: t.soort, tabel: O.opgemaakteTabel(t, procentVoor(t), stap) };
  });
  const tarief = (omschrijving) => {
    const gevonden = O.zoekTarief(staat.tabellen, omschrijving);
    return gevonden ? O.celTekst(gevonden.waarde, gevonden.kolom, procentVoor(gevonden.tabel), stap) : null;
  };
  try {
    $('#maak').disabled = true;
    const uit = await O.maakOfferte(staat.sjabloon, { velden: velden(), onderdelen, tarief });
    const blob = new Blob([uit.bestand], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const link = element('a', { href: URL.createObjectURL(blob), download: bestandsnaam() });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    const waarschuwingen = [];
    if (!uit.tarievenGevonden) waarschuwingen.push('Het sjabloon heeft geen regel {{tarieven}}, dus de tabellen staan niet in de offerte.');
    if (uit.onbekend.length) waarschuwingen.push(`Niet ingevuld (onbekend veld of tarief niet gevonden): ${uit.onbekend.map((n) => `{{${n}}}`).join(', ')}.`);
    if (!onderdelen.length) waarschuwingen.push('Er zijn geen tarieftabellen aangevinkt.');
    if (waarschuwingen.length) melding('waarschuwing', `Offerte gemaakt, maar let op: ${waarschuwingen.join(' ')}`);
    else melding('goed', `Offerte gemaakt: ${bestandsnaam()} (staat in je map Downloads).`);
  } catch (e) {
    melding('fout', `De offerte kon niet worden gemaakt: ${e.message}`);
  } finally {
    werkKnopBij();
  }
}

// ---------- Starten ----------

function koppelVelden() {
  $('#v-datum').value = vandaag();
  $('#v-geldig_van').value = vandaag();
  $('#v-afzender').value = opslag.lees('afzender', '');
  $('#v-afzender').addEventListener('input', (e) => opslag.schrijf('afzender', e.target.value));
  const onderwerp = $('#v-onderwerp');
  const standaardOnderwerp = () => `Tarievenoverzicht ${($('#v-geldig_van').value || vandaag()).slice(0, 4)}`;
  onderwerp.value = standaardOnderwerp();
  onderwerp.addEventListener('input', () => { onderwerp.dataset.zelf = '1'; });
  $('#v-geldig_van').addEventListener('change', () => { if (!onderwerp.dataset.zelf) onderwerp.value = standaardOnderwerp(); });

  const algemeen = $('#index-algemeen');
  algemeen.value = opslag.lees('index', '');
  $('#afronding').value = opslag.lees('afronding', '0.01');
  const herteken = () => {
    for (const el of document.querySelectorAll('.eigen-index')) el.placeholder = String(algemeenProcent()).replace('.', ',');
    for (const blok of document.querySelectorAll('.tabel')) blok.vernieuw();
    werkVolgordeBij();
  };
  algemeen.addEventListener('input', () => {
    algemeen.setCustomValidity(Number.isNaN(getal(algemeen.value)) ? 'Vul een getal in' : '');
    opslag.schrijf('index', algemeen.value);
    herteken();
  });
  $('#afronding').addEventListener('change', (e) => { opslag.schrijf('afronding', e.target.value); herteken(); });
}

async function start() {
  koppelVelden();
  kiesBestand($('#excel-kies'), 'excel');
  kiesBestand($('#sjabloon-kies'), 'sjabloon');
  $('#maak').addEventListener('click', maakOfferte);
  const [excel, sjabloon] = await Promise.all([haalBestand('excel'), haalBestand('sjabloon')]);
  try {
    if (excel) await laadExcel(excel.naam, excel.buffer, { nieuw: false });
    if (sjabloon) await laadSjabloon(sjabloon.naam, sjabloon.buffer);
  } catch (e) {
    toonFout(e.message);
  }
}

start();
