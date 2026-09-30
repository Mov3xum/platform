import 'server-only';
import type { Role } from '@platform/shared';
import type { Actor } from './types';

/**
 * Fält-whitelist per (collection, field) med separata policies för
 * mänskliga aktörer och agenter. **Agent-whitelisten är alltid en
 * delmängd av människo-whitelisten** — en agent får aldrig göra mer
 * än någon roll får göra. Detta är källan av sanning; alla
 * skrivningar (UI + agent) går genom `canWriteField` som konsulterar
 * denna tabell.
 *
 * Att lägga till nya skrivbara fält:
 *   1. Lägg till entry här
 *   2. Lägg till validator i `validators.ts` om värdet behöver formgranskas
 *   3. Lägg till mappning i kärnfunktionen för aktuell collection
 */

type UserPolicy =
  | { kind: 'any-role' }
  | { kind: 'roles'; roles: Role[] };

type AgentPolicy = { kind: 'allow' } | { kind: 'deny'; reason: string };

interface FieldPolicy {
  user: UserPolicy;
  agent: AgentPolicy;
}

const STAFF_AND_COACH: Role[] = ['admin', 'incubator_lead', 'coach'];
// Årshjulet är intern verksamhetsplanering — hela Movexum-staben redigerar.
const STAFF_FULL: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
// Startupkompassen hanteras av admin/incubator_lead/coach (samma krets som
// `MANAGE_ROLES` i lib/actions/compass.ts, § 23).
const COMPASS_MANAGE: Role[] = ['admin', 'incubator_lead', 'coach'];
// Events skapas av admin/incubator_lead/coach (speglar incubator_events
// createRule-kretsen, § 18.4).
const EVENT_MANAGE: Role[] = ['admin', 'incubator_lead', 'coach'];
// Schemaläggning av AI-agenter är admin/incubator_lead (§ 12.2).
const SCHEDULE_MANAGE: Role[] = ['admin', 'incubator_lead'];

