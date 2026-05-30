# Djupanalys — Rapportering som excellent inkubator (Vinnova & Tillväxtverket)

> **Status:** Analys & designunderlag (ej implementerat ännu).
> **Författare:** Plattformsteamet, 2026-05-30.
> **Syfte:** Kartlägga exakt vad Movexum måste rapportera som *excellent
> inkubator*, hur de tre nuvarande Excel-flödena ser ut, vilka fält
> plattformen redan har, vad som saknas, och hur vi bygger en **dynamisk
> rapportmotor** som automatiserar underlaget så långt det går.
> Underlag: tre bifogade arbetsfiler (lägesrapportmall jan 2026,
> inrapporterad tid, kostnader bolag) + offentliga Vinnova/SISP/Tillväxtverket-källor.

---

## 0. TL;DR — slutsatserna först

1. **Det finns inte *en* rapport — det finns tre parallella rapporteringsspår**
   med olika mottagare, kadens och format:
   - **A. Lägesredovisning aktiebolag (statsstödsredovisning)** → Vinnova,
     per period. Strukturerad Excel, **en rad per bolag och stödgrund**.
     Detta är mallen i `…Lägesredovisning Aktiobolag.csv/.xlsx`.
   - **B. InkRapp (InkubatorRapport)** → Vinnova/SISP, **årlig**
     nyckeltalsrapportering (idéflöde, ekonomi, sysselsatta, kapital,
     jämställdhet/hållbarhet).
   - **C. Tillväxtverket / regional medfinansiering** → läges-/slutrapport
     **minst var sjätte månad** för projekt med ERUF/regionala medel.

2. **Plattformen kan idag bygga *narrativa* rapporter** (`/rapporter`,
   `incubator_reports` med fria sektioner + AI-utkast) men **kan inte
   producera den strukturerade radbaserade statsstödsredovisningen** som
   Vinnova-mallen kräver, eftersom underlagsdatan delvis saknas.

3. **De tre största datagapen** (utan dessa kan rapporten inte
   auto-genereras):
   - **Tidrapportering saknas helt.** "Periodens utfall för levererade
     inkubatortjänster" = *nedlagda timmar × timpris (641 kr)*. Det finns
     ingen kollektion för loggad tid eller timpris i systemet idag.
   - **Per-bolag kostnadsallokering saknas.** "Verifieringstjänster" =
     externa fakturor (advokat, PRV, UC, Rouse m.fl.) fördelade per bolag.
     Ingen modell för leverantörsfakturor/allokering finns.
   - **CRL/TMRL/BRL/SRL saknas.** Vinnova kräver **fyra separata**
     readiness-axlar (Customer/Team/Business/Sustainability RL, skala 1–9
     enligt KTH IRL). Systemet har bara ett generiskt `irl_level` (1–9).

4. **Mindre gap:** SNI-kod 2025 (NACE) på bolaget, statsstödsgrund som
   tidsserie (Art. 22 ↔ de minimis kan växla → ny rad), ackumulering över
   hela programperioden (1 juli 2025 – 30 juni 2029), affärsinriktning som
   Vinnova-enum.

5. **Rekommendation:** bygg en **definition-driven rapportmotor** där varje
   mottagares mall beskrivs som data (kolumner/sektioner + en *field
   resolver* per cell), inte som hårdkodad kod. Då blir mallarna dynamiska,
   versionerbara (EU AI Act art. 11 / ISO 27001 A.8.32) och kan exporteras
   till **exakt det Excel-format Vinnova vill ha** + PDF + den interna vyn.
   Bygg datagapen (tid, kostnadsallokering, 4× RL, SNI) först — annars blir
   "automatiseringen" manuell inmatning i ny kostym.

---

## 1. De faktiska rapporteringskraven

### 1.1 Vinnova — "Stöd till nystartade företag via excellenta inkubatorer 2025–2029"

