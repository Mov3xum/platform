# DPIA — Kompetens-hashtags, belastning och AI-stött teamförslag

**Behandling:** personalens självdeklarerade yrkeskompetens (hashtags med
nivå, utvecklingsintressen) och härledd arbetsbelastning (antal pågående
team) som underlag för ett AI-stött FÖRSLAG till bemanning av
tvärfunktionella team (CLAUDE.md § 29, § 29.7).

**Datum:** 2026-10-02 · **Status:** levande dokument. **Godkänd av
maintainer (Hampus Granström) 2026-10-04** i samband med PR #431
(CLAUDE.md § 10.1: separat granskning av varje funktion som kan beröra
Annex III). Omprövas vid de ändringar som listas i § 3.

---

## 1. Systematisk beskrivning

| Aspekt | Beskrivning |
| --- | --- |
| Personuppgifter | `users.competence_tags` (hashtag + kompetensområde + nivå *kan bidra / stark / expert*), `users.development_interests` (hashtags), `users.title`, `users.bio` (fritext, cappad). Härledd belastning: antal pågående uppdrag per person och i hur många hen är ansvarig — **lagras aldrig**, räknas vid varje visning ur `missions`. |
| Registrerade | Movexum-personal (admin/incubator_lead/coach/mentor). Bolagsmedlemmar, observatörer och externa kontakter är aldrig kandidater. |
| Vem sätter uppgifterna | Personen själv, under Min profil (självservice via `users.updateRule`, fältlås 1700000174 gäller behörighetsfälten). Ingen bedömning görs av chef eller system — nivån är självskattning. |
| Flöde | (1) Behov: uppdragsbeskrivning (personnummer-sanerad) + bolagets bransch/fas → Mistral (EU) → områden/hashtags, validerade mot taxonomin. (2) **Deterministisk rankning i egen kod** (`rankTeamCandidates`, enhetstestad): hashtag-träff, nivå, relation till bolaget, belastning och **meriter** = antal avslutade team personen ingått i, varav de vars `missions.needed_tags` överlappar behovet (lätt vikt, tak 3 + 5; ingen prestationsdom, bara deltagande). (3) Teamsammansättning: Mistral får en **pseudonymiserad** shortlist (användar-id, träffade hashtags/nivå, belastningsetikett) — inga namn, titlar eller e-postadresser lämnar plattformen; servern slår upp namnen efteråt. |
| Lagring | Profilfälten i PocketBase (EU, egen drift). Tenant-vokabulären `competence_tags` (slug/etikett/område/skapare — inga personuppgifter). Förslaget persisteras inte; det som sparas är det team människan själv skapar (`missions.participants_json`). Token-förbrukning i `ai_usage_events` (PII-fri). |
| Mottagare | Mistral AI (FR, personuppgiftsbiträde med DPA, § 10.2) — får pseudonymiserade kandidatrader och en sanerad uppdragsbeskrivning. Ingen annan tredjepart. |
| Åtkomst | Profilfält: alla i tenanten kan läsa `users` via `viewRule` (befintligt, § 9.3) — bolagsmedlemmar når dock inte ytorna där de visas (Min profil är egen, teamförslag/panel är staff). `competence_tags`: staff/observer. Belastning visas bara för staff (en medlems token ser via RLS bara egna uppdrag). `users` är denylistad för chattens `query_collection`; taggar/belastning når modellen bara i den isolerade matcharen. |

## 2. Nödvändighet och proportionalitet

- **Ändamål:** omorganisationen 2026-11 bemannar team runt uppdrag. Rätt
  kompetens och rimlig arbetsbelastning är det som avgör om teamet fungerar;
  utan belastning föreslås samma tre experter till allt.
- **Rättslig grund:** berättigat intresse (art. 6.1 f — inkubatordrift,
  bemanning). Intresseavvägning: uppgifterna är yrkesrelaterade,
  självdeklarerade, synliga bara internt, och förslaget är icke-bindande.
  Inte art. 9 (ingen särskild kategori; systemprompten förbjuder uttryckligen
  bedömning på kön, etnicitet, ålder m.m.).
- **Dataminimering:** fast nivåskala i stället för fritext; slug-normalisering
  av taggar (personnummer-mönster avvisas, etiketter saneras); belastning som
  härlett tal; pseudonymiserad prompt; inga namn i audit (`agent_actions`
  loggar slug + område).
- **Rättigheter:** personen ser och ändrar allt själv (art. 15–16);
  raderas kontot försvinner fälten (art. 17); `created_by` i vokabulären
  nollställs.

## 3. EU AI Act — klassning (art. 6, Annex III p. 4)

Annex III p. 4(b) omfattar AI som används för att **fördela uppgifter utifrån
individuellt beteende eller personliga egenskaper** eller för att övervaka/
utvärdera prestation. Bedömning:

