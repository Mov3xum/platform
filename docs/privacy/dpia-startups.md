# DPIA — särskilda kategorier på `startups` (`founder_gender`, `founder_identifies_as`)

**Behandling:** frivilliga grundarprofil-fält på bolagskortet för Vinnovas
statistik om könsfördelning i statsstödsprogram (CLAUDE.md § 10.2, § 9.4).

**Datum:** 2026-09-29 (första versionen i repo; ersätter hänvisningen i
CLAUDE.md § 10.2) · **Status:** levande dokument.

---

## 1. Beskrivning

| Aspekt | Beskrivning |
| --- | --- |
| Personuppgifter | `founder_gender` (kvinna/man/icke_binar/uppger_ej), `founder_identifies_as` (fritext) — GDPR art. 9 (kan avslöja etnicitet/läggning). |
| Registrerade | Grundare i inkubatorbolag. |
| Rättslig grund | Berättigat intresse (rapportering till Vinnova om könsfördelning) + uttryckligt samtycke vid intag (art. 9.2 a). Fälten är frivilliga. |
| Åtkomst | Visas bara för admin/incubator_lead/coach på bolagskortet. Fältmaskas i AI:ns query-verktyg (`redaction.ts`) och är svartlistade i den kurerade AI-kontexten (`context.ts`). Loggas aldrig i klartext. |

## 2. Aggregat i målstyrningen (§ 41–§ 42)

Verksamhetsmålet "≥ 40 % kvinnor/mixade team i programmen" mäts som metriken
`women_led_share` i metrikregistret. Kontroller:

- **Bara räknare lämnar databasen** (två `totalItems`-anrop), inga rader.
- **Strikt k-anonymitet:** `shareWithThreshold` ger `null` när nämnaren < 5
  OCH när någon av grupperna (kvinnliga grundare / övriga) är < 5 — en
  homogen grupp (0 % eller 100 %) skulle annars avslöja varje bolag.
- **Varken räknare eller nämnare** returneras från metriken.
- **Ingen snapshot:** indikatorer över metriken persisterar aldrig värdet i
  `goal_status_entries` (skillnader mellan kvartal kan inte räknas ut);
  värdet räknas live i `/mal` **bara** för admin/incubator_lead/coach.
- **Aldrig till agenten:** metriken kan inte väljas via chatt-verktygen,
  värdet utelämnas ur verktygssvar och audit-rader.

## 3. Restrisk

Låg. Omprövas om fler art. 9-mått läggs till eller om aggregat ska
exporteras utanför plattformen.
