import { requireUser } from '@/lib/auth.server';
import { IntegrationActivateButton } from './IntegrationActivateButton';

// ─── Types ────────────────────────────────────────────────────────────────────

type IntegrationCategory =
  | 'microsoft365'
  | 'ai'
  | 'collaboration'
  | 'communication'
  | 'productivity';

interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  placeholder: string;
  tagline: string;
  description: string;
  features: string[];
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const INTEGRATIONS: Integration[] = [
  // Microsoft 365
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'microsoft365',
    placeholder: 'MT',
    tagline: 'Realtidskommunikation & möten',
    description:
      'Anslut Teams för att synka möten, kanaler och filer direkt med startup-profiler och aktivitetsfeeden. Få notiser i Teams när milstolpar loggas eller mötesprotokoll skapas.',
    features: [
      'Möten synkas till aktivitetsfeeden',
      'Kanalaviseringar vid uppdateringar',
      'Fildeling länkad till startup-rum',
      'SSO via Azure AD',
    ]
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    category: 'microsoft365',
    placeholder: 'SP',
    tagline: 'Dokumenthantering & intranät',
    description:
      'Koppla era SharePoint-bibliotek till plattformens projektrum. Avtal, presentationer och rapporter blir automatiskt tillgängliga under rätt startup utan manuell uppladdning.',
    features: [
      'Dokumentbibliotek synkade per startup',
      'Versionskontroll bevaras',
      'Sök i SharePoint direkt från plattformen',
      'Granulär behörighet per team',
    ]
  },
  {
    id: 'outlook',
    name: 'Outlook & Kalender',
    category: 'microsoft365',
    placeholder: 'OK',
    tagline: 'E-post, kalender & bokning',
    description:
      'Synka kalender och e-post automatiskt. Bokade möten med bolag dyker upp i aktivitetsfeeden och coacher kan se alla schemalagda sessions utan att lämna plattformen.',
    features: [
      'Kalendersynk med startup-möten',
      'E-posttrådar kopplade till bolagsprofil',
      'Mötesbokningar direkt i plattformen',
      'Påminnelser och uppföljningsflöden',
    ]
  },

  // AI & Analys
  {
    id: 'klang',
    name: 'Klang AI',
    category: 'ai',
    placeholder: 'KA',
    tagline: 'Kommunikationsanalys & teamdynamik',
    description:
      'Klang AI kartlägger stämning, engagemang och kommunikationsmönster i realtid. Identifiera tidiga signaler på friktion eller drivkraft i bolagsteam innan de eskalerar.',
    features: [
      'Stämningsanalys per team och möte',
      'Engagemangsmätning över tid',
      'Anonymiserade insiktsrapporter',
      'EU-suveränt — data stannar i Europa',
    ]
  },

  // Samarbete & Whiteboarding
  {
    id: 'miro',
    name: 'Miro',
    category: 'collaboration',
    placeholder: 'MI',
    tagline: 'Digital whiteboard & workshops',
    description:
      'Länka Miro-tavlor direkt till startup-profiler. Workshops, business model canvases och roadmaps är alltid ett klick bort från bolagskortet — och visas i aktivitetsfeeden.',
    features: [
      'Tavlor kopplade till startup-profil',
      'Aktivitetslogg när tavlor uppdateras',
      'Inbäddad förhandsvisning i plattformen',
      'Delade mallar för inkubatorworkshops',
    ]
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'collaboration',
    placeholder: 'NO',
    tagline: 'Kunskapsbas & projektdokumentation',
    description:
      'Synka Notion-sidor med plattformens dokumentsektion. Intern wiki, processdokumentation och projektplaner visas automatiskt under rätt bolag eller inkubatorresurs.',
    features: [
      'Sidor länkade per startup och projekt',
      'Sökning i Notion via plattformen',
      'Automatisk taggning med bolagsnyckelord',
      'Offline-cache för kritisk dokumentation',
    ]
  },

  // Kommunikation
  {
    id: 'slack',
    name: 'Slack',
    category: 'communication',
    placeholder: 'SL',
    tagline: 'Kanalbaserad teamkommunikation',
    description:
      'Automatiska notiser från plattformen hamnar i rätt Slack-kanal. Milstolpar, dokumentuppladdningar och AI-rapporter skickas dit teamet redan är — utan att man behöver logga in.',
    features: [
      'Anpassade notisregler per kanal',
      'Sammanfattningar skickas automatiskt',
      'Slash-kommandon för snabb bolagssökning',
      'Länk tillbaka till plattformen i varje meddelande',
    ]
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'communication',
    placeholder: 'ZO',
    tagline: 'Videokonferenser & inspelningar',
    description:
      'Boka Zoom-möten direkt från bolagskortet. Inspelningar och transkriptioner sparas automatiskt under rätt startup i aktivitetsfeeden och kan processas av AI-verktygen.',
    features: [
      'Mötesbokningar från plattformen',
      'Inspelningar länkade till startup',
      'Transkriptioner för AI-analys',
      'Schemalagda coachingmöten med påminnelser',
    ]
  },

  // Produktivitet
  {
    id: 'google',
    name: 'Google Workspace',
    category: 'productivity',
    placeholder: 'GW',
    tagline: 'Gmail, Drive & Docs',
    description:
      'Välj Google Workspace som alternativ till Microsoft 365. Gmail, Drive, Docs och Kalender synkas med plattformen — samma kraftfulla integration, er valfria ekosystem.',
    features: [
      'Google Drive-mappar per startup',
      'Kalendersynk och mötesbokningar',
      'Docs och Sheets länkade till profiler',
      'SSO via Google Identity',
    ]
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'productivity',
    placeholder: 'GH',
    tagline: 'Kodbaser, issues & CI/CD',
    description:
      'Länka GitHub-repositories till startup-profiler. Pull requests, releases och issues dyker upp i aktivitetsfeeden och ger coacher och investerare teknisk insyn utan att öppna GitHub.',
    features: [
      'Repositories kopplade per startup',
      'PR-aktivitet i aktivitetsfeeden',
      'Issue-status på bolagskortet',
      'CI/CD-status vid releaser',
    ]
  }
];

