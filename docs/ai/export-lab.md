# Export Lab — internationaliseringsanalys per bolag

> Bindande regler: CLAUDE.md § 58. Detta dokument är forskningsgrunden och en
> karta över koden.

## 1. Vad modulen gör

Export Lab ger ett inkubatorbolag **en plan för hur det bör arbeta
internationellt med sin innovation och en första exportplan**, anpassad till
bolagets framdrift (KTH Innovation Readiness Level) och med regelverk,
kulturella likheter/skillnader och affärsmässiga förutsättningar invägda.
Flödet är detsamma som Impact Navigator: underlag → AI-steg → mänsklig
granskning → AI-steg → plan → versionerade uppdateringar.

## 2. Forskningsgrund (det modellen får resonera med)

| Nyckel | Modell | Källa | Används till |
|---|---|---|---|
| `uppsala` | Uppsala-modellen | Johanson & Vahlne (1977; 2009) | Stegvis engagemang, psykisk distans, nätverkets insiderposition |
| `born_global` | Born Global / International New Ventures | Oviatt & McDougall (1994); Knight & Cavusgil (2004) | När tidig, parallell internationalisering är rimlig |
| `cage` | CAGE-distans | Ghemawat (2001) | Marknadsval: kulturell, administrativ, geografisk, ekonomisk distans från Sverige |
| `hofstede_meyer` | Hofstedes kulturdimensioner, Meyers Culture Map | Hofstede (1980/2010); Meyer (2014) | Kulturell spelbok per marknad: kommunikation, beslut, förtroende, tid, hierarki |
| `entry_mode` | Val av inträdesform | Root (1994); Anderson & Gatignon (1986); Dunning (OLI) | Agent/distributör, direkt export, licens, partnerskap, dotterbolag, digital plattform |
| `market_screening` | Marknadsurval i tre steg | Cavusgil (1985); Kumar m.fl. (1994) | Makro → bransch → bolag |
| `effectuation` | Effectuation / lean internationalisering | Sarasvathy (2001); Blank (2013) | Principer för tidiga bolag: befintliga medel, acceptabel förlust, billiga tester |
| `export_readiness` | Exportmognad | Cavusgil & Nevin (1981); Business Sweden/EEN | Sex mognadsdimensioner innan första exportsteget |
| `kth_irl` | KTH Innovation Readiness Level | KTH Innovation | Framdrift och grindar inför pilot |

Listan är `EXPORT_FRAMEWORKS` i `packages/shared/src/export-lab.ts`, skrivs in i
systemprompten och visas för personalen. Lägg aldrig till ett ramverk i
prompten utan att lägga det här med källa.

### Exportmognad (fem nivåer)

`EXPLORE` Utforskar → `PREPARE` Förbereder → `PILOT` Pilotexport →
`ESTABLISH` Etablerar → `SCALE` Skalar internationellt. Kriterierna står i
`EXPORT_READINESS_LEVEL_CRITERIA`.

### IRL-grindar (Movexums arbetshypotes inför en första pilotexport)

| Axel | Riktvärde | Varför |
|---|---|---|
| CRL (kund) | ≥ 5 | Etablerat kundintresse hemma innan samma sak prövas utomlands |
| TRL (teknik) | ≥ 6 | Demonstrerad i relevant miljö — pilotkunden utomlands ska inte vara första testet |
| BRL (affär) | ≥ 5 | Affärsmodell testad mot kunder med första intäktsmodell |
| TMRL (team) | ≥ 4 | Kärnteam med kompletterande kompetens som orkar två marknader |
| FRL (finansiering) | ≥ 4 | Kapital för längre säljcykler, resor och anpassning |
| IPRL (IPR) | ≥ 4 | IP-strategi formulerad innan erbjudandet visas för partners/konkurrenter |

Grindarna är coachande riktvärden, inte spärrar (`EXPORT_IRL_GATES`,
`evaluateExportIrlGates`). `suggestExportReadinessFromIrl` ger en
deterministisk nivåledtråd ur den svagaste av kund/affär/teknik, dämpad av
team/finansiering. Justera trösklarna när Movexum har erfarenhet — ändringen
ska synas här och i testet.

## 3. Kodkarta

| Fil | Syfte |
|---|---|
| `packages/shared/src/export-lab.ts` (+ test) | Vokabulär, ramverk, nivåer, dimensioner, CAGE, regelverkskatalog, kulturdimensioner, typer, normalisering, marknadsgranskning, IRL-grindar, statusmaskin |
| `packages/shared/src/export-lab-prompts.ts` | Systempromptar per steg + outputformat (`EXPORT_PROMPT_VERSION`) |
| `packages/shared/src/export-lab-inputs.ts` | Underlagsbyggare (state-plus-delta, IRL-kontext) |
| `packages/shared/src/export-lab-mock.ts` | Deterministiskt mockläge |
| `packages/shared/src/analysis-lease.ts` | Generiskt analys-lease (samma format som Impact Navigator) |
| `backend/pocketbase-schema/migrations/1700000210_create_export_lab.js` | Schema + RLS; `1700000211` backfillar sidmenyn |
| `apps/web/src/lib/ai/export-analysis.ts`, `export-runtime.ts` | Fyra Mistral-steg (JSON-läge), mock, tidsgräns/omförsök |
| `apps/web/src/lib/export-lab/{data,shell,tabs,messages,irl.server,report-pdf}.ts(x)` | Läsväg, sidskal, sökvägar, fel, IRL-läsning, PDF |
| `apps/web/src/lib/actions/export-lab.ts` | Server actions (RBAC, lease, budget, audit) |
| `apps/web/src/app/exportlab/**`, `app/api/exportlab/**` | Sidor och route handlers |
| `apps/web/src/components/exportlab/*` | Chips, Stepper, sidomeny, IRL-kort, planvy, bolagskortssektion |

## 4. Köra lokalt

Utan `MISTRAL_API_KEY` (och `NODE_ENV` ≠ production) körs mockläget
automatiskt, eller tvinga det med `EXPORT_LAB_AI_MOCK_MODE=true`. Kör
migration 1700000210–1700000211 (PB auto-migrate eller "Sync PocketBase").
Flöde: `/exportlab/ny` → välj ett bolagskort med IRL-bedömning → granska
marknader → svara på frågor → plan → PDF.

## 5. Avgränsningar

Ingen automatisk hämtning av marknadsdata (tullsatser, Hofstede-poäng,
regelverkstexter) — allt modellen inte vet markeras som "verifiera".
Kulturella generaliseringar är på landsnivå och ska läsas som utgångspunkt
för samtal, inte sanning om individer. Modulen är inte juridisk, tull- eller
skatterådgivning.
