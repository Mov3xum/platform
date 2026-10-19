# Roaring — testa integrationen mot sandboxen

Runbook för att verifiera bolagsregister-providern `roaring`
(CLAUDE.md § 11.8) med ett sandbox-konto innan portföljen synkas i
produktion. Ingenting skrivs till databasen förrän steg 5.

## Vad som är verifierat (2026-10-08, Roarings API-katalog)

| Del | Katalog-id → sökväg | Status |
| --- | --- | --- |
| Token | `POST https://api.roaring.io/token`, Basic `client_id:client_secret`, `grant_type=client_credentials` | Bekräftad |
| Grunddata | `se-company-overview-2.0` → `/se/company/overview/2.0/{orgnr}` (reserv `1.1`) | Bekräftad. Svarar `{ records: [ … ] }`; posten har bl.a. `communeCode`, `numberEmployeesInterval` och ett `status`-objekt (bolagets status) |
| Bokslut | `se-company-economy-overview-2.1` → `/se/company/economy-overview/2.1/{orgnr}` (reserv `1.1`) | **Bekräftad mot riktigt svar 2026-10-12.** En post per räkenskapsår: `fromDate`, `toDate`, `currency`, `numberOfEmployees`, `plSales` (nettoomsättning → `revenue_sek`), `plNetOperatingIncome` (rörelsens intäkter — noteras om den avviker från `plSales`), `plEbit`, `plProfitLossAfterFinItems`, `plNetProfitLoss` (→ `net_result_sek`), `bsShareCapital`, `bsTotalEquity` (→ `equity_sek`), `bsTotalLongTermDebts`, `bsTotalCurrentLiabilities`, **`bsTotalEquityAndLiabilities` (→ `balance_sheet_sek`; balansomslutningen finns bara på skuldsidan)**, KPI-fält (`kpi*Percent`). Personalkostnad/bolagsskatt saknas i API:t. Belopp i TSEK (multiplikator 1000) |
| Koncernstruktur | `se-company-group-structure-1.0` → `/se/company/group-structure/1.0/{orgnr}` | Bekräftad. **Platt lista** `groupCompanies[]` med `companyId`, `companyName`, `countryCode`, `companyLevel`, `motherCompanyId`, `ownedPercentage` |
| Verklig huvudman | `se-beneficialowner-2.1` (2.0 avvecklad 2025-01-15). Per bolag: `/se/beneficialowner/2.1/company/{orgnr}`, reserv `/se/beneficialowner/2.1/{orgnr}` och `/se/beneficialowner/1.0/company/{orgnr}` | **`/2.1/company/` bekräftad 2026-10-12.** Svarar `caseId`, `changeDate`, `legalEntity{type,companyId,companyName}`, `beneficialOwners[person,extentOfControl,controlTypes]`, `status{description,code}`, `registrationDateTime`. `person` läses aldrig; `extentOfControl` tolkas som text/objekt/kod inkl. Bolagsverkets ordalydelser ("Mer än 25 men inte mer än 50 procent", `MORE_THAN_75`); `controlTypes[]` mappas till fast vokabulär. Formen INUTI `extentOfControl`/`controlTypes` visas i fältnyckel-noten (två nivåer) — kan intervallet inte tolkas säger en egen not det |
| Ägarnas andra bolag (§ 51.11) | Verklig huvudman per person: `/se/beneficialowner/2.1/person/{personnummer}`, reserv `/1.0/person` (env `ROARING_PERSON_ENGAGEMENT_PATH`) + grunddata per hittat bolag | **Bekräftad mot OpenAPI-spec 2026-10-19** (`/person/{personalNumber}` under `https://api.roaring.io/se/beneficialowner/2.1`). Bolagssvarets `person` = `PersonDetails{firstNames[], middleName, surName, personalNumber, coordinationNumber, birthDate, …}` — personnumret (eller samordningsnumret) läses och används bara som parameter; `birthDate` läses aldrig. Personsvaret = `records[]` med en post per bolag: `association{companyId, companyName, type}` + `person{namn}` — **ingen andel och ingen kontrollgrund** (bara att personen är verklig huvudman, > 25 % eller kontroll). Personnumrets format i sökvägen anges bara som "string" — verifiera 10 eller 12 siffror i sandboxen |
| "Inga poster" | Roaring kan svara HTTP 200 med `records not found` i kuvertet | Hanteras som 404 (nästa kandidat provas) |
| Sandbox | Samma värd som produktion. Sandbox-applikationens nycklar ger testdata. | Bekräftad |

