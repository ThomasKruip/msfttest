const { test } = require('node:test');
const assert = require('node:assert');
const O = require('../offertetool/motor');

const tekst = (s) => new TextEncoder().encode(s);

// Een klein Excel-bestand zoals het tarievenbestand: per blok een titel, kolomkoppen en tarieven.
async function maakExcel() {
  const gedeeld = ['Tarievenoverzicht Nederland 2026', 'Europallets', 'Blokpallets', 't/m laadmeter', 't/m kilogram', 'Nederland',
    'Opslagen m.b.t. levering', 'Dienst', 'Toeslag', 'Kooiaap', 'per adres', 'Wachttijd', 'per kwartier', 'Waddeneilanden', 'op aanvraag', 'R&amp;D'];
  const c = (ref, w) => (typeof w === 'number' ? `<c r="${ref}"><v>${w}</v></c>` : `<c r="${ref}" t="s"><v>${gedeeld.indexOf(w)}</v></c>`);
  const rijen = [
    [6, [['B', 'Tarievenoverzicht Nederland 2026']]],
    [7, [['B', 'Europallets'], ['C', 'Blokpallets'], ['D', 't/m laadmeter'], ['E', 't/m kilogram'], ['F', 'Nederland']]],
    [8, [['B', 1], ['D', 0.4], ['E', 700], ['F', 62.37]]],
    [9, [['C', 1], ['D', 0.5], ['E', 875], ['F', 70.68]]],
    [10, [['B', 2], ['D', 0.8], ['E', 1400], ['F', 106.72]]],
    [12, [['B', 'Opslagen m.b.t. levering']]],
    [13, [['B', 'Dienst'], ['F', 'Toeslag']]],
    [14, [['B', 'Kooiaap'], ['E', 'per adres'], ['F', 77.5]]],
    [16, [['B', 'Wachttijd'], ['E', 'per kwartier'], ['F', 15]]],
    [17, [['B', 'Waddeneilanden'], ['E', 'per adres'], ['F', 'op aanvraag']]],
  ];
  const blad = `<worksheet><sheetData>${rijen.map(([r, cellen]) => `<row r="${r}">${cellen.map(([k, w]) => c(`${k}${r}`, w)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return O.schrijfZip([
    { naam: 'xl/workbook.xml', data: tekst('<workbook><sheets><sheet name="Tarieven 2026" sheetId="1" r:id="rId1"/><sheet name="Verborgen" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>') },
    { naam: 'xl/_rels/workbook.xml.rels', data: tekst('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>') },
    { naam: 'xl/sharedStrings.xml', data: tekst(`<sst>${gedeeld.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`) },
    { naam: 'xl/worksheets/sheet1.xml', data: tekst(blad) },
  ]);
}

// Een klein Word-sjabloon. Word knipt tekst vaak op in stukjes, zoals hier bij {{contactpersoon}}.
async function maakSjabloon() {
  const r = (t) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
  const body = [
    `<w:p>${r('{{adresblok}}')}</w:p>`,
    `<w:p>${r('Beste {{contact')}${r('persoon}}, &amp; welkom')}</w:p>`,
    `<w:p>${r('Geldig t/m {{geldig_tm}}. Wachttijd: {{tarief:Wachttijd}}, Kooiaap: {{tarief:Kooiaap}}')}</w:p>`,
    `<w:p><w:r><w:t>{{tarieven}}</w:t></w:r></w:p>`,
    `<w:p>${r('{{bestaat_niet}}')}</w:p>`,
  ].join('');
  return O.schrijfZip([
    { naam: '[Content_Types].xml', data: tekst('<Types/>') },
    { naam: 'word/document.xml', data: tekst(`<w:document><w:body>${body}<w:sectPr/></w:body></w:document>`) },
  ]);
}

async function documentTekst(docx) {
  const zip = await O.leesZip(docx);
  return zip.tekst('word/document.xml');
}

test('zip: wat erin gaat komt er ongewijzigd uit', async () => {
  const data = tekst('Hallo wereld, ëéè € '.repeat(50));
  const zip = await O.leesZip(await O.schrijfZip([{ naam: 'map/bestand.txt', data }]));
  assert.deepStrictEqual(await zip.lees('map/bestand.txt'), data);
  assert.strictEqual(zip.items[0].crc, O.crc32(data));
});

test('Excel: tabellen, kolommen en prijskolommen worden herkend', async () => {
  const tabellen = O.vindTabellen(await O.leesExcel(await maakExcel()));
  assert.deepStrictEqual(tabellen.map((t) => [t.titel, t.soort, t.rijen.length]), [
    ['Tarievenoverzicht Nederland 2026', 'staffel', 3],
    ['Opslagen m.b.t. levering', 'lijst', 3],
  ]);
  const [staffel, lijst] = tabellen;
  assert.deepStrictEqual(staffel.kolommen.map((k) => k.prijs), [false, false, false, false, true]);
  assert.deepStrictEqual(staffel.rijen[1], ['', 1, 0.5, 875, 70.68]);
  // De kolom "per adres" heeft geen kop maar hoort wel bij de lijst.
  assert.deepStrictEqual(lijst.kolommen.map((k) => [k.kolom, k.prijs]), [['B', false], ['E', false], ['F', true]]);
  assert.strictEqual(staffel.sleutel, 'tarieven |tarievenoverzicht nederland');
});

test('indexeren en afronden', () => {
  assert.strictEqual(O.indexeer(62.37, 3.5, 0.01), 64.55);
  assert.strictEqual(O.indexeer(62.37, 0, 0.01), 62.37);
  assert.strictEqual(O.indexeer(72.5, 3, 0.05), 74.7);
  assert.strictEqual(O.indexeer(72.5, 3, 1), 75);
  assert.strictEqual(O.indexeer(100, -2, 0.01), 98);
  assert.strictEqual(O.euro(1003.39), '€ 1.003,39');
  assert.strictEqual(O.procentTekst(3.5), '3,5%');
  assert.strictEqual(O.procentTekst(2), '2%');
});

test('opgemaakte staffel: hoeveelheden blijven, prijzen worden geïndexeerd', async () => {
  const [staffel, lijst] = O.vindTabellen(await O.leesExcel(await maakExcel()));
  const t = O.opgemaakteTabel(staffel, 10, 0.01);
  assert.deepStrictEqual(t.rijen[0], ['1', '', '0,40', '700', '€ 68,61']);
  assert.deepStrictEqual(t.rijen[2], ['2', '', '0,80', '1.400', '€ 117,39']);
  assert.deepStrictEqual(O.opgemaakteTabel(lijst, 10, 0.01).rijen[2], ['Waddeneilanden', 'per adres', 'op aanvraag']);
});

test('offerte: velden, losse tarieven en tabellen worden ingevuld', async () => {
  const tabellen = O.vindTabellen(await O.leesExcel(await maakExcel()));
  const tarief = (naam) => {
    const z = O.zoekTarief(tabellen, naam);
    return z ? O.celTekst(z.waarde, z.kolom, 10, 0.01) : null;
  };
  const uit = await O.maakOfferte(await maakSjabloon(), {
    velden: { adresblok: 'Klant & Co\nT.a.v. Jan', contactpersoon: 'Jan', geldig_tm: '30-06-2026' },
    onderdelen: [{ kop: 'Nederland', boven: 'Per adres', onder: '', soort: 'staffel', tabel: O.opgemaakteTabel(tabellen[0], 10, 0.01) }],
    tarief,
  });
  const xml = await documentTekst(uit.bestand);
  const platteTekst = xml.replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '');
  assert.match(platteTekst, /Klant &amp; Co\nT\.a\.v\. Jan/);
  assert.match(platteTekst, /Beste Jan, &amp; welkom/);
  assert.match(platteTekst, /Geldig t\/m 30-06-2026\. Wachttijd: € 16,50, Kooiaap: € 85,25/);
  assert.match(xml, /<w:tbl>/);
  assert.match(platteTekst, /€ 117,39/);
  assert.doesNotMatch(platteTekst, /\{\{tarieven\}\}/);
  // De opmaak van het stukje waar het veld begon blijft behouden.
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Beste Jan/);
  assert.deepStrictEqual(uit.onbekend, ['bestaat_niet']);
  assert.strictEqual(uit.tarievenGevonden, true);
});

test('datums', () => {
  assert.strictEqual(O.datumKort('2026-06-30'), '30-06-2026');
  assert.strictEqual(O.datumLang('2026-06-30'), '30 juni 2026');
  assert.strictEqual(O.einddatumUitNaam('Tarieven_tm_30-06-2026VWHEFFING.xlsx'), '2026-06-30');
  assert.strictEqual(O.einddatumUitNaam('tarieven t/m 1-1-2027.xlsx'), '2027-01-01');
  assert.strictEqual(O.einddatumUitNaam('tarieven.xlsx'), '');
});
