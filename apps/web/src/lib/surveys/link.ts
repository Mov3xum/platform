import 'server-only';
import type PocketBase from 'pocketbase';
import type { Role } from '@platform/shared';
import { parseSurveyLinkRef, type SurveyLinkRef } from '@platform/shared';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import { SURVEY_LINK_SOURCE } from '@/lib/core/write/surveys';

// Flyttad ur `lib/actions/surveys.ts` ('use server') 2026-09-30: en export ur
// en action-modul är i princip anropbar som server action, och den här tar
// `user` som parameter — anropad med klientvald identitet hade den blivit ett
// namn-/slug-orakel över tenanter. Som vanlig servermodul är den bara
// anropbar från serverkod med en verifierad session.

// Källa → PB-kollektion + namnfält: `SURVEY_LINK_SOURCE` i skrivlagret (delas
// med chatt-verktyget `create_survey`). Källan läses tenant-verifierat (§ 21)
// så en enkät aldrig kan kopplas till en annan tenants post; etiketten
// härleds server-side och tas ALDRIG från klienten.
const LINK_SOURCE = SURVEY_LINK_SOURCE;

export interface ResolvedSurveyLink extends SurveyLinkRef {
  label: string;
  /** Bara kompassmoduler — för länken tillbaka. */
  slug?: string;
}

/** Slår upp källan för en `?for=<kind>:<id>`-referens i den inloggades tenant. */
export async function resolveSurveyLink(
  pb: PocketBase,
  user: { id: string; tenant: string; roles: string[] },
  raw: unknown
): Promise<ResolvedSurveyLink | null> {
  const ref = parseSurveyLinkRef(raw);
  if (!ref) return null;
  const src = LINK_SOURCE[ref.kind];
  const row = await getRecordInTenant<{ id: string; tenant?: string; slug?: string } & Record<string, unknown>>(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
    src.collection,
    ref.id,
    `id,tenant,slug,${src.nameField}`
  );
  if (!row) return null;
  const label = String(row[src.nameField] ?? '').trim().slice(0, 200);
  return { ...ref, label: label || `${ref.kind} ${ref.id}`, slug: typeof row.slug === 'string' ? row.slug : undefined };
}