const POLICIES: Record<string, Record<string, FieldPolicy>> = {
  startups: {
    next_step: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'allow' }
    },
    irl_level: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'allow' }
    },
    // Phase och status får agenten INTE skriva i denna fas — det kräver
    // state-machine-validering (roadmap-steg 2). Människor får, men
    // även deras skrivningar loggas i agent_actions.
    phase: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Kräver state-machine — kommer i nästa fas.' }
    },
    status: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Kräver state-machine — kommer i nästa fas.' }
    },
    name: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Bolagsnamn ändras inte av agent.' }
    },
    description: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Beskrivning ändras inte av agent i MVP.' }
    },
    tags: {
      user: { kind: 'roles', roles: STAFF_AND_COACH },
      agent: { kind: 'deny', reason: 'Taggar ändras inte av agent i MVP.' }
    }
  },
  activities: {
    title: {
      user: { kind: 'any-role' },
      agent: { kind: 'allow' }
    },
    description: {
      user: { kind: 'any-role' },
      agent: { kind: 'allow' }
    },
    status: {
      user: { kind: 'any-role' },
      agent: { kind: 'allow' }
    },
    // Förfallodatum redigeras i "Mina uppgifter" (§ 40). Agentens verktygsyta
    // (`update_activity_field`: title/description/status) är oförändrad.
    due_date: {
      user: { kind: 'any-role' },
      agent: { kind: 'deny', reason: 'Förfallodatum på aktiviteter sätts av en människa i UI:t.' }
    }
  },
  // Årshjul (§ 30). Hela aktiviteten är icke-PII verksamhetsplanering, så
  // agenten får uppdatera alla fält (människa-i-loopen i staff-chatten).
  annual_wheel_items: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    month: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    day: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    // Kampanjperioder (migration 1700000141): slutmånad/-dag.
    end_month: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    end_day: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    tags: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    category: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    // Ansvarig pekar ut en intern användare. Agenten kan inte slå upp
    // användar-id:n (`users` är denylistad, § 9.3) och ska inte gissa vem som
    // äger en aktivitet → människan sätter ansvarig i UI:t.
    responsible: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Ansvarig sätts av en människa i årshjulet.' }
    },
    notes: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    year: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } }
  },
  // Startupkompassens intag-moduler (§ 23, § 31). Ren modulkonfiguration —
  // ingen besökardata, ingen PII. Publiceringsfälten (`is_active`,
  // `public_url_enabled`) är MEDVETET agent-nekade: att lägga ut en modul
  // publikt på webben är ett mänskligt beslut i modul-admin.
  compass_modules: {
    name: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    intro_message: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    success_message: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    target_audience: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    consent_note: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    flow_type: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    // Mall för den publika sidan (§ 23.7) — ren presentation, normaliseras
    // (okänt ⇒ classic) i skrivlagret.
    layout: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    is_active: {
      user: { kind: 'roles', roles: COMPASS_MANAGE },
      agent: { kind: 'deny', reason: 'Publicering av en modul görs av en människa i modul-admin.' }
    },
    public_url_enabled: {
      user: { kind: 'roles', roles: COMPASS_MANAGE },
      agent: { kind: 'deny', reason: 'Publik URL slås på av en människa i modul-admin.' }
    }
  },
  // Frågor i en intag-modul. `key` och `input_type` sätts vid skapandet och
  // ändras inte i efterhand — svar som redan samlats in refererar dem.
  compass_questions: {
    prompt: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    help_text: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    required: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } }
  },
  // Kanban-kort (§ 15.7/§ 29.4). Agenten får flytta kort mellan kolumner
  // ("markera LOI-uppföljningen som klar"). Tilldelning av kollegor
  // (`assignees`) är MEDVETET inte skrivbar för agenten — den kan inte slå
  // upp användar-id:n (`users` är denylistad, § 9.3) och ska inte gissa.
  tasks: {
    status: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } }
  },
  // ── Stödcheckar & finansieringsprojekt (§ 46) ─────────────────────────────
  // Ledningen (admin/incubator_lead) äger projekt, checktyper och regler;
  // agenten får skapa UTKAST (checktyp inaktiv, ansökan i status draft) men
  // aldrig publicera en checktyp (`active`), skriva bedömningens spelregler
  // (`criteria`) eller röra statusar, utlåtanden, finansiering och beslut.
  funding_projects: {
    title: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    kind: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    status: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    funder: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    diarienummer: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    budget_sek: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    starts_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    ends_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    default_state_aid_basis: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    default_stodgivare: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    responsible: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Ansvarig sätts av en människa i /projekt.' } },
  },
  funding_work_packages: {
    code: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    title: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    budget_sek: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    starts_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    ends_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    sort_order: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
  },
  support_check_types: {
    title: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    kind: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    active: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'En checktyp öppnas för ansökningar av en människa i /checkar/typer — agenten skapar den som inaktivt utkast.' } },
    max_amount_sek: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    funding_project: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    default_work_package: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    default_state_aid_basis: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    requires_workshop: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    min_irl_level: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    requires_final_report: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    report_due_days: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    changes_due_days: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    is_excellence_activity: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    criteria: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Bedömningskriterierna är bedömningens spelregler och sätts av en människa i /checkar/typer (standardkriterierna används tills dess).' } },
    opens_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    closes_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    sort_order: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
  },
  support_check_applications: {
    title: { user: { kind: 'any-role' }, agent: { kind: 'allow' } },
    activities: { user: { kind: 'any-role' }, agent: { kind: 'allow' } },
    requested_amount_sek: { user: { kind: 'any-role' }, agent: { kind: 'allow' } },
    activity_end_date: { user: { kind: 'any-role' }, agent: { kind: 'allow' } },
    applicant_note: { user: { kind: 'any-role' }, agent: { kind: 'allow' } },
    status: { user: { kind: 'any-role' }, agent: { kind: 'deny', reason: 'Statusövergångar görs av människor: bolaget skickar in/signerar, staff bedömer, ledningen beslutar.' } },
    coach_statement: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Coachutlåtandet skrivs av coachen i /checkar (agenten kan föreslå ett utkast i text).' } },
    controller_statement: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Controllerutlåtandet skrivs av controllern i /checkar.' } },
    assessment_scores: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Bedömningspoängen sätts av granskaren i /checkar.' } },
    changes_request_note: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Komplettering begärs av granskaren i /checkar.' } },
    funding_project: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Finansieringen (projekt/arbetspaket/statsstödsgrund) är ett ekonomiskt beslut som en människa tar i /checkar.' } },
    funding_work_package: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Finansieringen sätts av en människa i /checkar.' } },
    state_aid_basis: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Statsstödsgrunden sätts av en människa i /checkar.' } },
    funding_note: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Finansieringen sätts av en människa i /checkar.' } },
    approved_amount_sek: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Beviljat belopp beslutas av en människa i /checkar.' } },
    decision_note: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Beslutet fattas av beslutsgruppen i /checkar.' } },
    paid_at: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Utbetalning registreras av en människa i /checkar.' } },
    paid_amount_sek: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Utbetalning registreras av en människa i /checkar.' } },
    paid_note: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Utbetalning registreras av en människa i /checkar.' } },
    final_report_received_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Slutrapport bockas av i /checkar.' } },
  },
  support_check_comments: {
    body: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Kompletteringspunkter skrivs av granskaren i /checkar.' } },
    resolved_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Punkter bockas av i /checkar.' } }
  },
  support_check_rules: {
    name: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /checkar/regler.' } },
    active: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /checkar/regler.' } }
  },
  // Upphandlingar (§ 39). Intern inköps-/avtalsdata utan PII — agenten får
  // uppdatera sakfälten (status, datum, belopp) å den inloggades vägnar.
  // Utvärderingskriterier, avtalskoppling och ansvarig är mänskliga beslut
  // (kriterierna är utvärderingens spelregler; ansvarig kräver användar-id).
  procurements: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    supplier: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    procedure: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    diarienummer: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    status: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    tender_deadline: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    contract_start: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    contract_end: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    extension_option_months: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    estimated_value_sek: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    estimated_calloffs: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    is_excellence_activity: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    notes: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    evaluation_criteria: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Utvärderingskriterier sätts av en människa på upphandlingen.' }
    },
    agreement: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Avtalskopplingen väljs av en människa på upphandlingen.' }
    },
    responsible: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Ansvarig sätts av en människa på upphandlingen.' }
    }
  },
  // Avrop per bolag. Milstolpar godkänns ("godkänn milstolpe 1 för Fixkod")
  // och slutrapport bockas av via chatten — datumet är den inloggades
  // uttryckliga beslut. Själva UTVÄRDERINGEN (poäng + omdöme) är ett
  // mänskligt omdöme om leverantören och görs i UI:t.
  procurement_calloffs: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    status: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    started_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    ends_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    milestone_1_due: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    milestone_1_approved_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    milestone_2_due: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    milestone_2_approved_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    final_report_received_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    amount_sek: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    movexum_share_pct: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    state_aid_relevant: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    is_excellence_activity: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    notes: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    startup: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Bolaget på ett avrop byts av en människa i UI:t.' }
    },
    evaluation_scores: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Utvärderingen av leverantören poängsätts av en människa i UI:t.' }
    },
    evaluation_summary: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Utvärderingens omdöme skrivs av en människa i UI:t.' }
    }
  },
  // Uppföljningsregler är styrning (vad systemet gör automatiskt) — sätts av
  // admin/incubator_lead i UI:t, aldrig av agenten.
  procurement_rules: {
    name: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    scope: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    anchor: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    offset_days: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    repeat: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    condition: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    applies_to: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    task_title: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    task_kind: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } },
    active: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' } }
  },
  // Workshops (§ 18). Agenten får förbereda innehåll i ett UTKAST; att
  // publicera och tilldela bolag är mänskliga beslut.
  workshops: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    goal: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    instructions: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    status: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Publicering av en workshop görs av en människa i /education.' }
    },
    active: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Aktivering av en workshop görs av en människa i /education.' }
    }
  },
  // Marknadsverktyget → Utvärdering (§ 47): digitala enkäter. Agenten får
  // bygga innehållet (namn, texter, frågor) som OPUBLICERAD enkät; att
  // publicera (/u/<slug> börjar ta emot svar) och skicka ut till deltagare
  // är mänskliga beslut i byggaren. Samma krets som `MANAGE_ROLES` i
  // lib/actions/surveys.ts.
  surveys: {
    name: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    kind: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    welcome_title: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    welcome_body: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    thank_you_message: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    questions: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    link_kind: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    link_id: { user: { kind: 'roles', roles: COMPASS_MANAGE }, agent: { kind: 'allow' } },
    is_active: {
      user: { kind: 'roles', roles: COMPASS_MANAGE },
      agent: { kind: 'deny', reason: 'Publicering av en enkät görs av en människa i /inflode/utvardering.' }
    },
    send_at: {
      user: { kind: 'roles', roles: COMPASS_MANAGE },
      agent: { kind: 'deny', reason: 'Utskick till deltagare schemaläggs av en människa i /inflode/utvardering (§ 47.5).' }
    }
  },
  // Kontaktboken (§ 45). Verksamhetsfälten får agenten uppdatera; direkt-PII
  // (e-post/telefon) skrivs av en människa i UI:t (agenten kan inte verifiera
  // uppgifterna och ska inte gissa), `gender` är GDPR art. 9 (agent-nekad,
  // § 9.3) och `owners` kräver användar-id:n agenten inte kan slå upp
  // (`users` denylistad).
  contacts: {
    first_name: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    last_name: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    organization: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    primary_role: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    category: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    kommun: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    skills: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    info: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    email: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Kontaktuppgifter (e-post) ändras av en människa i kontaktboken.' }
    },
    phone: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Kontaktuppgifter (telefon) ändras av en människa i kontaktboken.' }
    },
    owners: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Kontaktägare sätts av en människa i kontaktboken.' }
    },
    gender: {
      // GDPR art. 9 — bara admin/incubator_lead/coach (§ 45.7), inte mentor.
      user: { kind: 'roles', roles: ['admin', 'incubator_lead', 'coach'] },
      agent: { kind: 'deny', reason: 'Kön (GDPR art. 9) registreras aldrig av agenten.' }
    }
  },
  // dashboardens inlägg (§ 37). Alla fält får ändras av författar-kretsen; agenten
  // ärver rollen. Publiceringsfälten är ofarliga här (inlägget är internt).
  org_posts: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    body: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    kind: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    audience: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    pinned: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    published_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    expires_at: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    link_url: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    // Bilder/film/dokument laddas upp av en människa i UI:t (§ 37.6); agenten
    // kan inte ladda upp filer och får inte peka om bilagor.
    media: {
      user: { kind: 'roles', roles: STAFF_FULL },
      agent: { kind: 'deny', reason: 'Media på inlägg laddas upp av en människa på startsidan.' }
    }
  },
  // ── Målstyrning & verksamhetsplan (§ 42) ─────────────────────────────────
  // Verksamhetsår, mål och indikatorer ägs av ledningen (VP-beslut); status
  // rapporteras av hela staben. Måltal (`target`) och metriknyckel sätts
  // ALDRIG av agenten — den föreslår i text, människan beslutar.
  goal_periods: {
    status: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Verksamhetsårets status (utkast/aktiv/avslutad) ändras av en människa i /mal.' } },
    title: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    year: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Årtalet på ett verksamhetsår ändras av en människa i /mal.' } }
  },
  // `goals`: rollpolicyn är hela staben eftersom PERSONLIGA mål ägs av en
  // enskild medarbetare; skrivlagret (`canManageGoal`/`canCreateGoalOfKind`
  // i @platform/shared) avgör att övergripande mål bara rörs av ledningen
  // och personliga bara av ägaren eller ledningen.
  goals: {
    title: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    description: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    focus_area: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    owner_team: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    kind: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    // Agenten kan inte slå upp användar-id:n (`users` denylistad § 9.3); ett
    // personligt mål via chatten blir alltid den inloggades eget (skrivlagret
    // sätter ägaren), aldrig någon annans.
    owner_user: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Ägaren av ett personligt mål väljs av en människa i /mal — via chatten blir målet ditt eget.' } }
  },
  goal_indicators: {
    label: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    source: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    metric_key: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    target: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'deny', reason: 'Måltal beslutas av ledningen i /mal — agenten föreslår i text.' } },
    unit: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } },
    direction: { user: { kind: 'roles', roles: SCHEDULE_MANAGE }, agent: { kind: 'allow' } }
  },
  goal_status_entries: {
    status: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    comment: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'allow' } },
    // Manuellt värde = mänsklig bedömning; beräknade värden hämtar skrivlagret själv ur registret.
    value: { user: { kind: 'roles', roles: STAFF_FULL }, agent: { kind: 'deny', reason: 'Uppmätta värden anges av en människa (eller räknas ur data) — inte av agenten.' } }
  }
};

