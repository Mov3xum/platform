import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { type StartupPhase } from '@platform/shared';
import { phaseLabels } from '@/lib/labels';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem } from '@/components/PageRail';
import { Chip, Icon } from '@/components/proto';
import {
  countLeadsByStatus,
  listAssignableStaff,
  listLeads,
  listLeadSources,
  listModules
} from '@/lib/compass/store';
import {
  FLOW_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  type LeadStatus
} from '@/lib/compass/types';
import { LeadTriageActions, type PhaseOption } from '@/components/startups/LeadTriageActions';
import { buildStartupTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

const TRIAGE_STATUSES: LeadStatus[] = ['new', 'contacted', 'meeting-booked', 'evaluating'];
const CONVERT_PHASES: StartupPhase[] = [
  'inflode',
  'lead',
  'boost_chamber',
  'incubation',
  'prescale',
  'acceleration'
];
const DEFAULT_CONVERT_PHASE: StartupPhase = 'lead';

export default async function StartupsInflodePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) redirect('/dashboard');
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  if (!isStaff) redirect('/startups');
  const canConvert = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  const params = await searchParams;
  const statusFilter = isLeadStatus(params.status) ? params.status : undefined;
  const q = params.q?.trim() || undefined;

  const pb = await getServerPb();
  const [statusCounts, sources, modules, staff, leadResult] = await Promise.all([
    countLeadsByStatus(pb, user.tenant),
    listLeadSources(pb),
    listModules(pb, user.tenant),
    listAssignableStaff(pb, user.tenant),
    listLeads(pb, user.tenant, { status: statusFilter, q, perPage: 40 })
  ]);

  // Default: visa det som behöver hanteras (tratt-statusar), om inget filter satts.
  const leads = statusFilter
    ? leadResult.items
    : leadResult.items.filter((l) => TRIAGE_STATUSES.includes(l.status));

  const inFunnel = TRIAGE_STATUSES.reduce((s, k) => s + (statusCounts[k] || 0), 0);
  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const phaseOptions: PhaseOption[] = CONVERT_PHASES.map((p) => ({ value: p, label: phaseLabels[p] }));
  const staffOptions = staff.map((s) => ({ id: s.id, name: s.name || s.email }));

  const tabs = buildStartupTabs({ isStaff, inflowBadge: inFunnel });

  const rail = (
    <>
      <RailSection label="Källor">
        {sources.length === 0 ? (
          <div className="px-2 py-3 text-center text-[12px] text-foreground-subtle">Inga källor.</div>
        ) : (
          sources.slice(0, 8).map((s) => (
            <Link
              key={s.key}
              href={`/inflode/leads?src=${encodeURIComponent(s.key)}`}
              className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-canvas-muted"
            >
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color || '#002c40' }} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                {s.label}
              </span>
            </Link>
          ))
        )}
      </RailSection>
      <RailSection label="Moduler">
        {modules.length === 0 ? (
          <div className="px-2 py-3 text-center text-[12px] text-foreground-subtle">Inga moduler.</div>
        ) : (
          modules.slice(0, 6).map((m) => (
            <RailItem
              key={m.id}
              icon={m.flow_type === 'chat' ? 'sparkle' : 'doc'}
              iconTone={m.flow_type === 'chat' ? 'accent' : 'brand'}
              title={m.name}
              meta={FLOW_TYPE_LABEL[m.flow_type]}
              href={`/inflode/admin/modules/${m.slug}`}
            />
          ))
        )}
      </RailSection>
    </>
  );

  const actions = (
    <>
      <Link
        href="/inflode"
        className="inline-flex items-center gap-1.5 rounded-lg border border-default bg-surface px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:bg-canvas-muted"
      >
        Full inflödesvy →
      </Link>
      <Link
        href="/inflode/leads/new"
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
      >
        <Icon name="plus" size={12} /> Nytt lead
      </Link>
    </>
  );

  return (
    <PageShell title="Startups" tabs={tabs} actions={actions} rightPanel={rail}>
      <div className="space-y-6 py-6">
        {/* Funnel */}
        <section className="rounded-2xl border border-default bg-surface">
          <div className="flex items-center justify-between border-b border-default px-5 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Tratt · klicka för att filtrera
            </span>
            {statusFilter && (
              <Link href="/startups/inflode" className="text-[12px] text-foreground-muted hover:text-foreground">
                Visa allt att hantera
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-6">
            {LEAD_STATUS_ORDER.map((status) => {
              const n = statusCounts[status] || 0;
              const active = statusFilter === status;
              return (
                <Link
                  key={status}
                  href={`/startups/inflode?status=${encodeURIComponent(status)}`}
                  className={`rounded-xl border px-3 py-3 transition ${active ? 'border-brand bg-canvas-muted' : 'border-default bg-canvas-subtle hover:border-strong'}`}
                >
                  <div className="mb-1 font-mono text-[10.5px] uppercase tracking-wide text-foreground-subtle">
                    {LEAD_STATUS_LABEL[status]}
                  </div>
                  <div className="text-2xl font-semibold text-foreground tabular-nums">{n}</div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Triage-lista */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              {statusFilter ? LEAD_STATUS_LABEL[statusFilter] : 'Att hantera'}
            </h2>
            <span className="font-mono text-[11px] text-foreground-subtle">{leads.length} leads</span>
          </div>
          {leads.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-10 text-center text-[13px] text-foreground-muted">
              Inget i tratten just nu. Nya leads dyker upp här när någon fyller i en modul.
            </div>
          ) : (
            <div className="space-y-2">
              {leads.map((lead) => {
                const source = sourceByKey.get(lead.source_key);
                const contact = [lead.email, lead.phone, lead.organization].filter(Boolean).join(' · ');
                return (
                  <div key={lead.id} className="rounded-2xl border border-default bg-surface p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/inflode/leads/${lead.id}`}
                            className="truncate text-[14px] font-semibold text-foreground hover:text-link"
                          >
                            {lead.name || 'Anonym'}
                          </Link>
                          <Chip variant={statusChipVariant(lead.status)} mono>
                            {LEAD_STATUS_LABEL[lead.status]}
                          </Chip>
                          {typeof lead.score === 'number' && (
                            <span className="font-mono text-[11px] font-semibold text-foreground">
                              {lead.score} p
                            </span>
                          )}
                        </div>
                        {contact && (
                          <div className="mt-0.5 truncate font-mono text-[11px] text-foreground-subtle">
                            {contact}
                          </div>
                        )}
                        <p className="mt-1 line-clamp-2 text-[12.5px] text-foreground-muted">
                          {lead.idea_summary || 'Ingen idébeskrivning ännu.'}
                        </p>
                        <div className="mt-1 font-mono text-[10.5px] uppercase text-foreground-subtle">
                          {source?.label || lead.source_key}
                          {lead.utm_campaign && ` · ${lead.utm_campaign}`}
                        </div>
                      </div>
                      <div className="w-full md:w-auto md:max-w-[360px] md:flex-1">
                        {canConvert ? (
                          <LeadTriageActions
                            leadId={lead.id}
                            defaultName={lead.organization || lead.name || ''}
                            phases={phaseOptions}
                            defaultPhase={DEFAULT_CONVERT_PHASE}
                            staff={staffOptions}
                          />
                        ) : (
                          <Link
                            href={`/inflode/leads/${lead.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-default bg-surface px-3 py-1.5 text-[12px] text-foreground-muted hover:text-foreground"
                          >
                            Öppna lead →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Moduler */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Intag-flöden · egen URL & QR
            </h2>
            <Link
              href="/inflode/admin/modules/new"
              className="text-[12px] text-foreground-muted hover:text-foreground"
            >
              + Ny modul
            </Link>
          </div>
          {modules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-10 text-center text-[13px] text-foreground-muted">
              Inga moduler ännu. Skapa en quiz, ett formulär eller en AI-chatt att promota.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {modules.map((m) => (
                <div key={m.id} className="flex h-full flex-col gap-2 rounded-2xl border border-default bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip variant={m.flow_type === 'chat' ? 'cyan' : 'default'} mono>
                      {FLOW_TYPE_LABEL[m.flow_type].toUpperCase()}
                    </Chip>
                    {m.public_url_enabled && (
                      <Chip variant="active" mono>
                        PUBLIK
                      </Chip>
                    )}
                    {!m.is_active && (
                      <Chip variant="draft" mono>
                        UTKAST
                      </Chip>
                    )}
                  </div>
                  <div className="text-[15px] font-semibold text-foreground">{m.name}</div>
                  <div className="font-mono text-[11px] text-foreground-subtle">/inflode/m/{m.slug}</div>
                  <span className="flex-1" />
                  <div className="mt-1 flex items-center gap-2">
                    <Link
                      href={`/inflode/m/${m.slug}`}
                      className="rounded-lg border border-default bg-canvas-muted px-3 py-1.5 text-[12px] text-foreground hover:bg-canvas-subtle"
                    >
                      Förhandsvisa →
                    </Link>
                    <Link
                      href={`/inflode/admin/modules/${m.slug}`}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-foreground-muted hover:text-foreground"
                    >
                      <Icon name="external" size={12} /> QR & dela
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUS_ORDER as readonly string[]).includes(v);
}

function statusChipVariant(status: LeadStatus): React.ComponentProps<typeof Chip>['variant'] {
  switch (status) {
    case 'new':
      return 'draft';
    case 'contacted':
    case 'meeting-booked':
      return 'review';
    case 'evaluating':
      return 'cyan';
    case 'accepted':
      return 'active';
    case 'declined':
      return 'archive';
    default:
      return 'default';
  }
}
