# Gezinsagenda

Een gedeelde agenda voor het hele gezin, gemaakt om op de telefoon te gebruiken.

- **Ieder zijn eigen invoer:** elk gezinslid logt op zijn eigen telefoon in met een
  eigen **pincode**. Nieuwe activiteiten komen automatisch op zijn of haar naam.
- **Alleen je eigen items aanpassen:** wat een ander heeft ingevoerd kun je zien en
  beluisteren, maar niet bewerken of verwijderen.
- **Voor wie:** kies per activiteit één of meer gezinsleden, of **Gezamenlijk** voor iets
  dat het hele gezin samen doet.
- **Herhalen:** elke dag, elke week (op gekozen dagen, bijv. ma en do), om de week,
  elke maand of elk jaar, eventueel tot en met een einddatum.
- **Spraakberichten:** neem een bericht op en zet het op een willekeurige datum.
- **Filter per persoon** bovenaan, en een eigen **kleur** per gezinslid (gezamenlijk = oranje).
- **Twee beheerders:** standaard zijn Papa en Mama beheerder (zie hieronder).

## Inloggen en pincodes

- De eerste keer kiest iedereen zijn naam en **bedenkt zelf een pincode** (4 tot 8 cijfers).
  Laat iedereen dat meteen doen: zolang iemand nog geen pincode heeft, kan een ander die kiezen.
- Daarna heb je je pincode nodig om op een telefoon in te loggen of naar een ander
  gezinslid te wisselen. De telefoon blijft een jaar lang ingelogd.
- Na 5 verkeerde pogingen wordt inloggen voor dat gezinslid even geblokkeerd
  (en steeds langer bij nog meer foute pogingen).
- Je eigen pincode wijzig je via de ronde knop rechtsboven → *Mijn pincode wijzigen*.

## Beheerders

Standaard zijn **Papa en Mama** beheerder. Alleen beheerders kunnen, via de ronde knop
rechtsboven → *Gezinsleden beheren*:

- gezinsleden toevoegen, verwijderen of een andere naam/kleur geven;
- kiezen wie beheerder is;
- de **pincode wissen** van iemand die hem vergeten is. Die kiest bij de volgende keer
  inloggen een nieuwe.

Is een beheerder zijn eigen pincode vergeten, dan kan de andere beheerder die wissen.
Zijn beide beheerders hem kwijt, stop dan de agenda en voer op de computer met de agenda uit:

```bash
npm run pincode-wissen -- Papa
```

## Herhalende activiteiten

Kies bij een activiteit onder **Herhalen** hoe vaak. Bij *Elke week* en *Om de week* tik je
de dagen aan. Tik op een herhalende activiteit om de hele reeks te bewerken. Bij
**Verwijderen** kies je *Alleen deze keer* (bijv. een training die een keer niet doorgaat)
of *De hele reeks*.

## Snel starten op Windows

