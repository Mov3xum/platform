# DPIA — Studenter & talang (matchning student ↔ bolag)

**Behandling:** studenter (privatpersoner utanför Movexum) registrerar själva
en profil på en publik sida för att matchas mot bolag i inkubatorn som söker
examensarbetare, praktikanter, deltidsanställda eller medarbetare
(CLAUDE.md § 54).

**Datum:** 2026-10-19 · **Status:** levande dokument, **väntar på
maintainerns godkännande** (CLAUDE.md § 10.1). Omprövas vid de ändringar som
listas i § 3.

---

## 1. Systematisk beskrivning

| Aspekt | Beskrivning |
| --- | --- |
| Personuppgifter | `student_profiles`: för-/efternamn, e-post (identitet + magisk länk), lärosäte, program, nivå, examensår, kompetens-hashtags med självskattad nivå, vad studenten söker, tillgänglig från, ort, distans ok, fritext "om mig" (cappad 1 500 tecken, personnummer-saneras), valfri LinkedIn-länk, sökbar ja/nej, status, samtyckes- och gallringstid, SHA-256-hash av engångstoken. `talent_interests`: koppling student ↔ behov, status, studentens hälsning (cappad), bolagets interna anteckning, utfall. **Inga betyg, inga art. 9-fält, inget CV.** |
| Registrerade | Studenter som själva registrerat sig. Bolagens kontaktpersoner är befintliga användare (`startup_member`). |
| Vem sätter uppgifterna | Studenten själv (registrering + redigering på sin sida). Movexum kan pausa/avregistrera/radera på studentens begäran. Bolag och Movexum sätter bara status på intressen och interna anteckningar. |
| Flöde | (1) Bolaget skriver ett behov → Movexum granskar och publicerar. (2) Studenten registrerar sig (samtyckesgrind), bekräftar e-post via länk och söker ett publicerat behov — **först då** ser det bolaget namn och e-post. (3) Bolag/Movexum kan föreslå en **sökbar** student utifrån en **deterministisk** rankning (hashtag-träff viktad med nivå, typ, period, plats — `@platform/shared/talent.ts`, enhetstestad); studenten får ett mejl och avgör; bolaget ser henne anonymt tills hon tackar ja. (4) Bolaget markerar dialog/match/avböjt; utfall registreras när det är klart. |
| Lagring | PocketBase (EU, egen drift). Samtycket gäller ett år (`expires_at`); profilen gallras automatiskt därefter (lazy, när Movexum öppnar studentlistan) om studenten inte förlänger. Obekräftade registreringar gallras efter 7 dagar. Sessionen är en HMAC-signerad cookie (30 dagar) — inget lagras. |
| Mottagare | Resend (e-post, befintlig leverantör med DPA) för magiska länkar och besked. Inget skickas till Mistral eller någon AI-tjänst: `student_profiles` och `talent_interests` är denylistade för chattens `query_collection`, och ingen AI-funktion läser dem. |
| Åtkomst | Studentprofiler: Movexum-personal/observer via RLS (`student_profiles` staff/observer-only). Bolaget ser (a) sökbara studenter ANONYMT (ingen e-post, inget namn) via en kurerad superuser-vy i koden, (b) namn/e-post/LinkedIn på ett intresse BARA när studenten själv sökt eller tackat ja (`interestRevealsContact`). Studenten ser bara sin egen profil och sina egna intressen (publik route, tenant + sessionsprofil verifierade). |

## 2. Nödvändighet och proportionalitet

- **Ändamål:** koppla ihop inkubatorbolagens kompetensbehov med studenter
  (exjobb, praktik, anställning) utan att e-postadresser och CV:n sprids via
  mejltrådar.
- **Rättslig grund:** **samtycke** (art. 6.1 a) för studenten — inhämtat
  med en uttrycklig kryssruta vid registreringen, stämplat (`consent_at`),
  återkalleligt (pausa/ta bort på egen sida, art. 7.3). Bolagets kontakt-
  personer: berättigat intresse (inkubatordrift). Ingen art. 9-behandling.
- **Dataminimering:** inga betyg, inget CV, ingen adress eller telefon; fast
  nivåskala i stället för fritext där det går; hashtags slug-normaliseras
  (personnummer-mönster avvisas); fritext cappas och personnummer-saneras;
  anonymiserad projektion till bolag; audit i `agent_actions` bär aldrig
  studentens namn/e-post/meddelande (bara behovets rubrik, status, antal).
- **Information (art. 13):** samtyckestexten anger vem som är ansvarig, vad
  som sparas, hur länge, vilka som ser vad och hur man tar bort sig;
  sidfoten på varje publik sida upprepar att ingen AI bedömer studenter.
- **Registrerades rättigheter:** tillgång (egen sida), rättelse (redigera),
  radering (knapp "Ta bort min profil" = hård radering, intressen
  kaskadraderas), begränsning (pausa), dataportabilitet (uppgifterna visas i
  klartext på egen sida; export kan läggas till vid behov).
- **EU AI Act:** matchningen är deterministisk och förklarbar (poäng + skäl).
  Ingen AI rankar, filtrerar eller bedömer studenter — det skulle falla under
  bilaga III p. 4 (rekrytering, högrisk). AI används inte heller för att
  strukturera bolagets behov i denna version.

## 3. Risker och åtgärder

| Risk | Sannolikhet / allvar | Åtgärd |
| --- | --- | --- |
| Ett bolag ser kontaktuppgifter utan att studenten valt det | låg / hög | Kurerade superuser-vyer anonymiserar; namn/e-post exponeras enbart via `toInterestStudentView` när status är new/dialogue/matched; `student_profiles` saknar RLS-läsning för medlemmar. |
| Magisk länk missbrukas (mejlskanner, vidarebefordrat mejl) | låg / medel | Länken växlas mot session först vid POST från bekräftelsesidan; token är 32 slumpbytes, bara hashen lagras, 30 min giltighet, förbrukas vid användning. |
| Uppräkning av registrerade adresser | låg / låg | Registrering/inloggning svarar identiskt oavsett om adressen finns; rate-limit per IP. |
| Kvarliggande uppgifter | medel / medel | Samtycke ett år + automatisk gallring; obekräftade profiler 7 dagar; studenten kan radera när som helst. |
| PII i fritext (om mig, hälsning) | medel / låg | Cappat, personnummer-saneras, UI uppmanar att inte skriva uppgifter om andra; fälten når aldrig AI. |
| Direkt-API: ett bolag skapar behov för ett annat bolag i samma tenant | låg / låg | Skrivlagret verifierar länkat bolag; RLS visar behovet ändå bara för rätt bolag + Movexum; Movexum granskar före publicering. Noterad begränsning: createRule kan inte joina bolagstillhörighet (§ 21.3). |
| Diskriminering i matchning | låg / medel | Deterministisk, transparent rankning på självvalda hashtags/typ/period/plats; inga demografiska fält finns i modellen. |

**Omprövas (ny DPIA) om:** AI används för att ranka, filtrera eller
sammanfatta studenter; CV-uppladdning eller betyg läggs till; profiler delas
med bolag utanför tenanten; lärosäten får direktåtkomst; profilen används
för något annat ändamål (marknadsföring, statistik på individnivå).

## 4. Beslut

Riskklass (EU AI Act): **n/a** för matchningsmotorn (ingen AI-inferens).
GDPR: behandlingen är proportionerlig med åtgärderna ovan. **Godkännande av
maintainer krävs innan produktion** (ett godkännande noteras här med datum).
