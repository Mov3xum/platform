import Link from 'next/link';
import type { Partner } from '@platform/shared';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule } from '@/lib/rbac';

export default async function PartnersPage() {
  const user = await requireUser();

  if (!canAccessModule(user.roles, 'partners')) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
        <div className="rounded-3xl border border-default bg-surface p-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Behorighet saknas</h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Din roll har inte tillgang till partneroversikten.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            Till dashboard
          </Link>
        </div>
      </main>
    );
  }

  const pb = await getServerPb();
  let partners: Partner[] = [];

  try {
    const result = await pb.collection('partners').getList<Partner>(1, 50, {
      filter: `tenant = "${user.tenant}"`,
      sort: 'name'
    });
    partners = result.items;
  } catch (error) {
    console.error('[partners] failed to load partners', { tenant: user.tenant, userId: user.id, error });
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-link">Partners</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Partneroversikt</h1>
        <p className="mt-2 text-base text-foreground-muted">
          Samarbeten, investerare och organisationer kopplade till {user.tenantName || 'tenanten'}.
        </p>
      </header>

      {partners.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-strong bg-surface p-10 text-center">
          <p className="text-sm text-foreground-muted">Inga partners hittades an. Laggs till via PocketBase eller kommande adminflode.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {partners.map((partner) => (
            <article key={partner.id} className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground-subtle">{partner.type}</p>
              <h2 className="mt-2 text-lg font-semibold text-foreground">{partner.name}</h2>
              <p className="mt-3 text-sm text-foreground-muted">{partner.notes || 'Ingen extra information tillagd.'}</p>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