// ─── Category config ───────────────────────────────────────────────────────────

const CATEGORIES: Record<IntegrationCategory, {
  label: string;
  description: string;
  accentBg: string;
  badgeClass: string;
  cardAccent: string;
}> = {
  microsoft365: {
    label: 'Microsoft 365',
    description: 'Teams, SharePoint och Outlook för organisationer i Microsoft-ekosystemet.',
    accentBg: 'bg-movexum-pastell-bla dark:bg-movexum-morkbla/30',
    badgeClass: 'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/50 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
    cardAccent: 'bg-movexum-pastell-bla dark:bg-movexum-morkbla/40',
  },
  ai: {
    label: 'AI & Analys',
    description: 'EU-suveräna AI-tjänster för djupare insikt om era bolag och team.',
    accentBg: 'bg-movexum-pastell-lila dark:bg-movexum-morklila/30',
    badgeClass: 'bg-movexum-pastell-lila text-movexum-morklila ring-movexum-ljuslila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila dark:ring-movexum-lila',
    cardAccent: 'bg-movexum-pastell-lila dark:bg-movexum-morklila/40',
  },
  collaboration: {
    label: 'Samarbete & Whiteboarding',
    description: 'Visuella samarbetsverktyg och kunskapsbaser för era startup-team.',
    accentBg: 'bg-movexum-pastell-gul dark:bg-movexum-morkgul/20',
    badgeClass: 'bg-movexum-pastell-gul text-movexum-morkgul ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul dark:ring-movexum-morkgul',
    cardAccent: 'bg-movexum-pastell-gul dark:bg-movexum-morkgul/30',
  },
  communication: {
    label: 'Kommunikation',
    description: 'Synka er kommunikationsplattform och håll alla uppdaterade utan extraarbete.',
    accentBg: 'bg-movexum-pastell-gron dark:bg-movexum-morkgron/30',
    badgeClass: 'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
    cardAccent: 'bg-movexum-pastell-gron dark:bg-movexum-morkgron/40',
  },
  productivity: {
    label: 'Produktivitet & Utveckling',
    description: 'Kodbaser, arbetsytor och alternativa kontorspaketen för er teknikdrivna verksamhet.',
    accentBg: 'bg-movexum-pastell-orange dark:bg-movexum-morkorange/30',
    badgeClass: 'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange',
    cardAccent: 'bg-movexum-pastell-orange dark:bg-movexum-morkorange/40',
  }
};

const CATEGORY_ORDER: IntegrationCategory[] = [
  'microsoft365',
  'ai',
  'collaboration',
  'communication',
  'productivity'
];

