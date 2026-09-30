# Roaring — testa integrationen mot sandboxen

Runbook för att verifiera bolagsregister-providern `roaring`
(CLAUDE.md § 11.8) med ett sandbox-konto innan portföljen synkas i
produktion. Ingenting skrivs till databasen förrän steg 5.

## Vad som är verifierat (2026-09-30, Roarings publika dokumentation)

| Del | Sökväg | Status |
| --- | --- | --- |
| Token | `POST https://api.roaring.io/token`, Basic `client_id:client_secret`, `grant_type=client_credentials`, `expires_in` 3600 s | Bekräftad |
| Grunddata | `/se/company/overview/2.0/{orgnr}` (reserv `1.1`) | Bekräftad (svarar `{ records: [ { companyName, legalGroupText, … } ] }`) |
| Koncernstruktur | `/se/company/group-structure/1.0/{orgnr}` | Bekräftad |
| Verklig huvudman | `/se/beneficialowner/2.1/{orgnr}` — fält `beneficialOwners[]`, `hasBeneficialOwners`, `changeDate`, `registrationDate`, `status` | Bekräftad sökväg; fältnamnen INUTI `beneficialOwners[]` (andel/intervall, kontrollgrund) obekräftade |
| Bokslut | `/se/company/economy-overview/1.1/{orgnr}` (reserv `/se/company/financial-record/1.1`) | **Obekräftad** — kontrollera i utvecklarportalen |
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
   (`/installningar/integrationer`) → kortet Roaring → `/integrationer/roaring` →
   Client ID + Client secret. Lämna **Bas-URL tom** (sandboxen använder
   `https://api.roaring.io`). Hemligheten krypteras AES-256-GCM i
   `tenant_integrations.config` och visas aldrig igen.
3. **Testa anslutning** — gör bara ett token-anrop. "Klient-id/
   klienthemlighet avvisades" = fel nyckelpar; "Kunde inte nå token-
   endpointen" = nätverk/utgående policy på hosten.
4. **Testa mot org-nr** på samma sida med ett av sandboxens testbolag
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
   fixtur-test i `normalize.test.ts`. Svarar bokslut-API:t 404 på båda
   kandidaterna: sätt `ROARING_FINANCIALS_PATH` i Coolify till den sökväg
   portalen visar (kommaseparerad lista tillåts).
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
