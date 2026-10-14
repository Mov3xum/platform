import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { SCREENING_REQUEST_STATUS_LABEL, formatStockholmDateTime, type ScreeningRequestViewer } from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import { listScreeningRequestsForStartup } from '@/lib/excellence/requests.server';

// Mitt bolag (§ 21bis): begäran om komplettering ställd TILL bolaget inför en
// statsstödsbedömning (§ 51.6). Reads med användarens token → RLS visar en
// bolagsmedlem bara förfrågningar med recipient_kind = "startup"; staff ser
// alla bolagets förfrågningar. Läsvägen har superuser-reserv vid PB 0.23.4:s
// tysta regel-nekande och prövar då samma villkor i koden (§ 51.6).

export async function ScreeningRequestsCard({ pb, viewer, startupId, isStaff }: { pb: PocketBase; viewer: ScreeningRequestViewer; startupId: string; isStaff: boolean }) {
  const { requests } = await listScreeningRequestsForStartup(pb, viewer, startupId, { limit: 20 });
  const visible = requests.filter((r) => r.recipient_kind === 'startup' || isStaff);
  if (visible.length === 0) return null;
  const open = visible.filter((r) => r.status !== 'closed' && r.status !== 'answered');

  return (
    <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Uppgifter till Movexum</h2>
          <p className="text-[12.5px] text-foreground-muted">
            Inför bedömningen av statsstöd behöver Movexum några uppgifter från er. Svara direkt här — det går att spara delvis.
          </p>
        </div>
        {open.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-movexum-pastell-gul px-2.5 py-1 text-[12px] font-semibold text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul">
            {open.length} att svara på
          </span>
        )}
      </div>
      <ul className="divide-y divide-default">
        {visible.map((r) => {
          const answered = r.items.filter((i) => i.status === 'answered').length;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-[13px]">
              <Link href={`/komplettering/${r.id}`} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline">
                <Icon name="shield" size={14} />
                {r.items.length} {r.items.length === 1 ? 'punkt' : 'punkter'}
                {r.recipient_kind === 'coach' ? ' (till coachen)' : ''}
              </Link>
              <span className="text-[12px] text-foreground-subtle">
                {SCREENING_REQUEST_STATUS_LABEL[r.status]}
                {r.status === 'partially_answered' ? ` ${answered}/${r.items.length}` : ''}
              </span>
              <span className="flex-1" />
              <span className="text-[11.5px] text-foreground-subtle mx-tnum">
                {r.created ? formatStockholmDateTime(r.created) : ''}
                {r.due_at ? ` · senast ${r.due_at.slice(0, 10)}` : ''}
              </span>
              {r.status !== 'closed' && r.recipient_kind === 'startup' && (
                <Link href={`/komplettering/${r.id}`} className="rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-brand-foreground hover:bg-brand-hover">
                  {r.status === 'answered' ? 'Visa svar' : 'Svara'}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
