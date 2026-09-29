import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { Icon } from '@/components/proto';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { getPublicPbUrl } from '@/lib/pb-url';
import { getStartupIds } from '@/lib/missions-server';
import type { Mission, MissionDocument, MissionStatus, MissionType } from '@platform/shared';

/**
 * CLAUDE.md § 29.4 — "Tvärfunktionella team" på bolagskortet.
 *
 * Sammanställer de uppdrag/projekt som är kopplade till bolaget: slutförda
 * team först (vad gjordes, av vem, när, med vilka steg och vilken
 * dokumentation), därefter pågående i kompakt form. Läser uppdraget LIVE
 * (ingen kopia lagras) med användarens token → § 21-RLS gäller: staff/observer
 * ser allt i tenanten, en bolagsmedlem bara sitt bolags uppdrag;
 * `mission_documents` är staff/observer-only och blir tyst tomt för andra.
 * Sektionen renderas inte alls när inget uppdrag är kopplat.
 */

const TYPE_LABELS: Record<MissionType, string> = {
  workshop: 'Workshop',
  sprint_x: 'Sprint X',
  community: 'Community',
  report: 'Rapport',
  onboarding: 'Onboarding',
  project: 'Projekt',
  custom: 'Uppdrag'
};

const STATUS_LABELS: Record<MissionStatus, string> = {
  draft: 'Utkast',
  preparation: 'Förberedelse',
  in_progress: 'Pågående',
  review: 'Granskning',
  done: 'Klart',
  archived: 'Arkiverat'
};

interface DocView {
  id: string;
  mission: string;
  label: string;
  url: string;
}

function userLabel(u?: { display_name?: string; email?: string } | null): string | null {
  if (!u) return null;
  return u.display_name || (u.email ? u.email.split('@')[0] : null);
}

function fmtDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

/** Slutförandedatum: sista klara stegets tid när det går att tolka, annars `updated`. */
function completedAt(m: Mission): string | null {
  const stages = Array.isArray(m.stages_json) ? m.stages_json : [];
  const times = stages
    .filter((s) => s.done && s.time)
    .map((s) => new Date(String(s.time)))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (times.length > 0) {
    return fmtDate(new Date(Math.max(...times.map((d) => d.getTime()))).toISOString());
  }
  return fmtDate(m.updated);
}

function teamLabels(m: Mission): string[] {
  const names: string[] = [];
  const issuer = userLabel(m.expand?.issuer);
  if (issuer) names.push(`${issuer} (ansvarig)`);
  for (const r of m.expand?.recipients ?? []) {
    const n = userLabel(r);
    if (n && r.id !== m.issuer) names.push(n);
  }
  return names;
}

