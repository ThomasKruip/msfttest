# Gezinsagenda

Een gedeelde agenda voor het hele gezin. Je kunt:

- **Afspraken** toevoegen met titel, datum, begin- en eindtijd, voor wie het is en notities.
- **Gesproken berichten** opnemen en op een willekeurige datum in de agenda zetten
  (bijvoorbeeld een boodschappenlijstje of een herinnering voor later).
- Per gezinslid een **kleur** instellen, zodat je in één oogopslag ziet wie wat heeft.

Alles wordt op één computer (bijv. een thuis-pc, laptop of Raspberry Pi) bewaard,
zodat iedereen in huis dezelfde agenda ziet. Er zijn geen extra pakketten nodig.

## Starten

Vereist: [Node.js](https://nodejs.org) versie 18 of nieuwer.

```bash
npm start
```

Open daarna <http://localhost:3000> in de browser.

## Gebruik

- Klik op een dag in de kalender om te zien wat er die dag gepland staat.
- **+ Afspraak** voegt een agendapunt toe (dubbelklik op een dag werkt ook).
- **🎤 Spraakbericht** opent de recorder: kies de datum, druk op de rode knop,
  spreek je bericht in en druk nogmaals om te stoppen. Luister terug en klik op *Opslaan*.
  Je kunt ook een bestaand geluidsbestand kiezen (bijv. een spraakmemo van je telefoon).
- Via **Gezin** pas je de namen en kleuren van de gezinsleden aan.
- De agenda ververst elke 30 seconden, zodat je ziet wat anderen hebben toegevoegd.

## Gebruiken op telefoons in het thuisnetwerk

Andere apparaten openen de agenda via het IP-adres van de computer,
bijvoorbeeld `http://192.168.1.20:3000`.

Let op: browsers staan **microfoongebruik alleen toe via https** (of op `localhost`).
Via gewoon `http://` kun je op een telefoon dus wel afspraken zien en toevoegen, en
een spraakmemo als bestand kiezen, maar niet direct in de pagina opnemen.
Wil je overal direct kunnen opnemen, start de server dan met een certificaat:

```bash
# eenmalig een certificaat maken, bijvoorbeeld met mkcert (https://github.com/FiloSottile/mkcert)
mkcert 192.168.1.20 localhost

TLS_CERT=192.168.1.20+1.pem TLS_KEY=192.168.1.20+1-key.pem npm start
```

## Instellingen

| Variabele              | Standaard | Betekenis                                      |
|------------------------|-----------|------------------------------------------------|
| `PORT`                 | `3000`    | Poort waarop de agenda draait                  |
| `DATA_DIR`             | `./data`  | Map waar afspraken en opnames worden bewaard   |
| `TLS_CERT` / `TLS_KEY` | –         | Certificaat en sleutel om via https te draaien |

## Gegevens en back-up

- Afspraken: `data/events.json`
- Gezinsleden: `data/family.json`
- Spraakberichten: `data/audio/`

Maak voor een back-up gewoon een kopie van de map `data`.

## Tests

```bash
npm test
```