/** Vilka collections som har create-stöd via det delade lagret. */
const CREATE_POLICIES: Record<
  string,
  { user: UserPolicy; agent: AgentPolicy }
> = {
  activities: {
    user: { kind: 'any-role' },
    agent: { kind: 'allow' }
  },
  // Kontaktboken (§ 45) — hela staff-kretsen lägger in kontakter och skickar
  // förfrågningar; agenten ärver rollen. Ägare/kön får agenten aldrig sätta
  // (fältpolicyn ovan); GDPR-samtycke krävs i skrivlagret.
  contacts: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  contact_requests: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  // Upphandlingar & avrop (§ 39) — registreras av staff; agenten ärver rollen.
  procurements: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  procurement_calloffs: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  procurement_rules: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /upphandlingar/regler.' }
  },
  annual_wheel_items: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  // Stödcheckar & finansieringsprojekt (§ 46). Projekt/arbetspaket/checktyper
  // = ledning (admin/incubator_lead). Ansökningar skapas av bolagsmedlem
  // (länkat bolag verifieras i skrivlagret) eller staff; agenten får skapa
  // ett UTKAST å ett bolags vägnar men aldrig skicka in/signera (mänsklig
  // firmatecknare, eIDAS). Kommentarer = staff; regler = ledning.
  funding_projects: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'allow' }
  },
  funding_work_packages: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'allow' }
  },
  support_check_types: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'allow' }
  },
  support_check_applications: {
    user: { kind: 'any-role' },
    agent: { kind: 'allow' }
  },
  support_check_comments: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'deny', reason: 'Kompletteringspunkter skrivs av granskaren i /checkar.' }
  },
  support_check_rules: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'deny', reason: 'Uppföljningsregler sätts av en människa i /checkar/regler.' }
  },
  // Målstyrning (§ 42): år/mål/indikatorer = ledning; kvartalsstatus = staben.
  goal_periods: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'deny', reason: 'Ett verksamhetsår skapas av en människa i /mal.' }
  },
  goals: {
    // Staben skapar personliga mål; övergripande kräver ledning (skrivlagret).
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  goal_indicators: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'allow' }
  },
  goal_status_entries: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  compass_modules: {
    user: { kind: 'roles', roles: COMPASS_MANAGE },
    agent: { kind: 'allow' }
  },
  compass_questions: {
    user: { kind: 'roles', roles: COMPASS_MANAGE },
    agent: { kind: 'allow' }
  },
  workshops: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  // Enkäter under Marknadsverktyget → Utvärdering (§ 47) skapas OPUBLICERADE.
  surveys: {
    user: { kind: 'roles', roles: COMPASS_MANAGE },
    agent: { kind: 'allow' }
  },
  // ── Utökad chatt-skrivyta (§ 33) ─────────────────────────────────────────
  // Tilldelningar är verkliga åtgärder mot bolag — hela staff-kretsen får
  // (samma som UI-actions), agenten kör å den inloggades vägnar.
  workshop_assignments: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  education_document_assignments: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  tasks: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  incubator_events: {
    user: { kind: 'roles', roles: EVENT_MANAGE },
    agent: { kind: 'allow' }
  },
  // dashboardens inlägg (§ 37): anslagstavla, "Så gör vi" och internutbildningar.
  // Samma krets som ORG_POST_AUTHOR_ROLES; ändring kräver dessutom
  // canEditOrgPost (författare/moderator) i skrivlagret.
  org_posts: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  // Uppdrag skapas som UTKAST (status 'draft') av agenten — teamet kopplas på
  // och uppdraget startas av en människa i /uppdrag (§ 29).
  missions: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  // De minimis-registrering går genom samma kanBevilja-spärr som UI:t (§ 20)
  // — taket kan aldrig rundas via chatten.
  de_minimis_stod: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  startup_kpis: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  capital_rounds: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  },
  tool_schedules: {
    user: { kind: 'roles', roles: SCHEDULE_MANAGE },
    agent: { kind: 'allow' }
  },
  // Anteckningar via chatten är ALLTID icke-konfidentiella (confidential=false
  // tvingas i skrivlagret) — konfidentiella anteckningar skrivs i UI:t.
  notes: {
    user: { kind: 'roles', roles: STAFF_FULL },
    agent: { kind: 'allow' }
  }
};

