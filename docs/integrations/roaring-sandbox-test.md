# Roaring — testa integrationen mot sandboxen

Runbook för att verifiera bolagsregister-providern `roaring`
(CLAUDE.md § 11.8) med ett sandbox-konto innan portföljen synkas i
produktion. Ingenting skrivs till databasen förrän steg 5.

## Vad som är verifierat (2026-10-08, Roarings API-katalog)

| Del | Katalog-id → sökväg | Status |
| --- | --- | --- |
| Token | `POST https://api.roaring.io/token`, Basic `client_id:client_secret`, `grant_type=client_credentials` | Bekräftad |
| Grunddata | `se-company-overview-2.0` → `/se/company/overview/2.0/{orgnr}` (reserv `1.1`) | Bekräftad. Svarar `{ records: [ … ] }`; posten har bl.a. `communeCode`, `numberEmployeesInterval` och ett `status`-objekt (bolagets status) |
| Bokslut | `se-company-economy-overview-2.1` → `/se/company/economy-overview/2.1/{orgnr}` (reserv `1.1`) | Sökväg/version bekräftad i katalogen (publicerad). **Fältnamnen obekräftade** — läs fältnyckel-noten |
| Koncernstruktur | `se-company-group-structure-1.0` → `/se/company/group-structure/1.0/{orgnr}` | Bekräftad. **Platt lista** `groupCompanies[]` med `companyId`, `companyName`, `countryCode`, `companyLevel`, `motherCompanyId`, `ownedPercentage` |
| Verklig huvudman | `se-beneficialowner-2.1` (2.0 avvecklad 2025-01-15). Per bolag: `/se/beneficialowner/2.1/company/{orgnr}`, reserv `/se/beneficialowner/2.1/{orgnr}` och `/se/beneficialowner/1.0/company/{orgnr}` | Version bekräftad; `/company/`-formen är dokumenterad för 1.0 och antas för 2.1 — **vilken som svarar syns i noten**. Fältnamnen inuti `beneficialOwners[]` obekräftade |
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
   Fältnycklarna är schemainformation, aldrig värden (§ 11.4).
5. **Rätta mappningen** om en not säger att något saknas fast fältet finns
   i nyckellistan: lägg till namnet i kandidatlistan i
   `apps/web/src/lib/integrations/providers/roaring/normalize.ts`
   (t.ex. `REVENUE_PATHS`, `ASSETS_PATHS`, `BO_CAPITAL_PATHS`) med ett
   fixtur-test i `normalize.test.ts`. Svarar ett API 404 på alla
   kandidater fast bolaget finns: sätt motsvarande `ROARING_*_PATH` i Coolify
   till den sökväg portalen visar (kommaseparerad lista tillåts) — t.ex.
   `ROARING_BENEFICIAL_OWNER_PATH=/se/beneficialowner/2.1/company`.
6. **Kontrollera enheten** för bokslutsbelopp: `economy-overview` anges
   normalt i TSEK (`ROARING_AMOUNT_MULTIPLIER` default 1000). Jämför
   förhandsgranskningens `revenue_sek` med portalens exempel; svarar API:t i
   SEK sätts multiplikatorn till `1`.
7. **Synka ett bolag** från bolagskortet ("Synka från Roaring") och
   kontrollera Finansiell historik + Ägarbild. Först därefter "Synka nu"
   för hela portföljen.

## Innan produktion

- DPA med Roaring AB + kontroll att licensen täcker verklig huvudman
  (CLAUDE.md § 11.3, C-37/20).
- Byt till produktionsapplikationens nyckelpar (koppla från + anslut igen).
- Fysiska personer lagras aldrig med namn/personnummer — det är
  normaliserarens och `writer.ts` ansvar, inte leverantörens.
