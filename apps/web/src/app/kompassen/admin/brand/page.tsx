import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, Icon } from '@/components/proto';

export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/kompassen');
  }

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Kompassen / Admin / Brand"
        title="Brand-inställningar"
        subtitle="Anpassa hur Kompassen presenterar din inkubator för publika intag-flöden."
        actions={
          <Link href="/kompassen" className="mx-btn">
            <Icon name="arrow" size={13} /> Översikt
          </Link>
        }
      />

      <Card style={{ padding: 24, textAlign: 'center' }}>
        <div className="mx-disp mx-fw-6" style={{ fontSize: 18, marginBottom: 8 }}>
          Brand-editor byggs som följdpull
        </div>
        <div className="mx-muted mx-t-13" style={{ maxWidth: 520, margin: '0 auto' }}>
          Tabellen <code className="mx-mono">compass_brand</code> finns redan
          (tenant-scoped key/value). Här ska du framöver kunna ladda upp logo,
          sätta hero-text och välja vilka moduler som syns på landningssidan.
          Tills dess respekterar Kompassen Movexum-tenantens standard-brand
          (se <Link href="/installningar" className="mx-fw-6">Inställningar</Link>).
        </div>
      </Card>
    </div>
  );
}
