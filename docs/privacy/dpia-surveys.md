# DPIA-tillägg — Startupkompassen som enkätmotor (kundnöjdhet, NPS, partnerenkät, medarbetarindex)

**Behandling:** insamling och aggregering av enkätsvar via Startupkompassens
formulärmotor för verksamhetens målstyrning (CLAUDE.md § 42–§ 43).

**Datum:** 2026-09-29 · **Status:** levande dokument.

---

## 1. Systematisk beskrivning

| Aspekt | Beskrivning |
| --- | --- |
| Personuppgifter | Enkätsvar (skalvärden 1–10, valfri fritext). Inga kontaktfält. För `anonymous`-moduler finns inga identifierare alls: ingen session_token, ingen ip-hash, inget lead, inget konto. För icke-anonyma enkäter (kundnöjdhet, partnerenkät) kopplas svaret till ett SUBJEKT (bolag/partner/event-id) — inte till en person. |
| Registrerade | Bolagsföreträdare, eventdeltagare, partnerkontakter, Movexum-personal (medarbetarindex). |
| Flöde | Publik länk `/m/<slug>?om=<subjekt-id>` → samtyckesgrind (`consent_note`) → svar → `/api/public/m/<slug>/submit` → `compass_conversations` (subjekt, status) + `compass_responses` (fråga → värde) → aggregat via `aggregateSurvey` (k = 5) → indikator i `/mal`. |
| Lagring | Råsvar i PocketBase (EU, egen drift). Aggregat persisteras som kvartalsvärde i `goal_status_entries` (ett tal, inga svar). |
| Mottagare | Ingen tredjepart. Ingen AI-inferens på svaren. |
| Åtkomst | Råsvar och aggregat: staff/observer via RLS (`conversation.tenant`, § 21.7). Publika besökare ser aldrig andras svar. |

## 2. Nödvändighet och proportionalitet

- **Ändamål:** verksamhetsplanens indikatorer (kundnöjdhet 4/5, NPS 70 %,
  partnernöjdhet 80 %, medarbetarindex) behöver en datakälla. Tidigare
  mättes de inte alls.
- **Rättslig grund:** berättigat intresse (inkubatordrift, § 6.1 f) +
  informerat samtycke i grinden (art. 7). Medarbetarindex: anonymitet gör
  att svaren inte är personuppgifter i praktiken; ändå samtyckesgrind.
- **Dataminimering:** inga kontaktfält, fritext uppmanas vara PII-fri och
  aggregeras aldrig (bara räknas). Rätt att bli bortglömd: råsvar kan
  raderas per konversation; anonyma svar kan inte kopplas till en person.

## 3. Risker och åtgärder

| Risk | Åtgärd |
| --- | --- |
| Återidentifiering i små grupper | `aggregateSurvey` visar inga värden under 5 respondenter; NPS kräver ≥ 5 numeriska svar. |
| Medarbetarindex per team röjer individer | Ingen teamnedbrytning; bara tenantnivå. Ingen ip-hash, ingen session. |
| Enkät används som intag i smyg | `purpose = survey` ⇒ `moduleWantsLead` = false i koden; `create_lead` tvingas false i actions och skrivlager. |
| Subjekt-id manipuleras | Endast id-format `[a-zA-Z0-9_-]{1,64}` accepteras; tenant härleds alltid från modulen (aldrig från body). |
| Chatt-agenten läser råsvar | `compass_responses` nås av `query_collection` under RLS + fältmaskning (§ 9.3); svaren innehåller inga direkta identifierare. Aggregatet är det som når målstyrningen. |

## 4. Beslut

Riskklass EU AI Act: n/a (ingen inferens). GDPR: restrisk låg. Godkänd att
driftsättas med ovanstående kontroller; omprövas när enkäter skickas ut
automatiskt via e-post (ännu inte byggt).
