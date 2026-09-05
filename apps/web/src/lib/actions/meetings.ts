'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { writeWithFallback } from '@/lib/core/write/helpers';
import {
  generateMeetingProtocol,
  structureMeetingTranscript
} from '@/lib/ai/meeting-protocol';
import {
  findIntegrationRow,
  getActiveTokens,
  markExpired
} from '@/lib/app-integrations/storage';
import { outlookCalendarProvider } from '@/lib/app-integrations/providers/outlook_calendar/provider';
import { fetchCalendarEvents } from '@/lib/app-integrations/providers/outlook_calendar/calendar';
import {
  matchEventsToContacts,
  type EmailIndex
} from '@/lib/app-integrations/providers/outlook_calendar/match';
import {
  MAX_MEETING_NOTE_CHARS,
  MAX_MEETING_TITLE,
  assembleMeetingTranscript,
  isResumableMeetingStatus,
  isStaleMeeting,
  normalizeMeetingSegments,
  type MeetingSegment,
  type MeetingStatus
} from '@platform/shared';
import type PocketBase from 'pocketbase';

/**
 * Mötesläge i chatten (CLAUDE.md § 34) — server actions.
 *
 * Ljudet går ALDRIG genom dessa actions (segmenten laddas upp via route-
 * handlern /api/chat/meeting/segment, § 18.2-mönstret). Här hanteras
 * livscykeln: starta (efter samtyckesgrinden), avsluta, granska (AI-protokoll
 * + turindelning), spara på bolagskortet och purge.
 *
 * Säkerhet: `meeting_transcripts` är STRIKT ägaren-bara (RLS, migration
 * 1700000142) och alla läsningar går via användarens token; ägar-/tenant-
 * verifiering görs dessutom i koden (defense-in-depth, § 17.8-mönstret).
 * SPARANDET är en mänsklig knapptryckning — inte ett agent-skriv — därför får
 * coachen här välja `confidential`, vilket chatt-agentens `create_startup_note`
 * med rätta aldrig får (§ 33).
 */

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const COLLECTION = 'meeting_transcripts';

async function requireStaff() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Åtkomst nekad.');
  }
  return user;
}