- **Vad AI:n gör:** tolkar en fritextbeskrivning till kompetensbegrepp och
  formulerar ett *förslag* ur en lista som redan är rankad av deterministisk
  kod. Den fattar inget beslut, tilldelar ingenting och ser inga namn.
- **Underlaget** är yrkeskompetens som personen själv angett och ett
  arbetsbelastningsmått (antal team) — inte beteende, prestation eller
  personlighet. Belastningen används för att *skydda* den enskilde från
  överbelastning, inte för att utvärdera hen.
- **Människa i loopen (art. 14):** staff läser förslaget, kan se "fler
  rankade kollegor", lägger till/tar bort fritt och skapar teamet själv.
  Förslaget går aldrig automatiskt vidare till någon.
- **Art. 6.3-undantaget:** systemet utför en *förberedande uppgift* och
  påverkar inte materiellt resultatet av beslutet — rankningen är
  transparent (poäng och skäl visas), reproducerbar utan AI (reservvägen
  `fallbackCompose`) och ändringsbar av människan. Det **profilerar inte**
  i art. 4.4-mening: ingen prediktion av prestation, hälsa, intressen eller
  beteende görs — bara en summering av självdeklarerade taggar och ett
  räknat antal team.

**Slutsats:** begränsad risk (transparenskrav art. 50 uppfylls med
Mistral-/"verifiera"-bannern i formuläret). Klassningen **omprövas** om
funktionen ändras så att (a) förslaget tilldelar automatiskt, (b)
belastning eller nivå börjar sättas av någon annan än personen själv
(chefsbedömning), (c) historik om prestation/utfall per person vägs in,
eller (d) förslaget används för lön, befordran eller anställning. Då är det
Annex III-högrisk och kräver juridisk granskning före bygge (§ 10.1).

## 4. Risker och åtgärder

| Risk | Åtgärd |
| --- | --- |
| Personnamn eller e-post hamnar i prompten | Prompten är pseudonymiserad (id + taggar + belastningsetikett). Uppdragsbeskrivningen personnummer-saneras. Vokabulärens etiketter saneras och `suggested`-taggar visas med slug-härledd etikett. |
| Personuppgift som hashtag ("anna-andersson") | Slug-filtret avvisar personnummer; UI:t säger "kompetens, aldrig personuppgifter"; bara staff kan registrera taggar i vokabulären; ledningen kan ta bort (PB-regel). Kvarstående risk: ett namn som slug — hanteras organisatoriskt (ledningen granskar nya `suggested`-taggar; ett adminvy för godkännande är nästa steg). |
| Belastning används som prestationsmått | Visas bara som arbetsbelastning (antal team), aldrig som ranking av personer utanför ett konkret bemanningsbehov; lagras inte; ingen historik. |
| Felaktig belastning för icke-staff | Visas bara för staff; läsningen filtrerar på aktiva statusar och flaggar `complete:false` vid kapning. |
| Bias i AI-steget | Deterministisk rankning först (samma regler för alla), modellen ser inga namn, systemprompten förbjuder skyddade attribut, människa beslutar. |
| Kostnad/robusthet | Månadstaket (§ 9.6) prövas före anropen; två små `mistral-small`-anrop per förslag; reservväg utan AI. |
| Bolagsmedlem läser personalens taggar via API | Befintlig `users.viewRule` (tenantbred läsning) — känd avvikelse, låg känslighet (yrkeskompetens). Åtgärd på sikt: flytta profilfälten bakom en staff-vy. |

## 5. Beslut

Behandlingen bedöms proportionerlig med åtgärderna ovan. Godkänd av
maintainer 2026-10-04 (PR #431). Omprövning vid de ändringar som listas i
§ 3. **Tillägg 2026-10-04:** meriter ur avslutade team (`missions.needed_tags`
+ deltagande) och täckningsvyn i Inställningar → Kompetenser (aggregat per
hashtag, inaktuella profiler listade med namn för ledningen — intern
administration, samma krets som redan läser profilerna) ryms inom samma
bedömning: deltagande i ett team är verksamhetsdata, inte utfall/prestation,
och utlöser inte omprövningspunkt (c).

## Tillägg 2026-10 — teamtak (max antal pågående team per person)

Ledningen sätter ett tak per tenant (default 3) för hur många pågående team
en person får ingå i samtidigt. Taket är en **enhetlig administrativ regel**
som gäller alla lika och som räknas ur samma härledda belastning som redan
bedömts ovan (antal pågående uppdrag — lagras inte). Det innebär ingen ny
personuppgift, ingen individuell bedömning och ingen ny AI-inferens: AI:n
får bara färre kandidater (den som nått taket filtreras bort av
deterministisk kod innan modellen anropas). Syftet är att skydda den
enskilde från överbelastning. Ingen av omprövningsgrunderna (a)–(d) ovan
träffas; riskklassen är oförändrad (begränsad). Inställningen auditeras
(bara talet) och syns i aktivitetsloggen.

