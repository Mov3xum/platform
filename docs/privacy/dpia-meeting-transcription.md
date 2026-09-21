# DPIA — Mötesläge i chatten (AI-transkribering av möten)

**Behandling:** Live-transkribering av fysiska/digitala möten mellan
Movexum-personal och startup-företrädare, med sparande av granskat protokoll
(+ ev. transkript) som anteckning på bolagskortet. CLAUDE.md § 34.

**Datum:** 2026-09-02, uppdaterad 2026-09-12 (§ 6, Fas 3-diarisering) ·
**Status:** Levande dokument — uppdateras vid funktionsändringar.

---

## 1. Systematisk beskrivning av behandlingen

| Aspekt | Beskrivning |
| --- | --- |
| Personuppgifter | Röst (transient, endast under transkribering), yttranden i mötet (text), namn som nämns i samtal, mötestitel |
| Registrerade | Movexum-personal (användaren) och mötesdeltagare (grundare, externa) |
| Flöde | Mikrofon → kontinuerlig PCM-ström i webbläsaren, klippt i pauser (60–90 s) → `/api/chat/meeting/segment` → transkriberingstjänst (Voxtral, Mistral FR/EU — eller en självhostad EU-endpoint med svensktränad modell när operatören satt upp en, CLAUDE.md § 31.2) → text (+ ev. anonyma talarturer, § 6) → personnummer-sanering → `meeting_transcripts` (ägaren-bara) → mänsklig granskning → anteckning på bolagskort → purge av råtranskript |
| Lagring | Ljud: ALDRIG (transient per segment, ej hos Mistral — DPA, ingen träning). Råtranskript: tills sparande, max 7 dagar. Protokoll/transkript: i `notes` (befintliga raderings-/confidential-flöden) |
| Mottagare | Mistral AI (personuppgiftsbiträde, DPA, EU). Valfritt: egen självhostad transkriberingsserver på UpCloud (EU, inom Movexums egen drift — ingen ny tredjepart). Inga andra tredjeparter. Utöver ljudet skickas bara en fast domänordlista + bolagets namn som kontext-bias — aldrig personnamn, mötestitel eller annan PII |
| Tredjelandsöverföring | Nej (EU-suveränt, § 10.2) |

## 2. Nödvändighet och proportionalitet

- **Ändamål:** dokumentation av coachmöten (inkubatordrift) och omsättning av
  åtgärdspunkter till uppgifter. Ersätter manuellt antecknande.
- **Rättslig grund:** berättigat intresse (art. 6.1 f — inkubatordrift) i
  kombination med **informerat samtycke från deltagarna**, inhämtat muntligt
  av coachen och bekräftat i samtyckesgrinden före inspelning
  (`consent_confirmed_at` stämplas). Utan bekräftelse startar ingen inspelning.
- **Dataminimering:** ljud lagras aldrig; personnummer regex-saneras innan
  lagring; råtranskript auto-purgas; endast det kurerade protokollet är
  avsett att bevaras; konfidentiell-flaggan utestänger anteckningen ur all
  AI-kontext.
- **Ingen särskild kategori behandlas avsiktligt.** Skulle känsliga uppgifter
  yttras i mötet ansvarar coachen (granskningssteget) för att ta bort dem
  innan sparande — UI:t uppmanar till granskning.

## 3. Risker och åtgärder

| Risk | Åtgärd |
| --- | --- |
| Deltagare ovetande om inspelning | Samtyckesgrind (blockerande) + synlig pulserande indikator + timer under hela mötet |
| Röstbiometri/profilering | Byggs inte: inga röstavtryck, ingen identifiering, ingen känslodetektering (förbjudet per § 31.4/§ 10.1). Turindelning är ren textanalys med anonyma etiketter |
| Läckage av transkript | `meeting_transcripts` STRIKT ägaren-bara (RLS alla operationer), denylistad för AI:ns query-verktyg, purge efter sparande/7 dagar |
| Personnummer i tal | Regex-sanering på skrivvägen (samma som § 15.6) före lagring, igen före sparande i anteckning |
| Felaktigt AI-protokoll | Människa-i-loopen: protokollet är ett UTKAST som coachen granskar/redigerar; AI-märkning i UI och i den sparade anteckningen |
| Kostnads-/robusthetsrisk | Hårda tak (3 h, 160 segment, chunk-tak), rate-limit, månadsbudget-spärr (§ 9.6), token-loggning i `ai_usage_events` |
| Kraschad klient | Segmenterad uppladdning (max ett segment förloras), återuppta-flöde, explicit lucka-markering i transkriptet |