interface MeetingRow {
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

/** Laddar ett möte och verifierar ägarskap + tenant (defense-in-depth). */
async function loadOwnedMeeting(
  pb: PocketBase,
  meetingId: string,
  user: { id: string; tenant: string }
): Promise<MeetingRow | null> {
  try {
    const row = await pb.collection(COLLECTION).getOne<MeetingRow>(meetingId);
    if (row.owner !== user.id || row.tenant !== user.tenant) return null;
    return row;
  } catch {
    return null;
  }
}

export interface MeetingStartupOption {
  id: string;
  name: string;
}

export interface MeetingDto {
  id: string;
  status: MeetingStatus;
  title: string;
  startupId: string;
  startupName: string;
  segments: MeetingSegment[];
  transcript: string;
  startedAt?: string;
  endedAt?: string;
}

async function startupName(
  pb: PocketBase,
  tenant: string,
  startupId: string
): Promise<string> {
  if (!startupId) return '';
  try {
    const s = await pb
      .collection('startups')
      .getOne<{ id: string; tenant?: string; name?: string }>(startupId, {
        fields: 'id,tenant,name'
      });
    if (String(s.tenant ?? '') !== tenant) return '';
    return s.name || '';
  } catch {
    return '';
  }
}

function toDto(row: MeetingRow, resolvedStartupName: string): MeetingDto {
  return {
    id: row.id,
    status: row.status,
    title: row.title || '',
    startupId: row.startup || '',
    startupName: resolvedStartupName,
    segments: normalizeMeetingSegments(row.segments),
    transcript: assembleMeetingTranscript(row.segments),
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

/**
 * Purgar ägarens gamla mötesrader (lagringsminimering, GDPR § 5): osparade
 * möten äldre än MEETING_STALE_DAYS raderas. Best-effort — får aldrig fälla
 * anropande flöde.
 */
async function purgeStaleMeetings(pb: PocketBase, userId: string): Promise<void> {
  try {
    const rows = await pb.collection(COLLECTION).getList<MeetingRow>(1, 50, {
      filter: `owner = "${escFilter(userId)}"`,
      fields: 'id,status,updated',
      sort: 'updated'
    });
    for (const row of rows.items) {
      const stale = isStaleMeeting(row.updated);
      const leftover = row.status === 'saved' || row.status === 'discarded';
      if (stale || leftover) {
        await pb.collection(COLLECTION).delete(row.id).catch(() => undefined);
      }
    }
  } catch {
    /* best-effort */
  }
}

/** Bolagslistan för mötespanelens väljare (tenant-scopad via RLS). */
export async function listMeetingStartupsAction(): Promise<{
  error?: string;
  startups?: MeetingStartupOption[];
}> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const res = await pb
      .collection('startups')
      .getList<{ id: string; name: string }>(1, 200, {
        filter: `tenant = "${escFilter(user.tenant)}"`,
        fields: 'id,name',
        sort: 'name'
      });
    return { startups: res.items.map((s) => ({ id: s.id, name: s.name })) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte hämta bolagen.' };
  }
}

export interface StartMeetingInput {
  startupId?: string | null;
  title?: string | null;
  /** Coachens bekräftelse av samtyckesgrinden (MEETING_CONSENT_TEXT). */
  consentConfirmed: boolean;
}

/**
 * Startar ett möte. Kräver att samtyckesgrinden är bekräftad (GDPR art. 7 —
 * mötet spelar in ANDRA människor än användaren själv); tidpunkten stämplas
 * som bevis. Själva ljudet hanteras aldrig här.
 */
export async function startMeetingAction(
  input: StartMeetingInput
): Promise<{ error?: string; meetingId?: string }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();

    if (!input.consentConfirmed) {
      return { error: 'Bekräfta att deltagarna är informerade innan mötet startas.' };
    }

    await purgeStaleMeetings(pb, user.id);

    const startupId = (input.startupId || '').trim();
    if (startupId) {
      const name = await startupName(pb, user.tenant, startupId);
      if (!name) return { error: 'Bolaget hittades inte i din organisation.' };
    }

    const nowIso = new Date().toISOString();
    const created = await pb.collection(COLLECTION).create<{ id: string }>({
      tenant: user.tenant,
      owner: user.id,
      startup: startupId || null,
      status: 'recording',
      title: String(input.title || '')
        .trim()
        .slice(0, MAX_MEETING_TITLE),
      segments: [],
      consent_confirmed_at: nowIso,
      started_at: nowIso
    });
    return { meetingId: created.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte starta mötet.' };
  }
}

/** Avslutar inspelningen (transkriptet finns kvar för granskning). */
export async function endMeetingAction(
  meetingId: string
): Promise<{ error?: string; meeting?: MeetingDto }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const row = await loadOwnedMeeting(pb, meetingId, user);
    if (!row) return { error: 'Mötet hittades inte.' };
    if (row.status === 'recording') {
      await pb.collection(COLLECTION).update(row.id, {
        status: 'ended',
        ended_at: new Date().toISOString()
      });
      row.status = 'ended';
      row.ended_at = new Date().toISOString();
    }
    const name = row.startup ? await startupName(pb, user.tenant, row.startup) : '';
    return { meeting: toDto(row, name) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte avsluta mötet.' };
  }
}

/** Kastar mötet — transkriptet raderas permanent (inget sparas). */
export async function discardMeetingAction(meetingId: string): Promise<{ error?: string }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const row = await loadOwnedMeeting(pb, meetingId, user);
    if (!row) return {};
    await pb.collection(COLLECTION).delete(row.id);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera mötet.' };
  }
}

/** Hämtar ett möte (för återupptagen granskning). */
export async function getMeetingAction(
  meetingId: string
): Promise<{ error?: string; meeting?: MeetingDto }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const row = await loadOwnedMeeting(pb, meetingId, user);
    if (!row) return { error: 'Mötet hittades inte.' };
    const name = row.startup ? await startupName(pb, user.tenant, row.startup) : '';
    return { meeting: toDto(row, name) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte hämta mötet.' };
  }
}

export interface ResumableMeeting {
  id: string;
  status: MeetingStatus;
  title: string;
  startedAt?: string;
  segmentCount: number;
}

/**
 * Ägarens oavslutade möten (för "återuppta"-bannern i chatten). Purgar
 * samtidigt gamla rader (lagringsminimering).
 */