1. Installeer [Node.js](https://nodejs.org) (de versie met **LTS** erbij).
2. Download deze map: groene knop **Code** → **Download ZIP**, en pak het ZIP-bestand uit.
3. Dubbelklik op:
   - **`Agenda starten.bat`** om de agenda thuis via wifi te gebruiken. De eerste keer wordt
     automatisch een certificaat gemaakt (daarvoor is [Git for Windows](https://git-scm.com)
     nodig; zonder werkt alles behalve opnemen op de telefoon).
   - **`Agenda online starten.bat`** om de agenda ook buitenshuis te gebruiken, via
     Tailscale (zie "Manier 1" hieronder).

De agenda opent vanzelf in de browser. Laat het zwarte venster open; sluit het om de agenda te stoppen.

> Geeft Windows de melding "Windows heeft deze pc beschermd"? Klik op **Meer informatie** →
> **Toch uitvoeren**. Dat komt doordat het bestand van internet komt.

## Installeren met de opdrachtregel (Windows, macOS, Linux)

1. Installeer [Node.js](https://nodejs.org) (versie 18 of nieuwer).
2. Download deze map en open er een opdrachtvenster in.
3. Kies hoe je de agenda wilt gebruiken:
   - **Alleen thuis (wifi):** maak eenmalig een certificaat met `npm run certificaat`
     en start de agenda met `npm start`. Het adres voor de telefoons staat in het venster,
     bijvoorbeeld `https://192.168.1.20:3000`. De eerste keer geeft de telefoon een
     waarschuwing; kies *Geavanceerd → Doorgaan*.
   - **Ook buitenshuis:** zie hieronder.

## Ook buitenshuis gebruiken

Er zijn twee manieren. In beide gevallen krijg je een vast `https://`-adres met een echt
certificaat (geen waarschuwing), en werken opnemen en "op beginscherm zetten" overal.

### Manier 1: thuis laten draaien + Tailscale Funnel (gratis, aanrader)

De agenda en alle opnames blijven op je eigen computer; Tailscale maakt hem veilig
bereikbaar via internet. Nadeel: de computer moet aan staan.

1. Maak een gratis account op <https://tailscale.com> en installeer Tailscale op de computer met de agenda.
2. Op Windows: dubbelklik op **`Agenda online starten.bat`**; die doet stap 3 en 4 voor je.
   Anders: start de agenda in online-stand met `npm run online`.
3. Zet in een tweede opdrachtvenster de agenda open naar internet:

   ```bash
   tailscale funnel --bg 3000
   ```

   De eerste keer vraagt Tailscale je om Funnel aan te zetten; volg de link die verschijnt.
4. Tailscale toont je adres, iets als `https://mijn-pc.tail1234.ts.net`. Open dat op de
   telefoons en zet het op het beginscherm.

### Manier 2: echt online bij Fly.io (computer thuis hoeft niet aan)

Fly.io draait de agenda in een datacenter in Amsterdam, met een blijvende schijf voor je
gegevens. Hiervoor heb je een account met betaalgegevens nodig; voor zo'n kleine app zijn
de kosten laag (enkele euro's per maand of minder), maar controleer de actuele prijzen op
<https://fly.io/docs/about/pricing/>.

1. Installeer het programma `flyctl`: <https://fly.io/docs/flyctl/install/> en log in met `fly auth login`.
2. Kies in `fly.toml` bij `app = "..."` een eigen, unieke naam, bijvoorbeeld `agenda-familie-jansen`.
3. Voer in deze map uit:

   ```bash
   fly apps create agenda-familie-jansen
   fly volumes create agenda_data --size 1 --region ams
   fly deploy
   ```

4. De agenda staat nu op `https://agenda-familie-jansen.fly.dev`.

Een nieuwe versie zet je online met `fly deploy`; de gegevens op de schijf blijven bewaard.
Een vergeten pincode van beide beheerders wis je daar met
`fly ssh console -C "node scripts/pincode-wissen.js Papa"` en daarna `fly apps restart`.

> Gratis diensten zonder blijvende schijf (zoals het gratis plan van Render) zijn niet
> geschikt: daar verdwijnen afspraken en opnames na een herstart.

## Op de telefoon zetten

1. Open het adres in de browser (Chrome op Android, Safari op iPhone).
2. Kies je naam en vul je pincode in (of bedenk er een).
3. Zet de agenda op het beginscherm:
   - **Android:** menu (⋮) → *Toevoegen aan startscherm*
   - **iPhone:** deelknop → *Zet op beginscherm*

## Instellingen

| Variabele              | Standaard | Betekenis                                      |
|------------------------|-----------|------------------------------------------------|
| `PORT`                 | `3000`    | Poort waarop de agenda draait                  |
| `DATA_DIR`             | `./data`  | Map waar alle gegevens worden bewaard          |
| `TLS_CERT` / `TLS_KEY` | –         | Eigen certificaat in plaats van dat uit `data/cert` |
| `NO_TLS`               | –         | Zet op `1` als een host of tunnel https regelt (zelfde als `npm run online`) |

## Gegevens en back-up

Alles staat in de map `data`:

- `events.json`: activiteiten
- `family.json`: gezinsleden (pincodes alleen versleuteld)
- `sessions.json`: ingelogde telefoons
- `audio/`: spraakberichten
- `cert/`: certificaat voor thuisgebruik

Maak voor een back-up een kopie van de map `data`. Bij Fly.io: `fly ssh sftp get /data/events.json`.

## Tests

```bash
npm test
```

---

# Offertetool

Een hulpmiddel om snel een offerte met tarieven op te stellen in de eigen Word-huisstijl.
De tarieven komen uit het Excel-bestand; je vinkt aan welke staffels in de offerte komen en
vult desgewenst een indexatiepercentage in. De tool maakt er een Word-document (.docx) van.

## Openen

Dubbelklik op **`Offertetool openen.bat`** (of open `offertetool/index.html` in Edge of Chrome).
Er hoeft niets geïnstalleerd te worden en er gaat niets over internet: alles gebeurt in de browser.

## Werken met de tool

1. **Bestanden:** kies het tarievenbestand (Excel) en het offertesjabloon (Word). De browser
   onthoudt ze; kies alleen een nieuw bestand als de tarieven of de standaardtekst veranderen.
   Staat in de bestandsnaam van het Excel-bestand een einddatum (zoals `Tarieven_tm_30-06-2026.xlsx`),
   dan wordt die als *Geldig t/m* ingevuld.
2. **Klant en geldigheid:** naam, adres, aanhef, datum en geldigheid.
3. **Tarieven kiezen:** alle tabellen uit het Excel-bestand staan onder elkaar, per werkblad.
   - Vink aan wat in de offerte moet.
   - **Indexatie voor alle tarieven:** bijvoorbeeld `3,5` voor 3,5% erbij (een min-teken mag ook).
   - Een **eigen percentage** bij een tabel gaat voor het algemene percentage.
   - **Afronden op** hele centen, 5 of 10 cent of hele euro's.
   - Onder *Tekst en voorbeeld* pas je de kop en de regels boven/onder de tabel aan en zie je de
     tarieven vóór en ná indexatie. Deze teksten en keuzes worden onthouden.
4. **Offerte maken:** zet met ↑ ↓ de tabellen in de goede volgorde en klik op *Offerte maken*.
   Het Word-bestand komt in de map Downloads.

## Het Excel-bestand

De tool herkent zelf alle tabellen. Een tabel is:

- een regel met alleen een **titel** (bijv. *Tarievenoverzicht Nederland 2026 …*),
- direct daaronder een regel met **kolomkoppen**,
- daaronder de tarieven, tot de volgende titel of het einde van het werkblad.

Tabellen met kolommen als *Europallets*, *Blokpallets*, *t/m laadmeter* of *t/m kilogram* zijn
**staffels**: alle andere kolommen (zoals *Nederland* of *Postcodes 4-7-8*) zijn prijzen en worden
geïndexeerd. Bij een **lijst** (zoals uurtarieven of toeslagen) is de laatste kolom de prijs.
Tekst zoals *op aanvraag* blijft gewoon staan. Verborgen werkbladen worden overgeslagen.

## Het Word-sjabloon

Het sjabloon is de standaardbrief met invulvelden tussen dubbele accolades, bijvoorbeeld
`Beste {{contactpersoon}},`. Pas de tekst gewoon aan in Word; laat de velden staan.

| Veld | Wordt |
|------|-------|
| `{{tarieven}}` | Op een eigen regel: alle aangevinkte tabellen, elk met kop. Grote staffels beginnen op een nieuwe pagina. |
| `{{adresblok}}` | Bedrijf, t.a.v., adres, postcode en plaats onder elkaar |
| `{{bedrijf}}` `{{tav}}` `{{adres}}` `{{postcode_plaats}}` | Losse adresgegevens |
| `{{contactpersoon}}` | Naam na "Beste" (leeg: de t.a.v.-naam) |
| `{{onderwerp}}` `{{afzender}}` | Onderwerpregel en ondertekening |
| `{{datum}}` / `{{datum_kort}}` | 20 oktober 2026 / 20-10-2026 |
| `{{geldig_van}}` `{{geldig_tm}}` | 01-01-2026; met `_lang` erachter: 1 januari 2026 |
| `{{jaar}}` | Jaartal van *geldig van* |
| `{{indexatie}}` | Het algemene percentage, bijv. 3,5% |
| `{{tarief:Kooiaap}}` | Eén tarief uit een lijst in Excel, gezocht op het begin van de omschrijving, mét de indexatie van die lijst |

Velden die de tool niet kent blijven staan; je krijgt dan een melding na het maken van de offerte.

> Deze repository is openbaar. Excel- en Word-bestanden worden daarom door `.gitignore`
> buiten git gehouden: bewaar het tarievenbestand en het sjabloon op je eigen computer of netwerkschijf.
