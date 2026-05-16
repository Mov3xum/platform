import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, Chip, Icon } from '@/components/proto';
import { listModules } from '@/lib/compass/store';

export const dynamic = 'force-dynamic';

export default async function AdminModulesPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/kompassen');
  }
  const pb = await getServerPb();
  const modules = await listModules(pb, user.tenant);

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Kompassen / Admin / Moduler"
        title="Intag-moduler"
        subtitle="Hantera vilka chat- och formulär-flöden som tar emot leads i din inkubator."
        actions={
          <Link href="/kompassen" className="mx-btn">
            <Icon name="arrow" size={13} /> Översikt
          </Link>
        }
      />

      <Card style={{ padding: 16, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted" style={{ flexWrap: 'wrap' }}>
          <Icon name="shield" size={13} />
          <span>
            Modulen för att skapa/redigera intag-flöden byggs som följdpull. Just nu
            kan moduler seedas via PocketBase Admin UI eller en migration. Aktiva
            moduler dyker upp på <Link href="/kompassen" className="mx-fw-6">/kompassen</Link>
            {' '}för alla användare i din tenant.
          </span>
        </div>
      </Card>

      {modules.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 16, marginBottom: 6 }}>
            Inga moduler ännu
          </div>
          <div className="mx-muted mx-t-13">
            Skapa moduler via PocketBase-admin på <code className="mx-mono">compass_modules</code>.
            Frågor läggs till i <code className="mx-mono">compass_questions</code> med samma <code className="mx-mono">module</code>-relation.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {modules.map((m) => (
            <Card key={m.id} style={{ padding: 14 }}>
              <div className="mx-flex mx-items-c mx-gap-2">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-flex mx-items-c mx-gap-2">
                    <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{m.name}</span>
                    <Chip variant={m.flow_type === 'chat' ? 'cyan' : 'default'} mono>
                      {m.flow_type.toUpperCase()}
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
                  </div>
                  <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                    /kompassen/m/{m.slug} {m.description ? `· ${m.description}` : ''}
                  </div>
                </div>
                <Link href={`/kompassen/m/${m.slug}`} className="mx-btn mx-sm">
                  Förhandsgranska →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
