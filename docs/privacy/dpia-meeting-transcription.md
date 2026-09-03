# DPIA — Mötesläge i chatten (AI-transkribering av möten)

**Behandling:** Live-transkribering av fysiska/digitala möten mellan
Movexum-personal och startup-företrädare, med sparande av granskat protokoll
(+ ev. transkript) som anteckning på bolagskortet. CLAUDE.md § 34.

**Datum:** 2026-09-02 · **Status:** Levande dokument — uppdateras vid
funktionsändringar (särskilt före ev. Fas 3-diarisering).

---

## 1. Systematisk beskrivning av behandlingen

| Aspekt | Beskrivning |
| --- | --- |
| Personuppgifter | Röst (transient, endast under transkribering), yttranden i mötet (text), namn som nämns i samtal, mötestitel |
| Registrerade | Movexum-personal (användaren) och mötesdeltagare (grundare, externa) |
| Flöde | Mikrofon → segment (~90 s) → `/api/chat/meeting/segment` → Voxtral (Mistral, FR/EU) → text → personnummer-sanering → `meeting_transcripts` (ägaren-bara) → mänsklig granskning → anteckning på bolagskort → purge av råtranskript |
| Lagring | Ljud: ALDRIG (transient per segment, ej hos Mistral — DPA, ingen träning). Råtranskript: tills sparande, max 7 dagar. Protokoll/transkript: i `notes` (befintliga raderings-/confidential-flöden) |
| Mottagare | Mistral AI (personuppgiftsbiträde, DPA, EU). Inga andra tredjeparter |
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

**Grind för Fas 3 (akustisk diarisering):** kräver uppdatering av denna DPIA
+ maintainer-beslut om ev. ny leverantör/självhostad komponent INNAN bygge.
