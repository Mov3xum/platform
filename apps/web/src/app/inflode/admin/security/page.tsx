import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, Chip, Icon } from '@/components/proto';
import { listSecurityEvents } from '@/lib/compass/store';
import type { SecurityEventKind } from '@/lib/compass/types';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<SecurityEventKind, string> = {
  login: 'Inloggning',
  logout: 'Utloggning',
  invite_sent: 'Inbjudan skickad',
  invite_accepted: 'Inbjudan accepterad',
  role_change: 'Rollbyte',
  lead_delete: 'Lead raderat',
  lead_export: 'Lead exporterat',
  lead_erase: 'Lead anonymiserat',
  module_publish: 'Modul publicerad',
  module_unpublish: 'Modul opublicerad',
  brand_update: 'Brand uppdaterad',
  failed_login: 'Misslyckad inloggning',
  rate_limit: 'Rate-limit'
};

const DANGER_KINDS: SecurityEventKind[] = ['lead_delete', 'lead_erase', 'failed_login', 'rate_limit'];
const SUCCESS_KINDS: SecurityEventKind[] = ['invite_accepted', 'module_publish'];

interface SecurityEvent {
  id: string;
  created: string;
  kind: SecurityEventKind;
  subject?: string;
  meta?: Record<string, unknown>;
  actor?: string;
  expand?: { actor?: { display_name?: string; email?: string } };
}

export default async function SecurityEventsPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/inflode');
  }
  const pb = await getServerPb();
  const res = (await listSecurityEvents(pb, user.tenant, { perPage: 80 })) as {
    items: SecurityEvent[];
    totalItems: number;
  };

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Inflöde / Admin / Säkerhet"
        title="Säkerhetshändelser"
        subtitle="Audit-logg för leads, moduler och autentisering. Loggen skrivs server-side och kan inte ändras."
        actions={
          <Link href="/inflode" className="mx-btn">
            <Icon name="arrow" size={13} /> Översikt
          </Link>
        }
      />

      {res.items.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div className="mx-muted mx-t-13">
            Inga säkerhetshändelser loggade ännu. Händelser dyker upp när användare
            loggar in, modifierar leads eller publicerar moduler.
          </div>
        </Card>
      ) : (
        <Card>
          <table className="mx-tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Tid</Th>
                <Th>Händelse</Th>
                <Th>Aktör</Th>
                <Th>Subjekt</Th>
              </tr>
            </thead>
            <tbody>
              {res.items.map((e) => {
                const variant: React.ComponentProps<typeof Chip>['variant'] =
                  DANGER_KINDS.includes(e.kind)
                    ? 'danger'
                    : SUCCESS_KINDS.includes(e.kind)
                    ? 'active'
                    : 'default';
                return (
                  <tr key={e.id}>
                    <Td mono muted>
                      {formatDate(e.created)}
                    </Td>
                    <Td>
                      <Chip variant={variant} mono>
                        {KIND_LABEL[e.kind] || e.kind}
                      </Chip>
                    </Td>
                    <Td>
                      {e.expand?.actor?.display_name || e.expand?.actor?.email || (
                        <span className="mx-muted">system</span>
                      )}
                    </Td>
                    <Td mono muted>
                      {e.subject || '—'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="mx-mono mx-t-xs mx-t-up mx-muted"
      style={{
        textAlign: 'left',
        padding: '10px 14px',
        borderBottom: '1px solid var(--mx-line-soft)',
        fontWeight: 600,
        letterSpacing: '1px'
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  muted
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`${mono ? 'mx-mono ' : ''}${muted ? 'mx-muted ' : ''}mx-t-12`.trim()}
      style={{ padding: '10px 14px', borderBottom: '1px solid var(--mx-line-soft)' }}
    >
      {children}
    </td>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}