export async function listResumableMeetingsAction(): Promise<{
  meetings: ResumableMeeting[];
}> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    await purgeStaleMeetings(pb, user.id);
    const rows = await pb.collection(COLLECTION).getList<MeetingRow>(1, 10, {
      filter: `owner = "${escFilter(user.id)}" && (status = "recording" || status = "ended")`,
      sort: '-updated'
    });
    return {
      meetings: rows.items
        .filter((r) => isResumableMeetingStatus(r.status))
        .map((r) => ({
          id: r.id,
          status: r.status,
          title: r.title || 'Möte utan titel',
          startedAt: r.started_at,
          segmentCount: normalizeMeetingSegments(r.segments).length
        }))
    };
  } catch {
    return { meetings: [] };
  }
}

/** Genererar protokollutkast (Fas 2). Visas i granskningsvyn — sparas inte här. */
export async function generateMeetingProtocolAction(
  meetingId: string
): Promise<{ error?: string; protocol?: string }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const row = await loadOwnedMeeting(pb, meetingId, user);
    if (!row) return { error: 'Mötet hittades inte.' };
    const transcript = assembleMeetingTranscript(row.segments);
    const res = await generateMeetingProtocol(pb, user, transcript);
    if (!res.ok) return { error: res.error };
    return { protocol: res.text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte generera protokollet.' };
  }
}

/**
 * Fas 2: LLM-gissad turindelning (anonyma "Talare 1/2"-etiketter, ren
 * textbearbetning — ingen röstanalys, § 31.4). Resultatet visas i
 * granskningsvyn där coachen redigerar och ev. döper talarna själv.
 */
export async function structureMeetingTranscriptAction(
  meetingId: string
): Promise<{ error?: string; transcript?: string }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const row = await loadOwnedMeeting(pb, meetingId, user);
    if (!row) return { error: 'Mötet hittades inte.' };
    const transcript = assembleMeetingTranscript(row.segments);
    const res = await structureMeetingTranscript(pb, user, transcript);
    if (!res.ok) return { error: res.error };
    return { transcript: res.text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte dela upp transkriptet.' };
  }
}

export interface SaveMeetingInput {
  startupId: string;
  /** Konfidentiell anteckning — coachens MÄNSKLIGA val (agentvägen får aldrig). */
  confidential: boolean;
  /** Bifoga hela transkriptet i anteckningen (annars bara protokollet). */
  includeTranscript: boolean;
  /** Det granskade/redigerade protokollet. */
  protocolText: string;
  /** Ev. redigerat transkript (default: det sammansatta ur segmenten). */
  transcriptText?: string;
}

/**
 * Sparar mötet som anteckning på bolagskortet + loggar i aktivitetsfeeden,
 * och PURGAR sedan råtranskriptet (lagringsminimering — anteckningen är
 * arkivet). Personnummer saneras på skrivvägen (§ 15.6-regexen) — folk säger
 * personnummer högt i möten.
 */
export async function saveMeetingToStartupAction(
  meetingId: string,
  input: SaveMeetingInput
): Promise<{ error?: string; noteId?: string; startupId?: string; startupName?: string }> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();
    const row = await loadOwnedMeeting(pb, meetingId, user);
    if (!row) return { error: 'Mötet hittades inte.' };

    const startupId = (input.startupId || '').trim();
    if (!startupId) return { error: 'Välj vilket bolagskort mötet ska sparas på.' };
    const name = await startupName(pb, user.tenant, startupId);
    if (!name) return { error: 'Bolaget hittades inte i din organisation.' };

    const protocol = sanitizePersonnummer(String(input.protocolText || '').trim());
    const transcript = input.includeTranscript
      ? sanitizePersonnummer(
          String(input.transcriptText ?? '').trim() || assembleMeetingTranscript(row.segments)
        )
      : '';
    if (!protocol && !transcript) {
      return { error: 'Det finns inget protokoll eller transkript att spara.' };
    }

    const title = (row.title || '').trim();
    const dateLabel = (row.started_at || new Date().toISOString()).slice(0, 10);
    const parts: string[] = [];
    parts.push(`Mötesanteckning${title ? ` — ${title}` : ''} (${dateLabel})`);
    if (protocol) parts.push(protocol);
    if (transcript) parts.push(`Transkript (AI-transkriberat, Voxtral):\n\n${transcript}`);
    parts.push('Genererat med stöd av AI (Voxtral/Mistral, EU) – verifierat av coach före sparande.');
    const body = parts.join('\n\n').slice(0, MAX_MEETING_NOTE_CHARS);

    let note: { id: string };
    try {
      note = await writeWithFallback(pb, (client) =>
        client.collection('notes').create<{ id: string }>({
          startup: startupId,
          author: user.id,
          body,
          confidential: Boolean(input.confidential)
        })
      );
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Kunde inte spara anteckningen.'
      };
    }

    // Feed-rad (PII-fri: bolagsnamn + typ — aldrig protokolltext). Fail-soft:
    // en instans utan migration 1700000143 får anteckningen ändå.
    try {
      await writeWithFallback(pb, (client) =>
        client.collection('activities').create({
          startup: startupId,
          type: 'meeting',
          kind: 'meeting',
          title: title ? `Möte dokumenterat: ${title.slice(0, 150)}` : 'Möte dokumenterat via chatten',
          status: 'done',
          owner: user.id,
          completed_at: new Date().toISOString()
        })
      );
    } catch {
      /* fail-soft */
    }

    // Purge: anteckningen är arkivet — råtranskriptet raderas (GDPR § 5).
    await pb.collection(COLLECTION).delete(row.id).catch(() => undefined);

    revalidatePath(`/startups/${startupId}`);
    revalidatePath('/aktivitet');
    revalidatePath('/chatt');
    return { noteId: note.id, startupId, startupName: name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara mötet.' };
  }
}