Roarings egna domäner (`developer.roaring.io`, `docs.roaring.io`,
`api.roaring.io`) nås inte från byggmiljön, så fältmappningen kan bara
verifieras genom att köra förhandsgranskningen mot sandboxen.

## Steg

1. **Skapa nycklar** i Roarings utvecklarportal: Applications → (sandbox-
   applikationen) → Credentials. Kontrollera vilka API:er applikationen har
   (Company Overview, Economy Overview / Financial, Group Structure,
   Beneficial Owner). Ett API som saknas svarar 403 — det stoppar inte de
   andra, men noteras.
2. **Anslut i appen** (admin/incubator_lead): Inställningar → **Integrationer**
   (`/installningar/integrationer`) → kategorin **Bolagsregister** → kortet
   Roaring. Klistra in Client ID + Client secret **direkt på kortet**. Lämna
   **Bas-URL tom** (sandboxen använder `https://api.roaring.io`). Hemligheten
   krypteras AES-256-GCM i `tenant_integrations.config` och visas aldrig
   igen. Saknas kortet helt: katalograden seedas av migration 1700000173 och
   självläks via superusern när sidan laddas — visas i stället en orange
   ruta på kortet står orsaken där (ingen superuser konfigurerad, eller
   category-enumet saknar `company_registry` → kör "Sync PocketBase").
3. **Anslut Roaring** på kortet gör bara ett token-anrop innan något sparas.
   "Klient-id/klienthemlighet avvisades" = fel nyckelpar; "Kunde inte nå
   token-endpointen" = nätverk/utgående policy på hosten. Efter lyckad
   anslutning visar kortet "Nycklar sparade" + knappen **Synka & testa**
   (→ `/integrationer/roaring`); "Byt nycklar" på kortet ersätter paret.
4. **Testa mot org-nr** på detaljsidan med ett av sandboxens testbolag
   (listas i utvecklarportalen under sandbox/test objects; ett riktigt
   org-nr fungerar också mot sandboxen men svarar med testdata). Ingenting
   sparas. Läs noteringarna längst ned — de innehåller per API:
   - vilken sökväg som svarade, t.ex. `Roaring verklig huvudman
     (/se/beneficialowner/2.1) svarade med fälten: companyId,
     hasBeneficialOwners, beneficialOwners[…]`, och
   - vad normaliseraren INTE kunde tolka ("registreringsdatum saknas",
     "balansomslutning saknas för N årsrad(er)").
   Fältnycklarna är schemainformation, aldrig värden (§ 11.4). Noten visar
   formen två nivåer ned (`beneficialOwners[person{…},extentOfControl{code,text},
   controlTypes[code,text]]`) så att även nästlade fält kan stämmas av.
   Grunddata (`overview/2.0`) bär bl.a. `email`, `phoneNumber` och
   `topDirectorName` — de läses medvetet INTE (PII, § 11.4).
5. **Rätta mappningen** om en not säger att något saknas fast fältet finns
   i nyckellistan: lägg till namnet i kandidatlistan i
   `apps/web/src/lib/integrations/providers/roaring/normalize.ts`
   (t.ex. `REVENUE_PATHS`, `ASSETS_PATHS`, `BO_CAPITAL_PATHS`) med ett
   fixtur-test i `normalize.test.ts`. Svarar ett API 404 på alla
   kandidater fast bolaget finns: sätt motsvarande `ROARING_*_PATH` i Coolify
   till den sökväg portalen visar (kommaseparerad lista tillåts) — t.ex.
   `ROARING_BENEFICIAL_OWNER_PATH=/se/beneficialowner/2.1/company`.
