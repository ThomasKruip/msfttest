// Rekenmotor van de offertetool: leest het tarievenbestand (Excel), rekent indexaties
// uit en vult het Word-sjabloon. Werkt zonder extra bibliotheken, zowel in de browser
// als in Node (voor de tests).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Offerte = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- ZIP (xlsx en docx zijn zip-bestanden) ----------

  const CRC_TABEL = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABEL[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function stroom(bytes, transform) {
    const s = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  const tekstUit = (bytes) => new TextDecoder('utf-8').decode(bytes);
  const tekstIn = (tekst) => new TextEncoder().encode(tekst);

  async function leesZip(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eind = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eind = i; break; }
    }
    if (eind < 0) throw new Error('Dit is geen geldig Excel- of Word-bestand (.xlsx/.docx).');
    const aantal = dv.getUint16(eind + 10, true);
    let p = dv.getUint32(eind + 16, true);
    const items = [];
    for (let i = 0; i < aantal; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Het bestand is beschadigd.');
      const methode = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const gepakt = dv.getUint32(p + 20, true);
      const grootte = dv.getUint32(p + 24, true);
      const naamLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const lokaal = dv.getUint32(p + 42, true);
      const naam = tekstUit(bytes.subarray(p + 46, p + 46 + naamLen));
      const start = lokaal + 30 + dv.getUint16(lokaal + 26, true) + dv.getUint16(lokaal + 28, true);
      items.push({ naam, methode, crc, grootte, gepakt: bytes.subarray(start, start + gepakt) });
      p += 46 + naamLen + extraLen + commentLen;
    }
    const opNaam = new Map(items.map((it) => [it.naam, it]));
    return {
      items,
      heeft: (naam) => opNaam.has(naam),
      async lees(naam) {
        const it = opNaam.get(naam);
        if (!it) throw new Error(`Onderdeel ${naam} ontbreekt in het bestand.`);
        if (it.methode === 0) return it.gepakt;
        if (it.methode === 8) return stroom(it.gepakt, new DecompressionStream('deflate-raw'));
        throw new Error(`Onbekende compressie in ${naam}.`);
      },
      async tekst(naam) { return tekstUit(await this.lees(naam)); },
    };
  }

  // Schrijft een zip. Onderdelen met `data` worden opnieuw ingepakt, onderdelen zonder
  // (uit leesZip) worden ongewijzigd overgenomen.
  async function schrijfZip(onderdelen) {
    const delen = [];
    const centraal = [];
    let positie = 0;
    for (const o of onderdelen) {
      let { methode, crc, grootte, gepakt } = o;
      if (o.data) {
        crc = crc32(o.data);
        grootte = o.data.length;
        gepakt = await stroom(o.data, new CompressionStream('deflate-raw'));
        methode = 8;
      }
      const naam = tekstIn(o.naam);
      const kop = new Uint8Array(30 + naam.length);
      const k = new DataView(kop.buffer);
      k.setUint32(0, 0x04034b50, true);
      k.setUint16(4, 20, true);
      k.setUint16(6, 0x0800, true); // namen in UTF-8
      k.setUint16(8, methode, true);
      k.setUint16(12, 0x21, true); // datum 1-1-1980
      k.setUint32(14, crc, true);
      k.setUint32(18, gepakt.length, true);
      k.setUint32(22, grootte, true);
      k.setUint16(26, naam.length, true);
      kop.set(naam, 30);
      const c = new Uint8Array(46 + naam.length);
      const cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, methode, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, gepakt.length, true);
      cv.setUint32(24, grootte, true);
      cv.setUint16(28, naam.length, true);
      cv.setUint32(42, positie, true);
      c.set(naam, 46);
      delen.push(kop, gepakt);
      centraal.push(c);
      positie += kop.length + gepakt.length;
    }
    const cdGrootte = centraal.reduce((s, c) => s + c.length, 0);
    const slot = new Uint8Array(22);
    const sv = new DataView(slot.buffer);
    sv.setUint32(0, 0x06054b50, true);
    sv.setUint16(8, onderdelen.length, true);
    sv.setUint16(10, onderdelen.length, true);
    sv.setUint32(12, cdGrootte, true);
    sv.setUint32(16, positie, true);
    const uit = new Uint8Array(positie + cdGrootte + 22);
    let p = 0;
    for (const d of [...delen, ...centraal, slot]) { uit.set(d, p); p += d.length; }
    return uit;
  }

  // ---------- XML-hulpjes ----------

  function ontsnap(tekst) {
    return String(tekst).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function leesEntiteiten(tekst) {
    return tekst.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }

  function attribuut(tag, naam) {
    const m = new RegExp(`\\s${naam}="([^"]*)"`).exec(tag);
    return m ? leesEntiteiten(m[1]) : null;
  }

  // ---------- Excel ----------

  function kolomNummer(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  function kolomLetters(n) {
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }

  // Tekst uit <si> of <is>, zonder de fonetische hulptekst (<rPh>).
  function tekstVan(xml) {
    const zonderFonetisch = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let s = '';
    for (const m of zonderFonetisch.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += leesEntiteiten(m[1]);
    return s;
  }

  // Leest alle zichtbare werkbladen als { naam, rijen: Map(rijnummer -> Map(kolomnummer -> waarde)) }.
  async function leesExcel(buffer) {
    const zip = await leesZip(buffer);
    if (!zip.heeft('xl/workbook.xml')) throw new Error('Dit is geen Excel-bestand (.xlsx).');
    const werkboek = await zip.tekst('xl/workbook.xml');
    const relaties = await zip.tekst('xl/_rels/workbook.xml.rels');
    const doelen = new Map();
    for (const m of relaties.matchAll(/<Relationship\b[^>]*>/g)) doelen.set(attribuut(m[0], 'Id'), attribuut(m[0], 'Target'));
    const gedeeld = [];
    if (zip.heeft('xl/sharedStrings.xml')) {
      for (const m of (await zip.tekst('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) gedeeld.push(m[1] ? tekstVan(m[1]) : '');
    }
    const bladen = [];
    for (const m of werkboek.matchAll(/<sheet\b[^>]*>/g)) {
      if (attribuut(m[0], 'state') === 'hidden' || attribuut(m[0], 'state') === 'veryHidden') continue;
      let doel = doelen.get(attribuut(m[0], 'r:id'));
      if (!doel) continue;
      doel = doel.startsWith('/') ? doel.slice(1) : `xl/${doel}`;
      const xml = await zip.tekst(doel);
      const rijen = new Map();
      for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /^([A-Z]+)(\d+)$/.exec(attribuut(c[0], 'r') || '');
        if (!ref || !c[2]) continue;
        const type = attribuut(`<c${c[1]}>`, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
        let waarde;
        if (type === 's') waarde = v ? gedeeld[Number(v[1])] : '';
        else if (type === 'inlineStr') waarde = tekstVan(c[2]);
        else if (type === 'str' || type === 'e') waarde = v ? leesEntiteiten(v[1]) : '';
        else if (type === 'b') waarde = v ? v[1] === '1' : '';
        else waarde = v ? Number(v[1]) : '';
        if (typeof waarde === 'string') waarde = waarde.trim();
        if (waarde === '' || waarde === undefined || Number.isNaN(waarde)) continue;
        const rij = Number(ref[2]);
        if (!rijen.has(rij)) rijen.set(rij, new Map());
        rijen.get(rij).set(kolomNummer(ref[1]), waarde);
      }
      bladen.push({ naam: attribuut(m[0], 'name'), rijen });
    }
    return bladen;
  }

  const HOEVEELHEID = /pallet|laadmeter|kilo|gewicht|\bkg\b/i;

  // Een tabel in Excel is: een regel met alleen een titel, daaronder een regel met
  // kolomkoppen en daaronder de tarieven, tot de volgende titel of het einde van het blad.
  function vindTabellen(bladen) {
    const tabellen = [];
    for (const blad of bladen) {
      const nummers = [...blad.rijen.keys()].sort((a, b) => a - b);
      const isTitel = (i) => {
        const rij = blad.rijen.get(nummers[i]);
        const volgende = blad.rijen.get(nummers[i] + 1);
        if (!rij || rij.size !== 1 || typeof [...rij.values()][0] !== 'string' || !volgende) return false;
        return [...volgende.values()].filter((w) => typeof w === 'string').length >= 2;
      };
      for (let i = 0; i < nummers.length; i++) {
        if (!isTitel(i)) continue;
        const titelRij = nummers[i];
        const koppen = blad.rijen.get(titelRij + 1);
        const eersteKolom = Math.min(...koppen.keys());
        const data = [];
        let j = i + 2;
        while (j < nummers.length && !isTitel(j)) { data.push(blad.rijen.get(nummers[j])); j++; }
        const kolomSet = new Set(koppen.keys());
        for (const r of data) for (const k of r.keys()) if (k >= eersteKolom) kolomSet.add(k);
        const kolommen = [...kolomSet].sort((a, b) => a - b);
        const isStaffel = [...koppen.values()].some((k) => HOEVEELHEID.test(String(k)));
        const kolomInfo = kolommen.map((k, idx) => {
          const kop = koppen.has(k) ? String(koppen.get(k)) : '';
          const numeriek = data.some((r) => typeof r.get(k) === 'number');
          const prijs = numeriek && (isStaffel ? !HOEVEELHEID.test(kop) : idx === kolommen.length - 1);
          return { kolom: kolomLetters(k), kop, prijs, soort: prijs ? 'prijs' : /laadmeter/i.test(kop) ? 'laadmeter' : 'getal' };
        });
        const rijen = data
          .map((r) => kolommen.map((k) => (r.has(k) ? r.get(k) : '')))
          .filter((r) => r.some((w) => w !== ''));
        if (!rijen.length) continue;
        const titel = String([...blad.rijen.get(titelRij).values()][0]);
        tabellen.push({
          id: `${blad.naam}!${titelRij}`,
          // Sleutel zonder jaartallen, zodat instellingen ook bij het tarievenbestand van volgend jaar blijven gelden.
          sleutel: `${blad.naam}|${titel}`.replace(/\b(19|20)\d\d\b/g, '').replace(/\s+/g, ' ').trim().toLowerCase(),
          blad: blad.naam,
          titel,
          soort: isStaffel ? 'staffel' : 'lijst',
          kolommen: kolomInfo,
          rijen,
        });
        i = j - 1;
      }
    }
    return tabellen;
  }

  // ---------- Rekenen en opmaken ----------

  // Past de indexatie toe en rondt af op `stap` euro (0.01 = op centen).
  function indexeer(bedrag, procent, stap) {
    const factor = 1 + (Number(procent) || 0) / 100;
    const s = Number(stap) > 0 ? Number(stap) : 0.01;
    const ruw = Math.round(bedrag * factor * 1e6) / 1e6;
    return Number((Math.round(ruw / s + 1e-9) * s).toFixed(2));
  }

  function getal(waarde, decimalen) {
    const negatief = waarde < 0;
    const [heel, deel] = Math.abs(waarde).toFixed(decimalen).split('.');
    const metPunten = heel.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (negatief ? '-' : '') + metPunten + (deel ? `,${deel}` : '');
  }

  const euro = (waarde) => `€ ${getal(waarde, 2)}`;

  function procentTekst(procent) {
    return `${getal(Number(procent) || 0, 2).replace(/,00$/, '').replace(/(,\d)0$/, '$1')}%`;
  }

  function celTekst(waarde, kolom, procent, stap) {
    if (waarde === '' || waarde === null || waarde === undefined) return '';
    if (typeof waarde !== 'number') return String(waarde);
    if (kolom.prijs) return euro(indexeer(waarde, procent, stap));
    if (kolom.soort === 'laadmeter') return getal(waarde, 2);
    const afgerond = Math.round(waarde * 100) / 100;
    return getal(afgerond, Number.isInteger(afgerond) ? 0 : 2);
  }

  // De tabel zoals die in de offerte komt: alle cellen als tekst, prijzen geïndexeerd.
  function opgemaakteTabel(tabel, procent, stap) {
    return {
      koppen: tabel.kolommen.map((k) => k.kop),
      uitlijning: tabel.kolommen.map((k, i) => (tabel.soort === 'lijst' && i === 0 ? 'left' : 'center')),
      rijen: tabel.rijen.map((r) => r.map((w, i) => celTekst(w, tabel.kolommen[i], procent, stap))),
    };
  }

  const normaal = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Zoekt een los tarief op (voor {{tarief:...}} in het sjabloon) op het begin van de omschrijving.
  function zoekTarief(tabellen, omschrijving) {
    const gezocht = normaal(omschrijving);
    if (!gezocht) return null;
    for (const t of tabellen) {
      if (t.soort !== 'lijst') continue;
      const prijsKolom = t.kolommen.findIndex((k) => k.prijs);
      if (prijsKolom < 0) continue;
      const rij = t.rijen.find((r) => normaal(r[0]).startsWith(gezocht));
      if (rij) return { tabel: t, waarde: rij[prijsKolom], kolom: t.kolommen[prijsKolom] };
    }
    return null;
  }

  // ---------- Word ----------

  const LETTER = '<w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi" w:cstheme="majorHAnsi"/>';
  const TABELBREEDTE = 8960; // twips; past binnen de marges van het sjabloon
  const RAND = '<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tcBorders>';

  function tekstRuns(tekst, rPr) {
    return String(tekst).split('\n').map((regel, i) =>
      `<w:r><w:rPr>${rPr}</w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${ontsnap(regel)}</w:t></w:r>`).join('');
  }

  function alinea(tekst, { vet = false, grootte = 22, uitlijning = 'center', paginaEinde = false, ruimteNa = 0 } = {}) {
    const rPr = `${LETTER}${vet ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${grootte}"/><w:szCs w:val="${grootte}"/>`;
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${ruimteNa}"/><w:jc w:val="${uitlijning}"/><w:rPr>${rPr}</w:rPr></w:pPr>`
      + `${paginaEinde ? '<w:r><w:br w:type="page"/></w:r>' : ''}${tekst ? tekstRuns(tekst, rPr) : ''}</w:p>`;
  }

  function kolomBreedtes(aantal, soort) {
    if (soort === 'lijst' && aantal >= 2) {
      const rest = Math.round(TABELBREEDTE * 0.3);
      const eerste = TABELBREEDTE - rest;
      return [eerste, ...Array(aantal - 1).fill(Math.round(rest / (aantal - 1)))];
    }
    return Array(aantal).fill(Math.round(TABELBREEDTE / aantal));
  }

  function cel(tekst, breedte, uitlijning, kop) {
    const rPr = `${LETTER}${kop ? '<w:b/><w:bCs/>' : ''}<w:color w:val="000000"/><w:sz w:val="16"/><w:szCs w:val="16"/>`;
    return `<w:tc><w:tcPr><w:tcW w:w="${breedte}" w:type="dxa"/>${RAND}`
      + `<w:shd w:val="clear" w:color="auto" w:fill="${kop ? 'D0CECE' : 'auto'}"/><w:vAlign w:val="center"/></w:tcPr>`
      + `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${uitlijning}"/><w:rPr>${rPr}</w:rPr></w:pPr>`
      + `${tekst ? tekstRuns(tekst, rPr) : ''}</w:p></w:tc>`;
  }

  function tabelXml(onderdeel) {
    const { koppen, rijen, uitlijning } = onderdeel.tabel;
    const breedtes = kolomBreedtes(koppen.length, onderdeel.soort);
    const rij = (cellen, kop) => `<w:tr><w:trPr><w:cantSplit/>${kop ? '<w:tblHeader/>' : ''}<w:trHeight w:val="113"/></w:trPr>`
      + cellen.map((t, i) => cel(t, breedtes[i], kop ? 'center' : uitlijning[i], kop)).join('') + '</w:tr>';
    return `<w:tbl><w:tblPr><w:tblW w:w="${TABELBREEDTE}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>`
      + '<w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>'
      + `<w:tblGrid>${breedtes.map((b) => `<w:gridCol w:w="${b}"/>`).join('')}</w:tblGrid>`
      + (koppen.some(Boolean) ? rij(koppen, true) : '')
      + rijen.map((r) => rij(r, false)).join('') + '</w:tbl>';
  }

  // Alle gekozen tarieftabellen achter elkaar. Een grote staffel komt op een eigen pagina.
  function tarievenXml(onderdelen) {
    let xml = '';
    onderdelen.forEach((o, i) => {
      const groot = o.tabel.rijen.length > 15;
      const vorigeGroot = i > 0 && onderdelen[i - 1].tabel.rijen.length > 15;
      const nieuwePagina = i > 0 && (groot || vorigeGroot);
      if (i > 0 && !nieuwePagina) xml += alinea('');
      xml += alinea(o.kop || '', { vet: true, grootte: 28, paginaEinde: nieuwePagina, ruimteNa: o.boven ? 0 : 120 });
      if (o.boven) xml += alinea(o.boven, { ruimteNa: 120 });
      xml += tabelXml(o);
      if (o.onder) xml += alinea(o.onder, { uitlijning: 'left' });
    });
    return xml || alinea('');
  }

  const TEKSTNODE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

  // Vervangt {{velden}} in één alinea, ook als Word het veld over meerdere stukjes tekst heeft verdeeld.
  function vulAlinea(xml, vervang) {
    const nodes = [...xml.matchAll(TEKSTNODE)].map((m) => ({ start: m.index, eind: m.index + m[0].length, tekst: leesEntiteiten(m[1]) }));
    const geheel = nodes.map((n) => n.tekst).join('');
    if (!geheel.includes('{{')) return xml;
    const velden = [...geheel.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
    if (!velden.length) return xml;
    // Begin- en eindpositie van elke tekstnode binnen de samengevoegde tekst.
    let pos = 0;
    for (const n of nodes) { n.van = pos; pos += n.tekst.length; n.tot = pos; }
    const nieuw = nodes.map((n) => ({ tekst: n.tekst, regels: null }));
    for (const veld of velden.reverse()) {
      const begin = veld.index;
      const eind = begin + veld[0].length;
      const waarde = vervang(veld[1]);
      if (waarde === null) continue;
      const i = nodes.findIndex((n) => begin >= n.van && begin < n.tot);
      const j = nodes.findIndex((n) => eind > n.van && eind <= n.tot);
      const voor = nieuw[i].tekst.slice(0, begin - nodes[i].van);
      const na = nieuw[j].tekst.slice(eind - nodes[j].van);
      for (let k = i + 1; k <= j; k++) nieuw[k].tekst = '';
      nieuw[i].tekst = voor + waarde + (i === j ? nieuw[i].tekst.slice(eind - nodes[i].van) : na);
      if (i !== j) nieuw[j].tekst = '';
    }
    let uit = '';
    let vanaf = 0;
    nodes.forEach((n, k) => {
      const inhoud = nieuw[k].tekst.split('\n').map(ontsnap).join('</w:t><w:br/><w:t xml:space="preserve">');
      uit += xml.slice(vanaf, n.start) + `<w:t xml:space="preserve">${inhoud}</w:t>`;
      vanaf = n.eind;
    });
    return uit + xml.slice(vanaf);
  }

  const ALINEA = /<w:p\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/w:p>)/g;

  function vulXml(xml, velden, tarievenBlok, onbekend) {
    return xml.replace(ALINEA, (p) => {
      const tekst = [...p.matchAll(TEKSTNODE)].map((m) => leesEntiteiten(m[1])).join('');
      if (!tekst.includes('{{')) return p;
      if (/^\s*\{\{\s*tarieven\s*\}\}\s*$/.test(tekst)) return tarievenBlok === null ? p : tarievenBlok;
      return vulAlinea(p, (naam) => {
        const waarde = velden(naam);
        if (waarde === null || waarde === undefined) { onbekend.add(naam); return null; }
        return String(waarde);
      });
    });
  }

  // Vult het sjabloon en geeft { bestand: Uint8Array (docx), onbekend: [namen van onbekende velden] }.
  async function maakOfferte(sjabloon, { velden = {}, onderdelen = [], tarief = () => null }) {
    const zip = await leesZip(sjabloon);
    if (!zip.heeft('word/document.xml')) throw new Error('Het sjabloon is geen Word-bestand (.docx).');
    const onbekend = new Set();
    const zoek = (naam) => {
      const m = /^tarief\s*:\s*(.+)$/i.exec(naam);
      if (m) return tarief(m[1].trim());
      const sleutel = naam.toLowerCase();
      return Object.prototype.hasOwnProperty.call(velden, sleutel) ? velden[sleutel] : null;
    };
    const blok = tarievenXml(onderdelen);
    let tarievenGevonden = false;
    const onderdelenZip = [];
    for (const it of zip.items) {
      if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(it.naam)) {
        const xml = await zip.tekst(it.naam);
        if (/\{\{\s*tarieven\s*\}\}/.test(xml.replace(/<[^>]+>/g, ''))) tarievenGevonden = true;
        const gevuld = vulXml(xml, zoek, it.naam === 'word/document.xml' ? blok : null, onbekend);
        onderdelenZip.push({ naam: it.naam, data: tekstIn(gevuld) });
      } else {
        onderdelenZip.push(it);
      }
    }
    return { bestand: await schrijfZip(onderdelenZip), onbekend: [...onbekend], tarievenGevonden };
  }

  // ---------- Datums ----------

  const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  function datumKort(iso) {
    const [j, m, d] = String(iso || '').split('-');
    return j && m && d ? `${d}-${m}-${j}` : '';
  }

  function datumLang(iso) {
    const [j, m, d] = String(iso || '').split('-').map(Number);
    return j && m && d ? `${d} ${MAANDEN[m - 1]} ${j}` : '';
  }

  // Haalt de einddatum uit een bestandsnaam als "Tarieven_tm_30-06-2026.xlsx".
  function einddatumUitNaam(naam) {
    const m = /t[\W_]?m[\W_]*(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/i.exec(naam || '');
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  }

  return {
    leesZip, schrijfZip, crc32,
    leesExcel, vindTabellen,
    indexeer, euro, getal, procentTekst, opgemaakteTabel, zoekTarief, celTekst,
    maakOfferte, vulAlinea,
    datumKort, datumLang, einddatumUitNaam, MAANDEN,
  };
});