function stripHtml(html?: string): string {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function StartupMissionsSection({
  pb,
  tenantId,
  startupId
}: {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
}) {
  let missions: Mission[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.missions).getList<Mission>(1, 100, {
      filter: pb.filter('tenant = {:tenant} && (startup = {:id} || startups ~ {:id})', {
        tenant: tenantId,
        id: startupId
      }),
      sort: '-updated',
      expand: 'issuer,recipients'
    });
    // Defense-in-depth: `~` på multi-relationen är en substring-match — verifiera
    // kopplingen exakt i JS.
    missions = res.items.filter(
      (m) => m.tenant === tenantId && getStartupIds(m).includes(startupId)
    );
  } catch {
    missions = [];
  }
  if (missions.length === 0) return null;

  const completed = missions.filter((m) => m.status === 'done');
  const ongoing = missions.filter((m) => m.status !== 'done' && m.status !== 'archived');

  // Dokumentation för slutförda team (fail-soft; staff/observer-only RLS).
  const docsByMission = new Map<string, DocView[]>();
  if (completed.length > 0) {
    try {
      const ids = completed.map((m) => m.id);
      const filter = ids.map((_, i) => `mission = {:m${i}}`).join(' || ');
      const params = Object.fromEntries(ids.map((id, i) => [`m${i}`, id]));
      const res = await pb
        .collection(PB_COLLECTIONS.missionDocuments)
        .getList<MissionDocument>(1, 200, { filter: pb.filter(filter, params), sort: '-created' });
      const base = getPublicPbUrl().replace(/\/$/, '');
      for (const d of res.items) {
        const list = docsByMission.get(d.mission) ?? [];
        list.push({
          id: d.id,
          mission: d.mission,
          label: d.title || d.filename || 'dokument',
          url: `${base}/api/files/mission_documents/${d.id}/${encodeURIComponent(d.file)}`
        });
        docsByMission.set(d.mission, list);
      }
    } catch {
      /* fail-soft */
    }
  }

  return (
    <section
      id="team-uppdrag"
      className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tvärfunktionella team</h2>
          <p className="text-sm text-foreground-muted">
            Uppdrag och projekt som Movexums team genomfört med bolaget — sammanställda
            när de slutförts.
          </p>
        </div>
        <Link
          href="/uppdrag"
          className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          Alla team <Icon name="external" size={14} />
        </Link>
      </div>

      {completed.length === 0 ? (
        <p className="text-sm text-foreground-subtle">
          Inget team har slutförts med bolaget ännu.
        </p>
      ) : (
        <ul className="space-y-3">
          {completed.map((m) => {
            const stages = Array.isArray(m.stages_json) ? m.stages_json : [];
            const doneStages = stages.filter((s) => s.done).length;
            const team = teamLabels(m);
            const docs = docsByMission.get(m.id) ?? [];
            const description = stripHtml(m.description).slice(0, 320);
            const when = completedAt(m);
            return (
              <li key={m.id} className="rounded-2xl border border-default p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      <Link href={`/uppdrag/${m.id}`} className="hover:text-brand hover:underline">
                        {m.title}
                      </Link>
                    </p>
                    <p className="text-xs text-foreground-subtle mx-tnum">
                      {TYPE_LABELS[m.type] ?? m.type}
                      {when ? ` · slutfört ${when}` : ''}
                      {stages.length > 0 ? ` · ${doneStages} av ${stages.length} steg klara` : ''}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-movexum-pastell-gron px-2.5 py-0.5 text-xs font-medium text-movexum-morkgron">
                    <Icon name="check" size={11} /> Slutfört
                  </span>
                </div>
                {description ? (
                  <p className="mt-2 text-sm text-foreground-muted">{description}</p>
                ) : null}
                {team.length > 0 ? (
                  <p className="mt-2 text-xs text-foreground-subtle">
                    <span className="font-medium text-foreground-muted">Team:</span>{' '}
                    {team.join(', ')}
                  </p>
                ) : null}
                {stages.length > 0 ? (
                  <ol className="mt-2 flex flex-wrap gap-1.5">
                    {stages.map((s) => (
                      <li
                        key={s.id}
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          s.done
                            ? 'border-default bg-canvas-subtle text-foreground-muted'
                            : 'border-default text-foreground-subtle'
                        }`}
                        title={s.time ? String(s.time) : undefined}
                      >
                        {s.done ? '✓ ' : ''}
                        {s.label}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {docs.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-default bg-canvas-subtle/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                      Dokumentation
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {docs.map((d) => (
                        <li key={d.id}>
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-default bg-surface px-2.5 py-1 text-xs text-link hover:underline"
                          >
                            <Icon name="doc" size={11} /> {d.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {ongoing.length > 0 ? (
        <div className="mt-4 border-t border-default pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
            Pågående ({ongoing.length})
          </p>
          <ul className="divide-y divide-default">
            {ongoing.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/uppdrag/${m.id}`} className="font-medium text-foreground hover:underline">
                  {m.title}
                </Link>
                <span className="text-xs text-foreground-subtle mx-tnum">
                  {TYPE_LABELS[m.type] ?? m.type} · {STATUS_LABELS[m.status] ?? m.status}
                  {m.due_date ? ` · deadline ${fmtDate(m.due_date)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
