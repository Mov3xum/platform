import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, Chip, Icon } from '@/components/proto';
import { getLeadAnalytics, listModules } from '@/lib/compass/store';
import { FLOW_TYPE_LABEL } from '@/lib/compass/types';

export const dynamic = 'force-dynamic';

export default async function AdminModulesPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/inflode');
  }
  const pb = await getServerPb();
  const [modules, analytics] = await Promise.all([
    listModules(pb, user.tenant),
    getLeadAnalytics(pb, user.tenant, 365)
  ]);

  const metricsBySlug = new Map(analytics.byModule.map((m) => [m.slug, m]));

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Inflöde / Admin / Moduler"
        title="Intag-moduler"
        subtitle="Deploya formulär, quiz och AI-chattar på egna URL:er. Spåra konvertering per modul."
        actions={
          <>
            <Link href="/inflode" className="mx-btn">
              <Icon name="arrow" size={13} /> Översikt
            </Link>
            <Link href="/inflode/admin/modules/new" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa modul
            </Link>
          </>
        }
      />

      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div
          className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted"
          style={{ flexWrap: 'wrap' }}
        >
          <Icon name="shield" size={13} />
          <span>
            Varje modul får en egen URL <code className="mx-mono">/inflode/m/[slug]</code>.
            Lägg på <code className="mx-mono">?utm_source=&hellip;&amp;utm_campaign=&hellip;</code>{' '}
            för att mäta var leads kommer ifrån.
          </span>
        </div>
      </Card>

      {modules.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 18, marginBottom: 8 }}>
            Inga moduler ännu
          </div>
          <div className="mx-muted mx-t-13" style={{ marginBottom: 16 }}>
            Bygg din första intag-modul — välj mellan AI-chatt, formulär eller quiz.
          </div>
          <Link href="/inflode/admin/modules/new" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Skapa din första modul
          </Link>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {modules.map((m) => {
            const metrics = metricsBySlug.get(m.slug);
            return (
              <Card key={m.id} style={{ padding: 14 }}>
                <div className="mx-flex mx-items-c mx-gap-2">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-flex mx-items-c mx-gap-2">
                      <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">
                        {m.name}
                      </span>
                      <Chip variant={m.flow_type === 'chat' ? 'cyan' : 'default'} mono>
                        {FLOW_TYPE_LABEL[m.flow_type].toUpperCase()}
                      </Chip>
                      {m.is_active ? (
                        <Chip variant="active" mono>
                          AKTIV
                        </Chip>
                      ) : (
                        <Chip variant="draft" mono>
                          UTKAST
                        </Chip>
                      )}
                      {m.public_url_enabled && (
                        <Chip variant="cyan" mono>
                          PUBLIK
                        </Chip>
                      )}
                    </div>
                    <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                      <code className="mx-mono">/inflode/m/{m.slug}</code>
                      {m.description ? ` · ${m.description}` : ''}
                    </div>
                  </div>
                  {metrics && (
                    <div
                      className="mx-mono mx-t-xs"
                      style={{ textAlign: 'right', flexShrink: 0 }}
                    >
                      <div className="mx-fw-6 mx-ink-soft">{metrics.total} leads</div>
                      <div className="mx-muted">
                        {metrics.accepted} accept. · {metrics.converted} bolag
                      </div>
                    </div>
                  )}
                  <div className="mx-flex mx-gap-2" style={{ flexShrink: 0 }}>
                    <Link href={`/inflode/m/${m.slug}`} className="mx-btn mx-sm">
                      Förhandsgranska
                    </Link>
                    <Link
                      href={`/inflode/admin/modules/${m.slug}`}
                      className="mx-btn mx-sm mx-primary"
                    >
                      <Icon name="gear" size={12} /> Redigera
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