export interface MeetingPrefill {
  title?: string;
  startupId?: string;
  startupName?: string;
}

/**
 * Fas 2: Outlook-förifyllnad. Pågår (eller strax börjar) ett kalendermöte
 * förifylls mötestitel — och bolag när deltagarna entydigt matchar ETT bolags
 * kontakter (§ 14.4: e-post läses transient, persisteras/loggas aldrig och
 * når aldrig AI-kontexten). Fail-soft: utan Outlook-koppling returneras {}.
 */
export async function getMeetingPrefillAction(): Promise<MeetingPrefill> {
  try {
    const user = await requireStaff();
    const pb = await getServerPb();

    const row = await findIntegrationRow(pb, user.id, 'outlook_calendar');
    if (!row || row.status !== 'active' || !row.auth_data) return {};

    let events: Awaited<ReturnType<typeof fetchCalendarEvents>> = [];
    try {
      const tokens = await getActiveTokens({ pb, row, provider: outlookCalendarProvider });
      const now = Date.now();
      events = await fetchCalendarEvents({
        tokens,
        from: new Date(now - 60 * 60 * 1000),
        to: new Date(now + 30 * 60 * 1000),
        timezone: 'Europe/Stockholm'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Okänt fel mot Microsoft Graph.';
      await markExpired(pb, row.id, message).catch(() => undefined);
      return {};
    }

    // Välj eventet som pågår just nu (annars det som börjar inom 30 min).
    const nowTs = Date.now();
    const ongoing = events
      .filter((e) => !e.isAllDay)
      .map((e) => ({ e, start: new Date(e.start).getTime(), end: new Date(e.end).getTime() }))
      .filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end))
      .sort((a, b) => a.start - b.start)
      .find((x) => x.end > nowTs);
    if (!ongoing) return {};

    const prefill: MeetingPrefill = { title: ongoing.e.subject.slice(0, MAX_MEETING_TITLE) };

    // Transient e-postindex över tenantens bolagskontakter (aldrig sparat).
    try {
      const links = await pb
        .collection('startup_contacts')
        .getList<{
          id: string;
          startup: string;
          expand?: { contact?: { id: string; first_name?: string; last_name?: string; email?: string } };
        }>(1, 200, {
          filter: pb.filter('startup.tenant = {:t}', { t: user.tenant }),
          expand: 'contact'
        });
      const index: EmailIndex = new Map();
      for (const l of links.items) {
        const c = l.expand?.contact;
        const key = c?.email?.trim().toLowerCase();
        if (!c || !key) continue;
        const list = index.get(key) ?? [];
        list.push({
          kind: 'contact',
          refId: c.id,
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Kontakt',
          startupId: l.startup
        });
        index.set(key, list);
      }
      if (index.size > 0) {
        const [match] = matchEventsToContacts([ongoing.e], index);
        if (match && match.startupIds.length === 1) {
          const name = await startupName(pb, user.tenant, match.startupIds[0]);
          if (name) {
            prefill.startupId = match.startupIds[0];
            prefill.startupName = name;
          }
        }
      }
    } catch {
      /* matchning är best-effort */
    }

    return prefill;
  } catch {
    return {};
  }
}