const VALUE_PROPS = [
  {
    title: 'Per konto',
    description: 'Varje organisation konfigurerar sina egna integrationer. Inget delat, inget läckage.'
  },
  {
    title: 'EU-suveränt',
    description: 'Alla integrationer auditeras mot Movexums dataskyddspolicy. Ingen data lämnar EU.'
  },
  {
    title: 'En miljö',
    description: 'Era verktyg pratar med plattformen — inte tvärtom. Ni väljer vad som visas var.'
  }
];
const FOOTER_PLACEHOLDER_NUMBER = String(VALUE_PROPS.length + 1).padStart(2, '0');

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function IntegrationerPage() {
  await requireUser();

  const byCategory = CATEGORY_ORDER.reduce<Record<IntegrationCategory, Integration[]>>(
    (acc, cat) => {
      acc[cat] = INTEGRATIONS.filter((i) => i.category === cat);
      return acc;
    },
    {} as Record<IntegrationCategory, Integration[]>
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      {/* ── Hero header ── */}
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-link">
          Plattformsinställningar
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">
          Integrationer
        </h1>
        <p className="mt-3 max-w-2xl text-base text-foreground-muted">
          Anslut de verktyg ni redan använder och bygg er organisations unika digitala miljö.
          Varje konto konfigureras separat — ni bestämmer exakt vad som synkas och för vilka bolag.
        </p>
      </header>

      {/* ── Value proposition banner ── */}
      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map((prop, idx) => (
          <ValueProp
            key={prop.title}
            placeholder={String(idx + 1).padStart(2, '0')}
            title={prop.title}
            description={prop.description}
          />
        ))}
      </div>

      {/* ── Integration categories ── */}
      <div className="space-y-12">
        {CATEGORY_ORDER.map((cat) => {
          const config = CATEGORIES[cat];
          const integrations = byCategory[cat];
          if (integrations.length === 0) return null;

          return (
            <section key={cat}>
              <div className="mb-5 flex flex-wrap items-end gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">{config.label}</h2>
                  <p className="mt-0.5 text-sm text-foreground-muted">{config.description}</p>
                </div>
                <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${config.badgeClass}`}>
                  {integrations.length} {integrations.length === 1 ? 'integration' : 'integrationer'}
                </span>
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {integrations.map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    config={config}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* ── Request integration footer ── */}
      <div className="mt-14 rounded-3xl border border-dashed border-strong bg-surface/50 px-8 py-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-default bg-canvas-subtle text-xs font-semibold tracking-[0.08em] text-foreground-muted">
          {FOOTER_PLACEHOLDER_NUMBER}
        </div>
        <h3 className="mt-3 text-lg font-semibold text-foreground">
          Saknar du en integration?
        </h3>
        <p className="mt-2 max-w-sm mx-auto text-sm text-foreground-muted">
          Berättar du vilket verktyg ni vill ansluta så prioriterar vi det i utvecklingsroadmapen.
          Vi bygger integrationer baserade på era faktiska behov.
        </p>
        <a
          href="mailto:hampus@boxmeal.se"
          className="mt-5 inline-flex items-center justify-center rounded-full border border-default bg-surface px-6 py-2.5 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle"
        >
          Begär integration →
        </a>
      </div>
    </main>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ValueProp({ placeholder, title, description }: { placeholder: string; title: string; description: string }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-default bg-canvas-subtle text-xs font-semibold tracking-[0.08em] text-foreground-muted">
        {placeholder}
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
  config
}: {
  integration: Integration;
  config: typeof CATEGORIES[IntegrationCategory];
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md">
      {/* Colored top accent */}
      <div className={`${config.cardAccent} px-6 py-4`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-default bg-surface text-xs font-semibold tracking-[0.08em] text-foreground-muted">
              {integration.placeholder}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{integration.name}</h3>
              <p className="text-xs text-foreground-muted">{integration.tagline}</p>
            </div>
          </div>
          {/* Status badge */}
          <span className="shrink-0 rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted ring-1 ring-default">
            Ej ansluten
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        <p className="text-sm text-foreground-muted">{integration.description}</p>

        {/* Feature list */}
        <ul className="space-y-1.5">
          {integration.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-xs text-foreground-muted">
              <span className="mt-0.5 text-foreground-subtle" aria-hidden="true">—</span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* Activate button */}
        <div className="mt-auto pt-2">
          <IntegrationActivateButton
            integrationName={integration.name}
            providerPlaceholder={integration.placeholder}
            accentClass={config.cardAccent}
          />
        </div>
      </div>
    </article>
  );
}
