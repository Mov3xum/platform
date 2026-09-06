import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import type { MeetingStatus } from '@platform/shared';

/**
 * Mötesläge (CLAUDE.md § 34) — delad, robust åtkomst till `meeting_transcripts`.
 *
 * Delas av server-actions (`lib/actions/meetings.ts`) och segment-routen
 * (`/api/chat/meeting/segment`) så att läs-/skrivrobustheten aldrig divergerar.
 *
 * Varför superuser-fallback: PB v0.23.4:s rule-eval kan TYST neka en behörig
 * användare — även på view-regler (§ 21.3, § 23.7-precedensen) — och ett
 * regel-nekande på update/delete svarar 404, inte 403. Utan fallback blir
 * symptomet "transkriberingen fungerar inte": segmentet transkriberas hos
 * Voxtral men kan inte sparas, och mötet slutar som ett tomt transkript.
 *
 * Säkerhetsgränsen är oförändrad: kollektionen är strikt ägaren-bara och
 * `loadOwnedMeeting` verifierar ägare + tenant I KODEN på varje läsning —
 * fallbacken är en robusthetsväg, aldrig en behörighetsväg (samma mönster som
 * `lib/core/write/helpers.ts`, § 18.3/§ 20.5/§ 30.4).
 */

export const MEETING_COLLECTION = 'meeting_transcripts';

export interface MeetingRow {
  id: string;
  tenant: string;
  owner: string;
  startup?: string;
  status: MeetingStatus;
  title?: string;
  segments?: unknown;
  consent_confirmed_at?: string;
  started_at?: string;
  ended_at?: string;
  updated: string;
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

/**
 * Läser ett möte: användartokenen först (RLS), superuser-fallback när den
 * nekas/felar. Ägar-/tenant-checken i koden är den hårda gränsen — fallbacken
 * kan aldrig exponera någon annans möte.
 */
export async function loadOwnedMeeting(
  pb: PocketBase,
  meetingId: string,
  user: { id: string; tenant: string }
): Promise<MeetingRow | null> {
  const read = async (client: PocketBase): Promise<MeetingRow | null> => {
    try {
      return await client.collection(MEETING_COLLECTION).getOne<MeetingRow>(meetingId);
    } catch {
      return null;
    }
  };
  let row = await read(pb);
  if (!row) {
    const su = await getSuperuserPb();
    if (su.ok) row = await read(su.pb);
  }
  if (!row) return null;
  if (row.owner !== user.id || row.tenant !== user.tenant) return null;
  return row;
}

/**
 * Skriver (create/update/delete) med superuser-fallback vid 400/403/404.
 * 404 ingår eftersom PB svarar 404 när en update-/delete-regel tyst nekar
 * raden. Anroparen har ALLTID ägar-verifierat raden (loadOwnedMeeting) eller
 * sätter owner/tenant explicit från den inloggade användaren innan.
 */
export async function meetingWriteWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403 || status === 404) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}
