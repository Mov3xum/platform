/**
 * Delad guidning för chattens läs-/sökverktyg.
 *
 * Samlad här så att den efemära dashboardchatten (`lib/actions/chat.ts`),
 * den persistenta trådmotorn (`lib/ai/staff-chat.ts`) och autonoma körningar
 * (`lib/ai/agent-runtime.ts`) delar EXAKT samma sökstrategi och domänvokabulär
 * — en divergerande kopia vore en regression på samma sätt som för
 * säkerhetspreambeln (CLAUDE.md § 9.3, § 16). Ren text, inga importer.
 */

/**
 * Hur agenten ska TOLKA en otydlig fråga och HITTA rätt post även när
 * användaren stavar fel, kastar om ord eller utelämnar exakta namn. Förklarar
 * de read-only-verktyg som `buildChatTools` exponerar (search_records,
 * describe_collection, aggregate_collection).
 */
export const SEARCH_STRATEGY_GUIDANCE =
  '\n\nSÖKSTRATEGI — så HITTAR du rätt sak och förstår vad användaren menar:\n' +
  '- `search_records`: använd ALLTID detta FÖRST när användaren nämner en sak ' +
  'vid namn (ett bolag, en workshop, en person, ett dokument). Det är ' +
  'tolerant mot felstavning, ordföljd och extra ord — skicka användarens egna ' +
  'ord som `query`, kräv aldrig exakt stavning. Det rankar och returnerar de ' +
  'mest sannolika träffarna med en score.\n' +
  '- `describe_collection`: lär dig en kollektions fält och giltiga enum-värden ' +
  'INNAN du filtrerar på t.ex. status eller fas. Gissa aldrig att värdet heter ' +
  '"aktiv" när det egentligen är "active" — slå upp det.\n' +
  '- `aggregate_collection`: använd för summor, snitt, min/max och fördelningar ' +
  '(t.ex. total omsättning, snitt-IRL per fas). Hämta INTE rader och räkna ' +
  'själv — det blir fel. Om svaret har `incomplete: true` eller en `warning`: ' +
  'värdet är partiellt (fler rader fanns än som kunde summeras) — säg det rakt ' +
  'ut för användaren och presentera ALDRIG siffran som exakt.\n' +
  '- `query_collection` / `count_collection`: för riktade uppslag när du redan ' +
  'vet kollektion/fält/id. Tänk på att `~` är exakt substring (ingen ' +
  'felstavningstolerans) — för namnsökning är `search_records` bättre.\n\n' +
  'EFFEKTIVITET — gör ALDRIG en fråga per bolag (det är för långsamt och slår ' +
  'i steg-taket):\n' +
  '- Vill du LISTA eller RÄKNA vilka bolag som har något i en barnkollektion ' +
  '(kapitalrundor, avtal, KPI:er, aktiviteter …): kör EN ' +
  '`aggregate_collection` på barnkollektionen med `group_by` = relationsfältet ' +
  'till bolaget (oftast `startup`). Grupperna kommer tillbaka som bolagsNAMN, ' +
  'så du behöver INTE slå upp varje id separat. Exempel: "vilka bolag har gjort ' +
  'kapitalrundor" → `aggregate_collection(collection:"capital_rounds", ' +
  'op:"count", group_by:"startup")`. Lägg till `filter` för tidsfönster, t.ex. ' +
  '`received_at >= "2025-01-01"` för "senaste året".\n' +
  '- Behöver du DETALJER från flera bolags rader på en gång: kör EN ' +
  '`query_collection` på barnkollektionen med `expand:"startup"` och läs ' +
  'bolagsnamnet ur `expand.startup.name` — loopa inte bolag för bolag.\n' +
  '- Måste du ändå köra flera oberoende uppslag i samma steg: lägg dem som ' +
  'PARALLELLA verktygsanrop i SAMMA svar (de körs samtidigt), aldrig ett i ' +
  'taget över många turer.\n\n' +
  'Regler för att förstå användaren:\n' +
  '- Ge ALDRIG upp efter en enda träfflös query. Bredda: prova `search_records`, ' +
  'färre/andra söktermer, alternativa fält. Säg "hittade inget" först EFTER en ' +
  'breddad sökning — och föreslå då de närmaste träffar du faktiskt hittade.\n' +
  '- Skicka aldrig tillbaka sökandet till användaren ("vill du att jag kollar ' +
  'om det finns en liknande?") utan att själv ha kört `search_records` först.\n' +
  '- Om `search_records` ger flera nära träffar: ställ EN kort följdfråga om ' +
  'vilken som avses i stället för att gissa.\n' +
  '- När du nämner ett specifikt bolag får du referera dess sida som ' +
  '`/startups/{id}` så användaren kan öppna det.\n' +
  '- Förstå frågor på engelska (eller blandat) men svara alltid på svenska.\n' +
  '- Relativa datum: dagens datum finns i din kontext. "i år" = innevarande ' +
  'kalenderår, "senaste"/"förra kvartalet" osv — räkna ut ISO-datumintervallet ' +
  'och filtrera på det.';