function matchUserPolicy(roles: Role[], policy: UserPolicy): boolean {
  if (policy.kind === 'any-role') return roles.length > 0;
  return roles.some((r) => policy.roles.includes(r));
}

export interface PolicyResult {
  ok: boolean;
  reason?: string;
}

export function canWriteField(
  actor: Actor,
  collection: string,
  field: string
): PolicyResult {
  const collectionPolicy = POLICIES[collection];
  if (!collectionPolicy) {
    return { ok: false, reason: `Kollektion '${collection}' är inte skrivbar via det delade lagret.` };
  }
  const fieldPolicy = collectionPolicy[field];
  if (!fieldPolicy) {
    return { ok: false, reason: `Fältet '${collection}.${field}' är inte whitelistat för skrivning.` };
  }

  if (actor.kind === 'agent' && fieldPolicy.agent.kind === 'deny') {
    return { ok: false, reason: fieldPolicy.agent.reason };
  }

  // Rollkravet gäller BÅDA aktörstyperna: en agent kör alltid å en inloggad
  // människas vägnar (`actor.roles` = den triggande användarens roller), så
  // agent-whitelisten förblir en äkta delmängd av människo-whitelisten — en
  // mentor kan inte via chatten göra det hen inte får göra i UI:t
  // (ISO 27001 A.5.15–A.5.18 minsta behörighet).
  if (!matchUserPolicy(actor.roles, fieldPolicy.user)) {
    return { ok: false, reason: `Saknar roll för att skriva '${collection}.${field}'.` };
  }
  return { ok: true };
}

