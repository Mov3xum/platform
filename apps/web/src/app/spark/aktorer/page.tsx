import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { SPARK_ACTOR_TYPES, SPARK_ACTOR_TYPE_LABELS, SPARK_KOMMUN_LABELS, SPARK_ROLES, SPARK_ROLE_LABELS, SPARK_SECTOR_LABELS, SPARK_SIZE_LABELS, isSparkRole } from '@platform/shared';
import { SPARK_MIGRATION_HINT, loadSparkRegistry } from '@/lib/spark/data';
import { Notice, btnGhost } from '@/components/talent/ui';
import { Empty, RoleChips, SPARK_TITLE, requireSparkStaff, sparkTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/** Aktörsregistret (§ 61): en rad per organisation, oavsett roll. */
export default async function SparkActorsPage({ searchParams }: { searchParams: Promise<{ roll?: string; typ?: string; q?: string }> }) {
  const { user, pb } = await requireSparkStaff();
  const { roll, typ, q } = await searchParams;
  const reg = await loadSparkRegistry(pb, user.tenant);
  const role = isSparkRole(roll) ? roll : null;
  const type = SPARK_ACTOR_TYPES.some((t) => t.id === typ) ? typ : null;
  const query = (q ?? '').trim().toLowerCase().slice(0, 80);
  const count = (list: { actor: string }[], id: string) => list.filter((x) => x.actor === id).length;
  const shown = reg.actors.filter(
    (a) =>
      a.status === 'active' &&
      (!role || a.roles.includes(role)) &&
      (!type || a.actor_type === type) &&
      (!query || `${a.name} ${a.business} ${SPARK_KOMMUN_LABELS[a.kommun] ?? ''}`.toLowerCase().includes(query))
  );
  const href = (next: { roll?: string | null; typ?: string | null }) => {
    const p = new URLSearchParams();
    const r = next.roll === undefined ? role : next.roll;
    const t = next.typ === undefined ? type : next.typ;
    if (r) p.set('roll', r);
    if (t) p.set('typ', t);
    if (query) p.set('q', query);
    const s = p.toString();
    return s ? `/spark/aktorer?${s}` : '/spark/aktorer';
  };

  return (
    <PageShell title={SPARK_TITLE} tabs={sparkTabs(true)} meta={<span className="text-sm text-foreground-subtle mx-tnum">{shown.length} aktörer</span>}>
      <div className="space-y-4">
        {reg.missing ? <Notice kind="warning">{SPARK_MIGRATION_HINT}</Notice> : null}
        {reg.error ? <Notice kind="error">{reg.error}</Notice> : null}
        <form className="flex flex-wrap items-center gap-2" action="/spark/aktorer">
          {role ? <input type="hidden" name="roll" value={role} /> : null}
          {type ? <input type="hidden" name="typ" value={type} /> : null}
          <input name="q" defaultValue={query} placeholder="Sök på namn, verksamhet eller kommun" className="w-full max-w-sm rounded-full border border-default bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-strong" />
          <button type="submit" className={btnGhost}>
            Sök
          </button>
        </form>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={href({ roll: null })} className={`${btnGhost} ${!role ? 'border-strong text-foreground' : ''}`}>
            Alla roller
          </Link>
          {SPARK_ROLES.map((r) => (
            <Link key={r.id} href={href({ roll: r.id })} className={`${btnGhost} ${role === r.id ? 'border-strong text-foreground' : ''}`}>
              {SPARK_ROLE_LABELS[r.id]} <span className="mx-tnum text-foreground-subtle">{reg.actors.filter((a) => a.status === 'active' && a.roles.includes(r.id)).length}</span>
            </Link>
          ))}
          <span className="mx-1 self-center text-foreground-subtle">·</span>
          <Link href={href({ typ: null })} className={`${btnGhost} ${!type ? 'border-strong text-foreground' : ''}`}>
            Alla typer
          </Link>
          {SPARK_ACTOR_TYPES.filter((t) => reg.actors.some((a) => a.actor_type === t.id)).map((t) => (
            <Link key={t.id} href={href({ typ: t.id })} className={`${btnGhost} ${type === t.id ? 'border-strong text-foreground' : ''}`}>
              {t.label}
            </Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <Empty>Inga aktörer matchar urvalet. Aktörer kommer in när en intervju eller anmälan förs in i registret.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-default bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-default text-left text-xs text-foreground-subtle">
                <tr>
                  <th className="px-4 py-3 font-semibold">Aktör</th>
                  <th className="px-3 py-3 font-semibold">Roll</th>
                  <th className="px-3 py-3 font-semibold">Bransch</th>
                  <th className="px-3 py-3 font-semibold">Kommun</th>
                  <th className="px-3 py-3 text-right font-semibold">Behov</th>
                  <th className="px-3 py-3 text-right font-semibold">Lösningar</th>
                  <th className="px-4 py-3 text-right font-semibold">Testmiljöer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <Link href={`/spark/aktorer/${a.id}`} className="font-semibold text-foreground hover:underline">
                        {a.name}
                      </Link>
                      <span className="block text-xs text-foreground-subtle">
                        {SPARK_ACTOR_TYPE_LABELS[a.actor_type] ?? 'Aktör'}
                        {a.size ? ` · ${SPARK_SIZE_LABELS[a.size]}` : ''}
                        {a.startup ? ' · portföljbolag' : ''}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <RoleChips roles={a.roles} />
                    </td>
                    <td className="px-3 py-3 text-foreground-muted">{SPARK_SECTOR_LABELS[a.sector] ?? '–'}</td>
                    <td className="px-3 py-3 text-foreground-muted">{SPARK_KOMMUN_LABELS[a.kommun] ?? '–'}</td>
                    <td className="px-3 py-3 text-right mx-tnum">{count(reg.needs, a.id)}</td>
                    <td className="px-3 py-3 text-right mx-tnum">{count(reg.solutions, a.id)}</td>
                    <td className="px-4 py-3 text-right mx-tnum">{count(reg.testbeds, a.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