## 4. Registrerades rättigheter

- **Information:** via coachen i mötet (grindens text) + transparens-footer.
- **Radering:** råtranskript purgas automatiskt; sparad anteckning raderas via
  notes befintliga flöden (author/admin); tenant-/owner-cascade (art. 17).
- **Invändning:** deltagare kan när som helst be coachen stoppa — inspelningen
  stoppas/kastas i panelen ("Avbryt utan att spara" raderar allt).

## 5. Bedömning

Riskklass **begränsad** (EU AI Act art. 11): beslutsstöd med mänsklig
granskning i varje steg; ingen profilering av individer; ingen
autopublicering. Restrisken bedöms låg och proportionerlig mot nyttan.

**Grind för Fas 3 (akustisk diarisering):** uppfylld genom § 6 nedan
(leverantörsstöd finns hos befintligt biträde; ingen ny komponent).
Aktiveringen är fortsatt ett maintainer-beslut (env-flagga).

## 6. Tillägg 2026-09-12 — Fas 3: talarturer (diarisering), env-gated

**Behandling som tillkommer när `MOVEXUM_MEETING_DIARIZATION=1` är satt:**
segment-routen ber Voxtral (Mistral, samma biträde/DPA som § 1) att utöver
texten returnera **talarturer** — vilka textavsnitt i segmentet som yttrats av
samma respektive olika röster (`diarize=true` → `segments[].speaker_id`).
Utan flaggan skickas ingen sådan parameter och inget ändras mot § 1–5.

| Aspekt | Bedömning |
| --- | --- |
| Personuppgift | Talarturer är en **anonym, segmentlokal** indelning ("S1/S2" per segment) — ingen identitet, inget röstavtryck. Ljudet lagras inte (§ 1) och kan därför inte jämföras mellan segment; etiketterna börjar om per segment och kopplas ALDRIG till en person av systemet. Namn sätter coachen själv i granskningen (människa-i-loopen) |
| Rättslig grund | Oförändrad (art. 6.1 f + informerat samtycke via grinden). Samtyckestexten täcker "transkriberas av AI" — turindelning är en del av transkriptets struktur, ingen ny ändamålsutvidgning |
| Biometri (art. 9) | **Behandlas inte.** Diarisering här är leverantörens transienta klustring av röstkaraktär INOM ett segment (~90 s) för att sätta gränser mellan repliker; inga röstprofiler skapas, lagras eller jämförs mot något (jfr § 3 "Röstbiometri/profilering"). Röstidentifiering och känslodetektering byggs fortsatt aldrig (CLAUDE.md § 31.4/§ 34.4) |
| Dataminimering | Bara `{speaker: 'S1', text}` per tur lagras (personnummer-sanerat som texten), på samma ägaren-bara rad och med samma purge. Ingen ny kollektion, inga nya mottagare |
| Transparens | Transkriptet visar turerna som repliker med talstreck; UI:t märker AI-genererat innehåll som förut |
| Risk: felaktig hopkoppling | Systemet påstår aldrig identitet över segmentgränser (talstreck, inte numrerade talare). Den språkliga turindelningen (Fas 2) föreslår konsekventa "Talare 1/2"-etiketter som coachen granskar/döper |
| Restrisk | Låg. Riskklass oförändrad (**begränsad**, art. 11) |

**Vad som INTE görs:** segmentövergripande talaridentitet (skulle kräva att
ljudet sparas till mötets slut → bryter § 1 "ljud lagras aldrig" och kräver
ett nytt DPIA-beslut). Självhostade Whisper-servrar (§ 1, valfri provider)
saknar diarisering — då lagras inga turer alls.
