import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { Icon } from '@/components/proto';
import { listSurveysForLink } from '@/lib/surveys/store';
import { surveyLinkRefParam, type SurveyLinkKind } from '@platform/shared';

// "Uppföljning" på en källas sida (CLAUDE.md § 47.4): listar enkäter som
// följer upp aktiviteten/eventet/workshopen/… och ger staff en knapp som
// skapar en ny enkät förkopplad till källan. Server-komponent; läser med
// användarens token (RLS). canCreate = admin/incubator_lead/coach (samma
// krets som Utvärdering-fliken) — avgörs av anroparen.

export function followUpCreateHref(kind: SurveyLinkKind, id: string): string {
  return `/inflode/utvardering/new?for=${encodeURIComponent(surveyLinkRefParam({ kind, id }))}`;
}

export async function FollowUpSurveys({
  pb,
  tenant,
  kind,
  id,
  canCreate,
  compact = false
}: {
  pb: PocketBase;
  tenant: string;
  kind: SurveyLinkKind;
  id: string;
  canCreate: boolean;
  /** Tätare variant (inline-rad) för sidor utan kortlayout. */
  compact?: boolean;
}) {
  const surveys = await listSurveysForLink(pb, tenant, kind, id);
  if (surveys.length === 0 && !canCreate) return null;

  return (
    <section
      aria-label="Uppföljning"
      className={compact ? 'mt-4' : 'rounded-2xl border border-default bg-surface p-4'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">Uppföljning</h3>
        <span className="text-[12px] text-foreground-subtle">
          {surveys.length === 0
            ? 'Ingen enkät ännu.'
            : `${surveys.length} enkät${surveys.length === 1 ? '' : 'er'}`}
        </span>
        <span className="flex-1" />
        {canCreate && (
          <Link href={followUpCreateHref(kind, id)} className="mx-btn mx-sm">
            <Icon name="plus" size={12} /> Skapa uppföljning
          </Link>
        )}
      </div>
      {surveys.length > 0 && (
        <ul className="mt-2 divide-y divide-default text-[13px]">
          {surveys.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{s.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  s.is_active
                    ? 'bg-movexum-pastell-gron text-movexum-morkgron'
                    : 'bg-canvas-muted text-foreground-subtle'
                }`}
              >
                {s.is_active ? 'Öppen' : 'Stängd'}
              </span>
              <Link href={`/inflode/utvardering/${s.id}?vy=resultat`} className="text-link hover:underline">
                Resultat
              </Link>
              <Link href={`/inflode/utvardering/${s.id}`} className="text-link hover:underline">
                Redigera
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