- **Programperiod / kvalitetsstämpel:** 1 juli 2025 – 30 juni 2029
  (bekräftas av mallens kolumnrubrik *"Ackumulerat utfall under hela
  perioden 1 juli 2025 till sista juni 2029"*).
- **Statsstödsgrund:** stöd till enskilda bolag ges enligt **artikel 22 i
  GBER** (förordning 651/2014) *eller* **"stöd av mindre betydelse"
  (de minimis)**. Bolaget måste vara **aktiebolag** (mallens instruktion:
  *"endast företagsformen aktiebolag är godkänt"*).
- **e-AidRegister (nytt 2026):** fr.o.m. **1 januari 2026** ska beslutade
  de minimis-stöd rapporteras till EU-kommissionens register inom **20
  arbetsdagar**, med **företagsnamn, orgnr, stödbelopp och SNI-kod**. Detta
  kopplar direkt ihop med vår **de minimis-modul (§20 i CLAUDE.md)**.
- **Villkor inkubatorn själv intygar (ej per bolag, men relevant för
  rapporten):** ingen vinstutdelning senaste 4 år + kommande 4 år; de som
  levererar inkubatortjänster har ingen affärsmässig koppling till
  portföljbolagen; Vinnovas finansiering ≤ 1/3 av driftsbudgeten per år.

### 1.2 Vinnova/SISP — InkRapp (InkubatorRapport), årlig

Separat från statsstödsredovisningen. Inkubatorn rapporterar årligen:

- **Idéflöde** (idéer/affärscase in i tratten).
- **Ekonomi per portföljbolag:** omsättning, resultat, lönekostnad,
  finansieringshändelser (kapitalanskaffning).
- **Sysselsatta** i bolagen, samt i inkubatorn och dess styrelse.
- **Jämställdhet & hållbarhet** som drivkraft (könsfördelning, Agenda 2030).
- **Inkubatorns driftsbudget.**

> Mycket av detta finns redan latent i vår datamodell (`startup_financials`,
> `capital_rounds`, `startup_phase_history`, `founder_gender`,
> `sprint_x_json.sustain`) — InkRapp är därför ett *aggregeringsproblem*,
> inte ett datainsamlingsproblem, till skillnad från lägesredovisningen.

### 1.3 Tillväxtverket — regional/ERUF-medfinansiering

- Tillväxtverket driver **Förstärkt inkubatorkapacitet** (45 inkubatorer 2025)
  och förvaltar **8 regionala ERUF-program (2021–2027)**.
- För projekt med ERUF/regional medfinansiering: **läges-/slutrapport minst
  var sjätte månad** (första rapporten ≤ 6 mån), kopplad till
  utbetalningsansökan. Innehåll: aktiviteter, måluppfyllelse, **regional
  spridning, skapade jobb, hållbarhet** — vilket matchar de
  Tillväxtverket-sektioner som redan finns hårdkodade i
  `lib/actions/reports.ts` (`reg_spread`, `jobs`, `sustain`).

**Slutsats:** Vinnova-lägesredovisningen är den strukturellt tyngsta och
mest data-krävande. InkRapp och Tillväxtverket är till stor del
*aggregat/narrativ* ovanpå samma underliggande bolagsdata.

---

## 2. Dekonstruktion av de tre bifogade filerna

De tre filerna är Movexums **nuvarande manuella underlagskedja**. De visar
exakt hur "Periodens utfall" räknas fram idag.

### 2.1 `Lägesredovisning Aktiobolag` (Vinnova-mallen, vers. 1 jan 2026)

En rad per bolag. Kolumngrupper:

| Grupp | Kolumn | Innehåll i exempeldata |
|---|---|---|
| **Statsstöd** | Datum då bolaget börjar ta emot statsstöd | `2023-08-28` |
| **Företag** | Företagets namn | `Enava AB` |
| | Org nr | `559200-1969` |
| | Affärsinriktning (enum) | Agro / Industriell teknik / Life Science / Miljö & energi / Mjukvara/ICT / Upplevelseindustri / Övrigt |
| **Statsstödskontroll** | Statsstödsgrund (enum) | `Artikel 22` *eller* `Stöd av mindre betydelse` |
| | SNI-kod 2025 (NACE) | krävs vid de minimis, t.ex. `F.42.21` |
| **Ekonomi – periodens utfall** | Inkubatortjänster (SEK) | `24358` (= timmar × 641) |
| | Verifieringstjänster (SEK) | `88292.75` (externa fakturor) |
| | Summa periodens utfall | `112650.75` |
| **Ekonomi – ackumulerat** (hela perioden) | Inkubatortjänster / Verifieringstjänster / Summa | ackumulerat 2025-07 → 2029-06 |
| **Målgruppskriterier** | Datum senast kontrollerat | `2025-11-05` |
| **Readiness level** | **CRL** (Customer RL 1–9) | "CRL 7. Customers in extended product testing…" |
| | **TMRL** (Team RL 1–9) | "TMRL 5. Initial founding team…" |
| | **BRL** (Business RL 1–9) | "BRL 6. Full business model…" |
| | **SRL** (Sustainability RL 1–9) | "SRL4. Business concept with embedded…" |
| **Avslut** | Datum då bolaget avslutar Vinnova-finansiering | (fylls vid avslut) |

Stödflikar i arbetsboken: **Beroende rulllistor** (enum-värden för
affärsinriktning, stödgrund, SNI, CRL/TMRL/BRL/SRL-skalorna), **SNI-koder
med beskrivning** (~930 NACE-koder), **SRL 1.0** (detaljerad rubrik per
SRL-nivå). Dessa är värdelistor vi kan seed:a som referensdata.

### 2.2 `Inrapporterad tid`

- Per bolag: **antal nedlagda timmar** × **timpris 641 kr** = belopp.
  Ex: `Enava AB 38 h × 641 = 24 358`.
- En "TOT"-rad (765,5 h). Noteringar som *"Intag i ink januari"* och *"Tid
  rapporterad på 11 excellenta bolag"*.
- **Detta är källan till kolumnen "inkubatortjänster (SEK)".** Idag förs
  timmarna i en separat Excel — **systemet fångar dem inte.**

### 2.3 `Kostnader bolag`

- Per bolag: `Internt lev tjänster` (= från tidrapporten), `Externa
  tjänster`, `Tot`.
- Höger del: **rå leverantörsreskontra** — fakturor från Rouse AB, PRV,
  Barzey Advokatbyrå, Lindahl, UC m.fl. med belopp och **vilka bolag de
  fördelas på** (t.ex. *"Happy, Konstraktor, Protime"*, *"Fördelas"*,
  *"Lokalhyra fördelas"*).
- **Detta är källan till kolumnen "verifieringstjänster (SEK)"** —
  externa verifierings-/expertkostnader (IP-juridik, patentverk,
  kreditupplysning) fördelade per bolag. Idag helt manuellt i Excel.

**Datakedjan idag:**

```
Tidrapport (h × 641)  ─┐
                       ├─►  Kostnader-bolag (allokering per bolag)  ─►  Lägesredovisning (Vinnova-Excel)
Leverantörsfakturor   ─┘                                                 + CRL/TMRL/BRL/SRL (manuell bedömning)
                                                                         + statsstödsgrund + SNI
```

Allt mellan parenteserna sker idag i kalkylark och klistras in manuellt.

---

## 3. Mappning: rapportkolumn → systemfält

| Rapportkolumn (Vinnova lägesred.) | Systemfält idag | Status |
|---|---|---|
| Företagets namn | `startups.name` | ✅ Finns |
| Org nr | `startups.org_nr` | ✅ Finns |
| Datum börjar ta emot statsstöd | `signed_vinnova_incubation_approval_at` / `intagsdatum` | ⚠️ Approximerbart, inget dedikerat fält |
| Datum avslutar Vinnova-finansiering | `avslutsdatum` | ⚠️ Återanvändbart (men = inkubator-avslut, inte exakt Vinnova-finansieringsslut) |
| Affärsinriktning (Vinnova-enum) | `industri` (fritext) / `sector` | ⚠️ Finns som fritext, ej Vinnova-enum |
| Statsstödsgrund (Art.22 / de minimis) | `approved_state_aid_art22`, `approved_de_minimis` (bool) | ⚠️ Bool, ej tidsserie/"en rad per grund" |
| SNI-kod 2025 | — | ❌ **Saknas på `startups`** |
| Datum senast kontroll målgruppskriterier | `meets_excellence_criteria` (bool) | ⚠️ Bool utan datum |
| **Inkubatortjänster (SEK), period** | — | ❌ **Saknas (ingen tidrapport × timpris)** |
| **Verifieringstjänster (SEK), period** | — | ❌ **Saknas (ingen kostnadsallokering)** |
| Summa periodens utfall | — | ❌ Härleds ur ovan |
| Ackumulerat utfall (3 kolumner) | — | ❌ Kräver tidsserie över hela perioden |
| **CRL** | `irl_level` (delvis) | ❌ Bara *ett* generiskt IRL, ej 4 axlar |
| **TMRL / BRL / SRL** | `sprint_x_json` (löst relaterat) | ❌ Saknas som RL-skalor |

**Underlag som redan finns och är direkt återanvändbart:**
`startups` (namn, org_nr, status, phase, bolagsform, kommun, is_deeptech,
is_regional, founder_gender), `startup_financials` (omsättning, anställda,
lönekostnad — för InkRapp), `capital_rounds` (kapitalanskaffning — InkRapp),
`startup_phase_history` (antagning/faser, idéflöde — InkRapp),
`de_minimis_stod`/`de_minimis_units` (stödbelopp + SNI för e-AidRegister),
`incubator_reports` + `/rapporter` (narrativ rapportskal med AI-utkast).

---

## 4. Gap-analys — vad måste byggas

### Gap 1 (kritiskt): Tidrapportering + timpris
Ny kollektion **`service_time_entries`** (förslag):
`tenant`, `startup` (relation, cascadeDelete), `user` (vem som la tid),
`hours` (number), `hourly_rate_sek` (number, default från tenant-inställning,
i datat = 641), `activity_kind` (`incubation`/`verification`/`admin`),
`occurred_on` (date), `note` (text). Värde = `hours × hourly_rate_sek`.
- Timpriset bör ligga i en **tenant-inställning** (`tenants.default_hourly_rate_sek`)
  så det är dynamiskt år för år.
- Koppling till befintliga `tasks`/`incubator_events`: en task/möte kan ha
  `logged_hours` så tid loggas *där arbetet sker* och rullar upp automatiskt.

### Gap 2 (kritiskt): Externa verifierings-/tjänstekostnader per bolag
Ny kollektion **`startup_service_costs`** (förslag):
`tenant`, `startup`, `cost_type` (`verification`/`external_service`/`other`),
`supplier` (text — Rouse, PRV, Barzey…), `invoice_ref`, `amount_sek`,
`incurred_on` (date), `allocation_note`, `source` (`manual`/`import_excel`).
- Stöd för **fördelning** av en faktura på flera bolag (en rad per
  bolag-andel, eller en `allocation_pct`). Datat visar "Fördelas",
  "Lokalhyra fördelas" → behov av en pott + fördelningsnyckel.
- Idempotent import från `Kostnader bolag`-Excel (återanvänd
  `lib/import/xlsx.ts` + mönstret från §15.6 CRM-import).

### Gap 3 (kritiskt): Fyra readiness-axlar (CRL/TMRL/BRL/SRL)
Två alternativ:
- **(a) Fält på `startups`:** `crl`, `tmrl`, `brl`, `srl` (number 1–9) +
  `*_assessed_at`. Enkelt, men ingen historik.
- **(b, rekommenderas) Ny kollektion `startup_readiness_assessments`:**
  `tenant`, `startup`, `assessed_at`, `crl`, `tmrl`, `brl`, `srl`,
  `criteria_checked_at` (= målgruppskontroll-datum), `assessed_by`, `note`.
  Ger tidsserie → vi kan visa progression *och* plocka senaste värdet till
  rapporten. Seed:a rubriktexterna (1–9 per axel) som referensdata från
  flikarna "Beroende rulllistor" + "SRL 1.0".
- `irl_level` behålls som sammanfattande tal (bakåtkompatibelt); de fyra
  axlarna blir det Vinnova-kompatibla underlaget.

### Gap 4 (medel): SNI-kod + Vinnova-affärsinriktning + statsstöd-tidsserie
- `startups.sni_code` (text) + `startups.sni_description` (denormaliserad);
  seed referenskollektion **`sni_codes`** (~930 rader från flik "SNI-koder").
- `startups.vinnova_focus` (select med Vinnovas 7 affärsinriktningar) —
  kan härledas från `industri` men bör vara egen normaliserad enum.
- Statsstödsgrund "en rad per grund" hanteras bäst av en liten kollektion
  **`startup_state_aid_periods`**: `startup`, `basis` (`art22`/`de_minimis`),
  `valid_from`, `valid_to`, `sni_code`. Då kan ett bolag som växlar grund få
  två rader i rapporten (precis som mallens instruktion kräver).

### Gap 5 (litet): Dedikerade Vinnova-datum
`startups.state_aid_start_at` (börjar ta emot statsstöd) och
`vinnova_funding_end_at` (avslutar Vinnova-finansiering) — separata från
`intagsdatum`/`avslutsdatum` som beskriver inkubatorrelationen.

---

## 5. Lösningsförslag — dynamisk rapportmotor

### 5.1 Princip: mallar som data, inte kod

Idag är sektionerna hårdkodade i `defaultSections()`. Inför istället en
**rapportmalls-definition** (versionerad), t.ex. kollektion
**`report_templates`**:

```jsonc
{
  "slug": "vinnova_lagesredovisning_ab",
  "version": 3,
  "recipient": "vinnova",
  "format": "table",            // "table" | "narrative" | "mixed"
  "period_kind": "accumulating", // ackumulerar mot 2025-07–2029-06
  "row_source": "active_state_aid_startups",
  "columns": [
    { "key": "name",            "label": "Företagets namn", "resolver": "startup.name" },
    { "key": "org_nr",          "label": "Org nr",          "resolver": "startup.org_nr" },
    { "key": "aid_basis",       "label": "Statsstödsgrund", "resolver": "stateAid.basis" },
    { "key": "sni",             "label": "SNI-kod 2025",    "resolver": "stateAid.sni_code" },
    { "key": "inkub_period",    "label": "Inkubatortjänster (period)", "resolver": "time.sumValue(period, 'incubation')" },
    { "key": "verif_period",    "label": "Verifieringstjänster (period)", "resolver": "cost.sum(period, 'verification')" },
    { "key": "crl",             "label": "CRL", "resolver": "readiness.latest.crl" },
    { "key": "tmrl",            "label": "TMRL", "resolver": "readiness.latest.tmrl" }
    // …osv
  ]
}
```

- **`row_source`** och **`resolver`** pekar på en **field-resolver-modul**
  (ny `apps/web/src/lib/reporting/resolvers.ts`) som vet hur varje token
  hämtas tenant-säkert ur PocketBase. En cell = ett rent funktionsanrop med
  `(startup, period, ctx)`.
- Nya mallar/kolumner = **ny rad i data + ev. ny resolver-token**, inte
  refaktor av UI. Det uppfyller "detta ska vara dynamiskt".
- **Versionering:** spegla §16.6-mönstret (`tool_versions`) →
  `report_template_versions` (oföränderliga snapshots) för EU AI Act art. 11
  / ISO 27001 A.8.32.

### 5.2 Renderare (återanvänd §17.3 dokumentlager)

Dokumentmotorn i `apps/web/src/lib/documents/` (pptx/xlsx/docx/pdf via
`exceljs`, `docx`, `pdf-lib`) finns redan och är EU-suverän. Vi lägger till:

- **`render-vinnova-xlsx.ts`** — bygger en arbetsbok som **matchar Vinnovas
  kolumnordning och rubriker exakt** (samma headerrader, samma
  rullgardins-/enumvärden), så Movexum kan ladda upp den rakt av. Inkl.
  flikarna "SNI-koder" och "Beroende rulllistor" om Vinnova kräver dem.
- **`render-report-pdf.ts`** — brandad PDF för intern granskning/arkiv.
- Narrativa sektioner (InkRapp-text, Tillväxtverket-analys) genereras som
  idag via AI-utkast men nu **grundade i resolver-aggregaten** (siffrorna
  kommer från `query`-lagret → inga hallucinerade tal, §17.3-principen).

### 5.3 Datavalidering före export (SOC 2 Processing Integrity)

En **pre-flight-kontroll** som flaggar per bolag: saknad SNI vid de minimis,
saknad RL-bedömning, 0 loggade timmar men aktivt bolag, statsstödsgrund som
saknas, ej kontrollerade målgruppskriterier > X mån. Rapporten kan inte
sättas till `sent` förrän kritiska fält är gröna (människa-i-loopen, §10).

---

## 6. Automatisering — koppling till övriga verksamheten

| Källa i OS:et | Matar rapporten | Automatiseringsgrad |
|---|---|---|
| **Tid loggad på `tasks`/`incubator_events`** | inkubatortjänster (SEK) | Hög — rullar upp om vi lägger `logged_hours` där arbetet sker |
| **`startup_service_costs`** (import + manuell) | verifieringstjänster (SEK) | Medel — kräver fakturaimport eller bokföringsintegration |
| **`startup_readiness_assessments`** | CRL/TMRL/BRL/SRL | Medel — coach bedömer; kan påminnas via `tool_schedules`/triggers |
| **`startup_financials`** (allabolag-provider §11.3) | InkRapp: omsättning/anställda/lönekostnad | Hög — redan idempotent sync |
| **`capital_rounds`** | InkRapp: kapitalanskaffning | Hög |
| **`startup_phase_history`** | InkRapp: idéflöde/antagna, Vinnova "antagna under perioden" | Hög |
| **`de_minimis_stod` (§20)** | stödbelopp + SNI → e-AidRegister-underlag | Hög — datat finns redan |
| **`founder_gender` + `sprint_x_json.sustain`** | InkRapp: jämställdhet/hållbarhet | Hög (aggregat, aldrig per individ i AI) |

**Konkreta automationskrokar:**
1. **Schemalagd rapport-prep (§12):** en `ai_system_wide`-agent kör t.ex.
   kvartalsvis, aggregerar perioden, fyller resolver-cellerna och skapar ett
   `incubator_reports`-utkast + flaggar saknad data. Människa granskar.
2. **Event-trigger (§16.8):** nytt bolag (`startup_created`) → skapa
   tom RL-bedömning + statsstödsperiod-rad som "att fylla i".
3. **Påminnelser:** `tasks` (kind `admin`) skapas automatiskt inför
   rapportdeadline för bolag med ofullständigt underlag.
4. **e-AidRegister-export:** de minimis-modulen genererar redan försäkran;
   lägg till en export (namn/orgnr/belopp/SNI) som matchar
   e-AidRegister-fälten — direkt avbockning av 20-dagarskravet.

---

## 7. Faseringsplan

**Fas 1 — Underlagsdata (utan detta funkar inget av resten).**
- Migrationer: `service_time_entries`, `startup_service_costs`,
  `startup_readiness_assessments`, `startups.sni_code`/`vinnova_focus`/
  Vinnova-datum, `startup_state_aid_periods`, referens-`sni_codes`,
  `tenants.default_hourly_rate_sek`.
- `logged_hours` på `tasks`/`incubator_events` + upprullning.
- Importörer (återanvänd `xlsx.ts`) för tidrapport + kostnader-bolag, så
  historiken (de tre filerna) kan läsas in idempotent.

**Fas 2 — Rapportmotor.**
- `report_templates` + `report_template_versions`, resolver-lager,
  pre-flight-validering, seed:a Vinnova-mallen + Tillväxtverket-mallen +
  InkRapp-mallen.

**Fas 3 — Renderare & UI.**
- `render-vinnova-xlsx.ts` (exakt format) + brandad PDF.
- Utöka `/rapporter`: tabellbaserad förhandsvy per rad, datakvalitets-
  flaggor, "Exportera till Vinnova-Excel"-knapp, filer landar i `/filer`.

**Fas 4 — Automation.**
- Schemalagd prep-agent, event-triggers, deadlinepåminnelser,
  e-AidRegister-export.

**Fas 5 — InkRapp & Tillväxtverket-aggregat.**
- Årligt InkRapp-aggregat (idéflöde/ekonomi/jämställdhet) + halvårs-
  läges­rapport för ERUF med regional spridning/jobb/hållbarhet.

---

## 8. Regelefterlevnad för de nya fälten (jfr CLAUDE.md §9–§10)

- **Tidrapport/kostnader:** affärsdata, ej PII. `service_time_entries.user`
  är intern användare → aggregeras i rapporten, exponeras aldrig per individ
  i AI-kontext. Lägg till i denylist/whitelist enligt §9.3/§10.5 p.10.
- **CRL/TMRL/BRL/SRL:** bolagsbedömning, ej individ → riskklass *minimal/
  begränsad*. Får whitelistas till AI-kontext (de är redan halvpublik
  mognadsdata, jfr `irl_level`).
- **SNI/statsstöd/e-AidRegister:** org-nr för AB är ej PII (skäl 14); för
  enskild firma motsvarar org-nr personnr → men programmet kräver AB, så
  detta är okomplicerat. De minimis-modulens befintliga denylist (§20.4)
  gäller fortsatt.
- **Jämställdhet (InkRapp):** `founder_gender` är art. 9 — får **bara**
  ingå som **aggregerad** könsfördelning i rapporten, aldrig per namngiven
  grundare, och aldrig i AI-prompt (befintlig svartlista §9.3 gäller).
- **Versionering + audit:** rapportmallar och körningar versioneras
  (art. 11 / A.8.32); export loggas i `activities`/`ai_usage_events`.
- **Renderare:** ren server-side JS (exceljs/pdf-lib), EU-suveränt, inga
  nya icke-EU-beroenden (§10.2).

---

## 9. Öppna frågor (kräver beslut/uppgift från Movexum)

1. **Timpris:** är 641 kr fast för hela perioden eller ändras det per år?
   (Avgör om det ska vara tenant-inställning med giltighetsdatum.)
2. **Verifieringstjänster:** vill ni importera leverantörsfakturor manuellt
   (Excel som idag) eller koppla bokföringen (t.ex. Fortnox/Visma — EU)?
3. **Rapportperiodicitet mot Vinnova:** kvartal, halvår eller årsvis
   lägesredovisning? (Styr `period`-modellen.)
4. **CRL/TMRL/BRL/SRL:** vem sätter dem och hur ofta — coach per möte, eller
   en formell kvartalsbedömning?
5. **Exakt Vinnova-filformat:** ska exporten matcha *deras* arbetsbok
   cell-för-cell (inkl. flikar/rullgardiner), eller räcker en ren datatabell
   som ni klistrar in? (Påverkar renderar-komplexiteten.)
6. **InkRapp/Tillväxtverket:** ska plattformen producera underlag som ni för
   in i InkRapp manuellt, eller finns API/importformat hos SISP/Vinnova?

---

## 10. Källor

- [Stöd till nystartade företag via excellenta inkubatorer 2025–2028, Vinnova](https://www.vinnova.se/e/inkubationsstod/stod-till-nystartade-foretag-via-2023-03309/)
- [Inkubationsstöd, Vinnova](https://www.vinnova.se/e/inkubationsstod/)
- [Verifieringsmedel till företag i inkubatorer, Vinnova](https://www.vinnova.se/p/verifieringsmedel-till-foretag-i-inkubatorer/)
- [Utveckling av InkRapp, Vinnova](https://www.vinnova.se/p/utveckling-av-inkrapp---battre-datadrivna-insikter-och-beslutsunderlag-for-regioner-och-inkubatorer/)
- [SISP Rapportering (InkRapp)](https://inkrapp.sisp.se/)
- [Sveriges inkubatorer och startups…, SISP](https://www.sisp.se/start/sveriges-inkubatorer-och-startups-betydande-f%C3%B6r-landets-utveckling-och-tillv%C3%A4xt)
- [Följ upp och rapportera, Tillväxtverket](https://tillvaxtverket.se/tillvaxtverket/sokfinansiering/handbocker/handbokfornationellaprojektmedel/planera/2kravpaprojektet/foljuppochrapportera.2261.html)
- Interna bilagor: lägesrapportmall (jan 2026), `Inrapporterad tid`, `Kostnader bolag`.