6. **Stäm av credits per API** under Inställningar → Integrationer → Roaring →
   Kostnad per anrop. Plattformen har Roarings publicerade listpris som
   lägsta nivå (läst 2026-10-12, före volymrabatt, exkl. moms): 0,20
   kr/credit och per anrop Företagsinformation 2.0 = 10, Finansiell
   Information 2.1 = 35, Ägarstruktur 1.0 = 150, Verklig Huvudman 2.1 = 50
   (kalkylatorns rad "– Person"; bolagsuppslaget antas kosta lika) — en
   full hämtning är 245 credits = 49,00 kr per bolag. Bokslutsdelen anropar
   `/extended` (flera år + utdelning): kontrollera att den debiteras som
   raden Finansiell Information 2.1. Jämför med ert inloggade konto: app.roaring.io →
   bentomenyn → "Fakturering & Priser" → "Konsumering"; avviker ert paket
   anges era värden i formuläret och vinner per fält över listpriset (er
   avtalade kr/credit efter volymrabatt likaså). Bedömningssidan visar
   kostnaden före varje hämtning och i resultatet.
7. **Kontrollera enheten** för bokslutsbelopp: `economy-overview` anges
   normalt i TSEK (`ROARING_AMOUNT_MULTIPLIER` default 1000). Jämför
   förhandsgranskningens `revenue_sek` med portalens exempel; svarar API:t i
   SEK sätts multiplikatorn till `1`.
7b. **Verifiera utdelningen.** Bokslutsdelen anropar
   `/se/company/economy-overview/2.1/extended/{orgnr}?years=5` (OpenAPI-spec
   2026-10-12) där varje årsrad bär `dividend`, `plPersonalCosts` och
   `plTaxes`. Kör "Testa mot org-nr" på ett bolag som ni VET har beslutat
   utdelning (och ett som inte har det): kolumnen Utdelning ska visa beloppet
   respektive "0 kr". Visas "–" med noten "utdelningsposten (dividend)
   saknas" svarade den nakna reservsökvägen (bara senaste året, utan
   utdelning) — kontrollera att `/extended` ingår i ert paket (403 ⇒ inte i
   paketet). Beloppen antas vara i TSEK som övriga bokslutsposter
   (`ROARING_AMOUNT_MULTIPLIER`); utdelningsvillkoret i bedömningen avgörs
   av 0 eller inte och påverkas inte av enheten.
7c. **Verifiera ägarnas andra bolag.** Kör "Testa mot org-nr" med delen
   "Ägarnas andra bolag" (Grunddata och Verklig huvudman bockas i
   automatiskt) på ett bolag vars ägare ni VET äger andra bolag. Kontrollera
   i noteringarna: (a) att personnumret fanns i huvudmannasvaret (annars
   "personnummer saknas … (form: …)" — lägg fältnamnet i `PNR_PATHS` i
   `normalize.ts`), (b) vilken sökväg som svarade för personuppslaget och
   vilka fältnycklar svaret bar (rätta `ENGAGEMENT_*`-kandidaterna vid
   behov), och (c) att varje hittat bolag fick SNI-kod. Stäm av kostnaden
   (ett anrop per huvudman + grunddata per bolag) mot Konsumering.
8. **Synka ett bolag** från bolagskortet ("Synka från Roaring") och
   kontrollera Finansiell historik + Ägarbild. Först därefter "Synka nu"
   för hela portföljen.

## Innan produktion

- DPA med Roaring AB + kontroll att licensen täcker verklig huvudman
  (CLAUDE.md § 11.3, C-37/20).
- Byt till produktionsapplikationens nyckelpar (koppla från + anslut igen).
- Fysiska personer lagras aldrig med namn/personnummer i `startup_ownership`
  — det är `writer.ts` ansvar. Namn visas i uppslag och Bedömning excellens;
  personnummer används bara för personuppslaget och lagras aldrig (§ 51.11).
- DPIA-tillägg för sökning av ägarnas andra bolag (uppslag per person) och
  kontroll att licensen täcker verklig huvudman per person.
