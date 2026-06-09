import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Chip, Icon } from '@/components/proto';
import { listLeads, listLeadSources, listModules } from '@/lib/compass/store';
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  PREVIEW_SOURCE_KEY,
  PREVIEW_SOURCE_LABEL,
  type LeadStatus
} from '@/lib/compass/types';
import { buildInflodeTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export default async function LeadsPage({
  searchParams
}: {
  searchParams?: Promise<{
    status?: string;
    q?: string;
    src?: string;
    landing?: string;
    page?: string;
  }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/inflode');
  }
  const params = (await searchParams) || {};
  const status = isLeadStatus(params.status) ? params.status : undefined;
  const q = params.q?.trim() || undefined;
  const sourceKey = params.src?.trim() || undefined;
  const landingModule = params.landing?.trim() || undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const pb = await getServerPb();
  const [{ items, totalItems, totalPages }, sources, modules] = await Promise.all([
    listLeads(pb, user.tenant, {
      status,
      q,
      sourceKey,
      landingModule,
      page,
      perPage: PER_PAGE
    }),
    listLeadSources(pb),
    listModules(pb, user.tenant)
  ]);
  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  // Mappa landing_module (lagras som modulens public_slug eller slug) → namn,
  // så att vi kan visa VILKEN modul varje lead kom in via (CLAUDE.md § 23.6).
  const moduleNameBySlug = new Map<string, string>();
  for (const m of modules) {
    if (m.public_slug) moduleNameBySlug.set(m.public_slug, m.name);
    if (m.slug) moduleNameBySlug.set(m.slug, m.name);
  }
  const landingLabel = (slug?: string): string | undefined => {
    if (!slug) return undefined;
    return moduleNameBySlug.get(slug) || slug;
  };

  const baseQs = new URLSearchParams();
  if (status) baseQs.set('status', status);
  if (q) baseQs.set('q', q);
  if (sourceKey) baseQs.set('src', sourceKey);
  if (landingModule) baseQs.set('landing', landingModule);

  const tabs = buildInflodeTabs();

  return (
    <PageShell
      title="Startupkompassen"
      tabs={tabs}
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {`${totalItems} ${totalItems === 1 ? 'lead' : 'leads'} ${status ? `· ${LEAD_STATUS_LABEL[status]}` : '· alla statusar'}`}
        </span>
      }
      actions={
        <>
          <a
            href={`/api/inflode/leads/export${baseQs.toString() ? `?${baseQs.toString()}` : ''}`}
            className="mx-btn"
            title="Exportera de filtrerade leadsen som CSV (Excel) — för uppföljning och rapportering"
          >
            <Icon name="download" size={13} /> Exportera CSV
          </a>
          <Link href="/inflode/leads/new" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Nytt lead
          </Link>
        </>
      }
    >
      {/* Filter-bar */}
      <Card style={{ padding: 12, marginBottom: 16 }}>
        <form
          action="/inflode/leads"
          method="get"
          className="mx-flex mx-items-c mx-gap-2 mx-wrap"
        >
          {/* Bevara ett aktivt modulfilter (länkat från modul-admin) vid sök. */}
          {landingModule && <input type="hidden" name="landing" value={landingModule} />}
          <input
            type="search"
            name="q"
            defaultValue={q || ''}
            placeholder="Sök namn, e-post, idé..."
            className="mx-input"
            style={{ minWidth: 240, flex: 1 }}
          />
          <select name="status" defaultValue={status || ''} className="mx-input" style={{ width: 180 }}>
            <option value="">Alla statusar</option>
            {LEAD_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select name="src" defaultValue={sourceKey || ''} className="mx-input" style={{ width: 180 }}>
            <option value="">Alla källor</option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="submit" className="mx-btn mx-primary">
            <Icon name="filter" size={13} /> Filtrera
          </button>
        </form>
      </Card>

      {/* Status-chips quick filter */}
      <div className="mx-flex mx-gap-2 mx-wrap" style={{ marginBottom: 16 }}>
        <Link
          href="/inflode/leads"
          className={`mx-chip mx-mono${!status ? ' mx-ink-chip' : ''}`}
          style={{ textDecoration: 'none' }}
        >
          Alla
        </Link>
        {LEAD_STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={`/inflode/leads?status=${s}`}
            className={`mx-chip mx-mono${status === s ? ' mx-ink-chip' : ''}`}
            style={{ textDecoration: 'none' }}
          >
            {LEAD_STATUS_LABEL[s]}
          </Link>
        ))}
        <Link
          href={`/inflode/leads?src=${PREVIEW_SOURCE_KEY}`}
          className={`mx-chip mx-mono${sourceKey === PREVIEW_SOURCE_KEY ? ' mx-ink-chip' : ''}`}
          style={{ textDecoration: 'none' }}
          title="Interna testkörningar — räknas inte i statistik eller export"
        >
          {PREVIEW_SOURCE_LABEL}
        </Link>
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 16, marginBottom: 6 }}>
            Inga leads matchar filtret
          </div>
          <div className="mx-muted mx-t-13">
            Justera sökningen eller välj &ldquo;Alla&rdquo; för att se hela tratten.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((lead) => {
            const source = sourceByKey.get(lead.source_key);
            return (
              <Link
                key={lead.id}
                href={`/inflode/leads/${lead.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Card style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-flex mx-items-c mx-gap-2">
                      <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">
                        {lead.name || 'Anonym'}
                      </span>
                      <Chip variant={statusChipVariant(lead.status)} mono>
                        {LEAD_STATUS_LABEL[lead.status]}
                      </Chip>
                      {lead.source_key === PREVIEW_SOURCE_KEY ? (
                        <Chip variant="draft" mono>
                          {PREVIEW_SOURCE_LABEL.toUpperCase()}
                        </Chip>
                      ) : (
                        source && (
                          <span className="mx-mono mx-t-xs mx-muted mx-t-up">
                            · {source.label}
                          </span>
                        )
                      )}
                      {landingLabel(lead.landing_module) && (
                        <Chip variant="cyan" mono>
                          {landingLabel(lead.landing_module)}
                        </Chip>
                      )}
                    </div>
                    <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                      {lead.idea_summary ||
                        lead.email ||
                        lead.organization ||
                        '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 90 }}>
                    {typeof lead.score === 'number' && (
                      <div className="mx-mono mx-t-xs mx-fw-6">
                        {lead.score} p
                      </div>
                    )}
                    <div className="mx-mono mx-t-xs mx-muted" style={{ marginTop: 2 }}>
                      {formatRelative(lead.created)}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mx-flex mx-items-c mx-gap-2" style={{ marginTop: 16, justifyContent: 'center' }}>
          {page > 1 && (
            <Link
              href={`/inflode/leads?${appendPage(baseQs, page - 1)}`}
              className="mx-btn mx-sm"
            >
              ← Föregående
            </Link>
          )}
          <span className="mx-mono mx-t-xs mx-muted">
            Sida {page} av {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/inflode/leads?${appendPage(baseQs, page + 1)}`}
              className="mx-btn mx-sm"
            >
              Nästa →
            </Link>
          )}
        </div>
      )}
    </PageShell>
  );
}

function appendPage(qs: URLSearchParams, page: number): string {
  const copy = new URLSearchParams(qs);
  copy.set('page', String(page));
  return copy.toString();
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

function formatRelative(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const minutes = Math.round(diff / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} d`;
    return d.toLocaleDateString('sv-SE');
  } catch {
    return '';
  }
}
