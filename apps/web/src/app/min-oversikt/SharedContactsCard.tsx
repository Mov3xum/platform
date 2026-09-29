import { listSharedContactsForStartup } from '@/lib/contacts/data';

/**
 * "Delade kontakter" på Mitt bolag (§ 41.4): kontakter ur Movexums kontaktbok
 * som en kollega fått godkänt att dela med bolaget. Anroparen har verifierat
 * att den inloggade är länkad till `startupId` (eller är staff) — läsningen
 * går som superuser eftersom kontaktboken i sig är staff/observer-only.
 * Visar bara det bolaget behöver för att ta kontakt + syftet med delningen.
 */
export async function SharedContactsCard({ tenantId, startupId }: { tenantId: string; startupId: string }) {
  const shared = await listSharedContactsForStartup(tenantId, startupId);
  if (shared.length === 0) return null;
  return (
    <section className="rounded-3xl border border-default bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Delade kontakter</h2>
        <span className="text-xs text-foreground-subtle mx-tnum">{shared.length}</span>
      </div>
      <p className="mb-3 text-sm text-foreground-muted">
        Kontakter som Movexum delat med ert bolag. Använd dem för det syfte som anges — hör av er till er coach om ni vill
        nå någon för något annat.
      </p>
      <ul className="divide-y divide-default">
        {shared.map((s) => (
          <li key={s.requestId} className="py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{s.name}</span>
              {(s.role || s.organization) && (
                <span className="text-foreground-muted">
                  {[s.role, s.organization].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-3 text-xs">
              {s.email && (
                <a href={`mailto:${s.email}`} className="text-link hover:underline">
                  {s.email}
                </a>
              )}
              {s.phone && (
                <a href={`tel:${s.phone.replace(/\s+/g, '')}`} className="text-link hover:underline mx-tnum">
                  {s.phone}
                </a>
              )}
            </div>
            <p className="mt-1 text-xs text-foreground-subtle">Syfte: {s.purpose}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