export function canCreateRecord(actor: Actor, collection: string): PolicyResult {
  const policy = CREATE_POLICIES[collection];
  if (!policy) {
    return { ok: false, reason: `Kollektion '${collection}' stöder inte create via det delade lagret.` };
  }
  if (actor.kind === 'agent' && policy.agent.kind === 'deny') {
    return { ok: false, reason: policy.agent.reason };
  }
  // Se `canWriteField`: rollkravet gäller även agent-aktörer.
  if (!matchUserPolicy(actor.roles, policy.user)) {
    return { ok: false, reason: `Saknar roll för att skapa i '${collection}'.` };
  }
  return { ok: true };
}

/** Lista över fält som agenten får skriva i en collection — används för
 * att generera tool-schemat för LLM:en. */
export function agentWritableFields(collection: string): string[] {
  const collectionPolicy = POLICIES[collection];
  if (!collectionPolicy) return [];
  return Object.entries(collectionPolicy)
    .filter(([, p]) => p.agent.kind === 'allow')
    .map(([f]) => f);
}

/** Lista över collections agenten får skapa rader i. */
export function agentCreatableCollections(): string[] {
  return Object.entries(CREATE_POLICIES)
    .filter(([, p]) => p.agent.kind === 'allow')
    .map(([c]) => c);
}
