import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  AI_IMPACT_SOURCE_LABEL,
  AI_IMPACT_SOURCE_URL,
  co2GramsForTokens,
  waterMlForTokens,
  formatCo2Grams,
  formatWaterMl,
  formatTokens
} from '@platform/shared';

export const dynamic = 'force-dynamic';

// Systemvid miljödashboard (alla tenants) — kräver superuser-läsning eftersom
// `ai_usage_events`-RLS:en är tenant-scopad. Deterministisk aggregering av
// befintlig telemetri: ingen AI-inferens, ingen PII (bara tokens/kostnad per
// tenant), riskklass n/a. Transparens om AI-resursförbrukning (EU AI Act
// art. 13) + ESG-/CSRD-underlag.

type RangeKey = 'manad' | '7d' | '30d' | '90d';

const RANGE_LABELS: Record<RangeKey, string> = {
  manad: 'Innevarande månad',
  '7d': 'Senaste 7 dagarna',
  '30d': 'Senaste 30 dagarna',
  '90d': 'Senaste 90 dagarna'
};

function isRangeKey(value: string | undefined): value is RangeKey {
  return value === 'manad' || value === '7d' || value === '30d' || value === '90d';
}

/** Periodstart i PB:s filterformat (`YYYY-MM-DD HH:MM:SS.sssZ`, UTC). */
function rangeStart(range: RangeKey, now: Date): string {
  if (range === 'manad') {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01 00:00:00.000Z`;
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ');
}

interface UsageEventRow {
  tenant?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
}

interface TenantUsage {
  tenantId: string;
  name: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

// Pagineringstak — samma best-effort-princip som budget.server.ts. Vid cap
// visas en tydlig varning (vi presenterar aldrig ett partiellt värde som
// komplett, jfr aggregate_collection § 9.3).
const MAX_PAGES = 40;
const PAGE_SIZE = 500;

function formatCostUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export default async function AiMiljoPage({
  searchParams
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  const range: RangeKey = isRangeKey(params.range) ? params.range : '30d';

  const user = await requireUser();
  if (!hasRole(user.roles, ['admin'])) {
    redirect('/chatt');
  }

  const since = rangeStart(range, new Date());

  // Superuser krävs för läsning över tenant-gränser (RLS:en på
  // ai_usage_events är tenant-scopad). Degradera tydligt, inte tyst.
  const su = await getSuperuserPb();

  let tenantNames = new Map<string, string>();
  let rows: UsageEventRow[] = [];
  let truncated = false;
  let loadError: string | null = null;

  if (!su.ok) {
    loadError =
      su.reason === 'missing_credentials'
        ? 'Superuser-uppgifter saknas i servermiljön (POCKETBASE_SUPERUSER_EMAIL/PASSWORD) — dashboarden kräver dem för att läsa användning över alla tenants.'
        : 'Superuser-inloggningen mot PocketBase misslyckades. Kontrollera serverkonfigurationen.';
  } else {
    try {
      const tenants = await su.pb
        .collection('tenants')
        .getFullList<{ id: string; name?: string; slug?: string }>({
          fields: 'id,name,slug',
          sort: 'name'
        });
      tenantNames = new Map(
        tenants.map((t) => [t.id, t.name || t.slug || t.id])
      );

      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await su.pb
          .collection('ai_usage_events')
          .getList<UsageEventRow>(page, PAGE_SIZE, {
            filter: su.pb.filter('created >= {:since}', { since }),
            fields: 'tenant,tokens_in,tokens_out,cost_estimate_usd',
            sort: '-created'
          });
        rows.push(...res.items);
        if (res.items.length < PAGE_SIZE || page * PAGE_SIZE >= res.totalItems) break;
        if (page === MAX_PAGES) truncated = true;
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Kunde inte läsa AI-användningen.';
      rows = [];
    }
  }

  // ── Aggregat per tenant ───────────────────────────────────────────────
  const byTenant = new Map<string, TenantUsage>();
  for (const row of rows) {
    const id = row.tenant || '(okänd tenant)';
    const entry =
      byTenant.get(id) ||
      ({
        tenantId: id,
        name: tenantNames.get(id) || id,
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0
      } satisfies TenantUsage);
    entry.calls += 1;
    entry.tokensIn += Number(row.tokens_in) || 0;
    entry.tokensOut += Number(row.tokens_out) || 0;
    entry.costUsd += Number(row.cost_estimate_usd) || 0;
    byTenant.set(id, entry);
  }
  const tenantRows = Array.from(byTenant.values()).sort(
    (a, b) => b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut)
  );

  const totalTokensIn = tenantRows.reduce((acc, t) => acc + t.tokensIn, 0);
  const totalTokensOut = tenantRows.reduce((acc, t) => acc + t.tokensOut, 0);
  const totalTokens = totalTokensIn + totalTokensOut;
  const totalCalls = tenantRows.reduce((acc, t) => acc + t.calls, 0);
  const totalCostUsd = tenantRows.reduce((acc, t) => acc + t.costUsd, 0);
  const totalCo2 = co2GramsForTokens(totalTokens);
  const totalWater = waterMlForTokens(totalTokens);

  return (
    <PageShell
      title="AI-miljöpåverkan"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {RANGE_LABELS[range]} · alla tenants · källa: ai_usage_events
        </span>
      }
      actions={
        <Link
          href="/insights"
          className="rounded-2xl border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-canvas-subtle"
        >
          Till Insights
        </Link>
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {/* ── Periodval ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((r) => (
            <Link
              key={r}
              href={`/admin/ai-miljo?range=${r}`}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                r === range
                  ? 'bg-brand text-brand-foreground'
                  : 'border border-default text-foreground-muted hover:border-strong hover:text-foreground'
              }`}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </div>

        {loadError && (
          <div className="rounded-2xl border border-default bg-movexum-pastell-orange p-4 text-[13px] text-movexum-morkorange">
            <div className="font-medium">Dashboarden kan inte visas just nu.</div>
            <div className="mt-1">{loadError}</div>
          </div>
        )}

        {truncated && (
          <div className="rounded-2xl border border-default bg-movexum-pastell-gul p-4 text-[13px] text-movexum-morkgul">
            Perioden innehåller fler än {formatTokens(MAX_PAGES * PAGE_SIZE)} AI-anrop —
            siffrorna nedan är en <strong>nedre gräns</strong>, inte en komplett summa.
            Välj en kortare period för exakta värden.
          </div>
        )}

        {/* ── KPI-kort ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded-2xl border border-default bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Tokens totalt
            </div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
              {formatTokens(totalTokens)}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-foreground-subtle">
              {formatTokens(totalTokensIn)} in · {formatTokens(totalTokensOut)} ut
            </div>
          </div>
          <div className="rounded-2xl border border-default bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              CO₂-utsläpp
            </div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
              ≈ {formatCo2Grams(totalCo2)}
            </div>
            <div className="mt-0.5 text-[11px] text-foreground-subtle">
              1,14 g per 400 tokens
            </div>
          </div>
          <div className="rounded-2xl border border-default bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Vatten
            </div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
              ≈ {formatWaterMl(totalWater)}
            </div>
            <div className="mt-0.5 text-[11px] text-foreground-subtle">
              45 ml per 400 tokens
            </div>
          </div>
          <div className="rounded-2xl border border-default bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              AI-anrop
            </div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
              {formatTokens(totalCalls)}
            </div>
          </div>
          <div className="rounded-2xl border border-default bg-surface p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Kostnad
            </div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
              {formatCostUsd(totalCostUsd)}
            </div>
            <div className="mt-0.5 text-[11px] text-foreground-subtle">ungefärlig</div>
          </div>
        </div>

        {/* ── Per tenant ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-default bg-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-foreground">Per tenant</h2>
              <p className="text-[11px] text-foreground-subtle">
                tokenanvändning och uppskattad miljöpåverkan · {RANGE_LABELS[range].toLowerCase()}
              </p>
            </div>
            <span className="text-[11px] tabular-nums text-foreground-subtle">
              {tenantRows.length} tenants med användning
            </span>
          </div>

          {tenantRows.length === 0 ? (
            <div className="text-[13px] text-foreground-muted">
              {loadError
                ? 'Inga data kunde läsas.'
                : 'Inga AI-anrop loggade i perioden.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-foreground-subtle">
                    <th className="px-2 py-1.5 text-left font-semibold">Tenant</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Anrop</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Tokens in</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Tokens ut</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Totalt</th>
                    <th className="px-2 py-1.5 text-right font-semibold">CO₂e</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Vatten</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Kostnad</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantRows.map((t) => {
                    const tokens = t.tokensIn + t.tokensOut;
                    return (
                      <tr key={t.tenantId} className="border-t border-default">
                        <td className="px-2 py-2 font-medium text-foreground">{t.name}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          {formatTokens(t.calls)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          {formatTokens(t.tokensIn)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          {formatTokens(t.tokensOut)}
                        </td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums text-foreground">
                          {formatTokens(tokens)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          ≈ {formatCo2Grams(co2GramsForTokens(tokens))}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-foreground">
                          ≈ {formatWaterMl(waterMlForTokens(tokens))}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums text-foreground">
                          {formatCostUsd(t.costUsd)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-strong font-semibold">
                    <td className="px-2 py-2 text-foreground">Totalt</td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      {formatTokens(totalCalls)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      {formatTokens(totalTokensIn)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      {formatTokens(totalTokensOut)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      {formatTokens(totalTokens)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      ≈ {formatCo2Grams(totalCo2)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      ≈ {formatWaterMl(totalWater)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-foreground">
                      {formatCostUsd(totalCostUsd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* ── Metod & källa (EU AI Act art. 13 — transparens) ────────── */}
        <section className="rounded-2xl border border-default bg-canvas-subtle p-5 text-[12.5px] text-foreground-muted">
          <p className="font-medium text-foreground">Så beräknas siffrorna</p>
          <p className="mt-2">
            Utsläpp och vattenförbrukning uppskattas från {AI_IMPACT_SOURCE_LABEL}.
            Faktorn tillämpas på <strong>totala tokens (in + ut)</strong> ur den
            interna telemetrin (<code>ai_usage_events</code>) — en transparent,
            konservativ uppskattning som täcker hela modellens livscykel
            (träning + inferens). Alla värden märks därför med &quot;≈&quot;.
          </p>
          <p className="mt-2">
            Källa:{' '}
            <a
              href={AI_IMPACT_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link hover:underline"
            >
              The Batch — Mistrals livscykelrapport för Mistral Large 2
            </a>
          </p>
        </section>
      </div>
    </PageShell>
  );
}
