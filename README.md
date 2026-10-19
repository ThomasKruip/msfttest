# Gezinsagenda

Een gedeelde agenda voor het hele gezin, gemaakt om op de telefoon te gebruiken.

- **Iedereen zijn eigen invoer:** elk gezinslid kiest op zijn eigen telefoon één keer
  "Wie ben jij?". Nieuwe activiteiten komen dan automatisch op zijn of haar naam.
- **Voor wie:** kies per activiteit één of meer gezinsleden, of **Gezamenlijk** voor iets
  dat het hele gezin samen doet.
- **Spraakberichten:** neem een bericht op en zet het op een willekeurige datum
  (bijvoorbeeld een boodschappenlijstje of een herinnering).
- **Filter per persoon:** bovenaan tik je op een naam om alleen diens activiteiten
  (plus de gezamenlijke) te zien.
- Elk gezinslid heeft een eigen **kleur**; gezamenlijke activiteiten zijn oranje.
- Bij elk item staat **wie het heeft ingevoerd**.

Standaard zijn er vier gezinsleden (Papa, Mama, Kind 1, Kind 2). Namen en kleuren
pas je aan via de ronde knop rechtsboven → *Namen en kleuren aanpassen*.

## Installeren

De agenda draait op één computer thuis (pc, laptop of Raspberry Pi) die aan staat.
Alle telefoons in hetzelfde wifi-netwerk gebruiken die. Er zijn geen extra pakketten nodig.

1. Installeer [Node.js](https://nodejs.org) (versie 18 of nieuwer).
2. Maak eenmalig een certificaat, zodat telefoons de microfoon mogen gebruiken:

   ```bash
   npm run certificaat
   ```

3. Start de agenda:

   ```bash
   npm start
   ```

   Je ziet dan het adres voor de telefoons, bijvoorbeeld
   `Op de telefoon (zelfde wifi): https://192.168.1.20:3000`.

## Op de telefoon zetten

1. Open het adres in de browser van de telefoon (Chrome op Android, Safari op iPhone).
2. De eerste keer krijg je een waarschuwing over het certificaat, omdat je het zelf hebt
   gemaakt. Kies **Geavanceerd → Doorgaan** (Android) of **Toon details → bezoek deze website** (iPhone).
3. Kies wie je bent.
4. Zet de agenda op je beginscherm, zodat hij werkt als een gewone app:
   - **Android:** menu (⋮) → *Toevoegen aan startscherm*
   - **iPhone:** deelknop → *Zet op beginscherm*

Herhaal dit op de telefoon van elk gezinslid.

> Zonder certificaat (`http://`) werkt alles, behalve direct opnemen in de app.
> Je kunt dan wel een spraakmemo kiezen die je met de telefoon hebt opgenomen.

## Gebruik

- Tik op een dag om te zien wat er die dag gepland staat. Veeg over de kalender om van maand te wisselen.
- **+ Activiteit**: wat, voor wie, datum en tijd. Tik later op een activiteit om hem te bewerken of te verwijderen.
- **🎤 Spraakbericht**: kies voor wie, druk op de rode knop, spreek in, druk nogmaals om te stoppen,
  luister terug en tik op *Opslaan*.
- Tik rechtsboven op je eigen letter om van gezinslid te wisselen.
- De agenda ververst vanzelf, zodat je ziet wat de anderen hebben toegevoegd.

## Instellingen

| Variabele              | Standaard | Betekenis                                      |
|------------------------|-----------|------------------------------------------------|
| `PORT`                 | `3000`    | Poort waarop de agenda draait                  |
| `DATA_DIR`             | `./data`  | Map waar afspraken en opnames worden bewaard   |
| `TLS_CERT` / `TLS_KEY` | –         | Eigen certificaat en sleutel in plaats van die uit `data/cert` |

## Gegevens en back-up

- Activiteiten: `data/events.json`
- Gezinsleden: `data/family.json`
- Spraakberichten: `data/audio/`
- Certificaat: `data/cert/`

Maak voor een back-up gewoon een kopie van de map `data`.

## Tests

```bash
npm test
```