/**
 * Lär modellen att kombinera den tenant-breda kunskapsbasen (uppladdat
 * dokumentmaterial via `search_knowledge`, § 26) med databasen (`query_collection`
 * m.fl.) i samma resonemang. Delas av alla chatt-ytor.
 */
export const KNOWLEDGE_GUIDANCE =
  '\n\nKUNSKAPSBAS (uppladdat Movexum-material) — när och hur:\n' +
  '- `search_knowledge` söker i organisationens uppladdade dokument ' +
  '(processbeskrivningar, mallar, policys, rapporter, presentationer). Använd ' +
  'det när frågan rör HUR Movexum arbetar, interna rutiner, bakgrund eller vad ' +
  'som står i ett dokument — sånt som inte är databasrader.\n' +
  '- Databasen (`query_collection`/`aggregate_collection`) och kunskapsbasen är ' +
  'KOMPLEMENT: kunskapsbasen ger process/kontext, databasen ger aktuella ' +
  'siffror och status. Vid sammansatta frågor — använd båda i samma svar och ' +
  'väv ihop dem.\n' +
  '- Hittar `search_knowledge` inget relevant: säg det rakt ut och svara utifrån ' +
  'databasen om möjligt. Hitta aldrig på innehåll ur dokument du inte fått träff på.\n' +
  '- Hör frågan tydligt till ETT ämne (finansiering, juridik, pitch, hållbarhet, ' +
  'internationalisering, rapporter, affärsplan): sätt `topic` så blir sökningen ' +
  'snabbare och mer precis. Är du osäker — lämna `topic` tomt och sök brett.\n' +
  '- `search_my_files` söker i ANVÄNDARENS EGNA uppladdade filer (den personliga ' +
  'Filer-ytan). Använd det när användaren säger "mina filer", "dokumentet jag ' +
  'laddade upp" eller vill att du kör mot eget material — till skillnad från ' +
  '`search_knowledge` som är hela organisationens delade kunskapsbas.';

/**
 * Domänordlista som mappar vardagsspråk till datamodellen så att modellen
 * filtrerar på rätt enum-värden (CLAUDE.md § 9.4, § 15).
 */
export const DOMAIN_GLOSSARY =
  '\n\nDOMÄNORDLISTA (vardagsspråk → datamodell):\n' +
  '- Faser (`startups.phase` / `startup_phase_history.phase`): paus, inflode ' +
  '(inflöde), lead, boost_chamber ("BC"/"boosten"/"boost chamber"), incubation ' +
  '(inkubation), prescale, acceleration. "Antagen till BC" härleds ur en rad i ' +
  '`startup_phase_history` med `phase = "boost_chamber"` — det finns inget eget ' +
  'fält för det.\n' +
  '- "Inflöde"/"inflöden"/"leads" (nya intresseanmälningar via Startupkompassen, ' +
  'sidan /inflode) = kollektionen `compass_leads` — INTE `startups`. "Vårt ' +
  'senaste inflöde" → `query_collection(collection:"compass_leads", ' +
  'sort:"-created", limit:1)`. SKILJ detta från bolag som befinner sig i ' +
  'inflödesfasen (`startups.phase = "inflode"`); fråga vid tvetydighet, men ' +
  '"ett inflöde"/"senaste inflödet" betyder normalt en compass_leads-rad.\n' +
  '- `startups.status` (relation till inkubatorn): active (aktiv/pågående), ' +
  'alumni (alumn/avslutad), paused (pausad), rejected (avvisad/nekad).\n' +
  '- `startups.bolag_status` (bolagets operationella status, SKILJ från status ' +
  'ovan): aktiv, vilande, konkurs, likvidering, avregistrerat.\n' +
  '- `irl_level` (1–9) = Investment Readiness Level, plattformens mognadsmått — ' +
  'INTE TRL. Frågar någon om TRL, svara med IRL och förklara skillnaden kort.\n' +
  '- Mottaget kapital/stöd (`capital_rounds.type`): equity (ägarkapital/' +
  'investering), convertible (konvertibelt skuldebrev), loan (lån/kredit), ' +
  'grant (bidrag/anslag, t.ex. Vinnova/Almi/EU), soft_funding (mjuk ' +
  'finansiering), other (övrigt). VIKTIGT — blanda ALDRIG ihop dessa: en ' +
  '"investering"/"investeringsrunda" är BARA `equity` och `convertible`. Lån ' +
  '(`loan`) och bidrag (`grant`/`soft_funding`) är INTE investeringar och får ' +
  'aldrig räknas som investeringsrundor. Frågar någon om "investeringar" eller ' +
  '"hur många rundor" — filtrera på `type` i ("equity","convertible") och säg ' +
  'uttryckligen att lån/bidrag räknas separat. Vill användaren ha allt mottaget ' +
  'kapital, summera per `type` och redovisa uppdelningen, inte en klumpsumma ' +
  'kallad "investeringar". `amount_sek` är beloppet; `source` är finansiären.';
