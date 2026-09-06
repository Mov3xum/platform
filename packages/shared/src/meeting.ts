/**
 * Mötesläge i chatten (CLAUDE.md § 34) — ren, delad möteslogik.
 *
 * Ligger i `@platform/shared` så att BÅDE klienten (MeetingMode, segmenterad
 * inspelning) och servern (segment-routen, spara-flödet) arbetar mot exakt
 * samma gränser och transkript-sammanfogning — klienten är aldrig
 * säkerhetsgränsen, men den ska inte kunna spela in något servern garanterat
 * avvisar. Ingen IO, inga importer → enhetstestbar (`yarn test`).
 *
 * Integritet: ljudet är transient (segment skickas, transkriberas, kastas —
 * § 31-principen är orörd). Bara texten lever vidare, i `meeting_transcripts`
 * (STRIKT ägaren-bara) tills coachen sparar protokollet på bolagskortet —
 * då purgas råtranskriptet (lagringsminimering, GDPR § 5).
 */

/**
 * Segmentlängd i sekunder. Klienten STARTAR OM MediaRecorder per segment
 * (inte `timeslice` — sådana chunkar är inte självständigt avkodbara) så att
 * varje segment blir en komplett fil som kan transkriberas direkt. Kort nog
 * för live-känsla och liten förlust vid krasch; lång nog för att inte klippa
 * meningar oftare än nödvändigt.
 */
export const MEETING_SEGMENT_SECONDS = 90;

/**
 * Det FÖRSTA segmentet hålls kort så att live-transkriptet syns snabbt —
 * annars ser ett kort möte (eller de första 90 sekunderna av ett långt) ut
 * som att transkriberingen inte fungerar. Ett tidigt fel (t.ex. Voxtral
 * felkonfigurerad) upptäcks då också direkt i stället för efter 90 s.
 * Segmentlängder är en ren klientangelägenhet — servern bryr sig bara om
 * index (luck-detekteringen) och per-klipp-taken i voice.ts.
 */
export const MEETING_FIRST_SEGMENT_SECONDS = 20;

/** Hårt tak på möteslängd (robusthet/kostnad, EU AI Act art. 15). */
export const MAX_MEETING_SECONDS = 3 * 60 * 60;

/** Hårt tak på antal segment per möte (3 h à 90 s = 120; marginal för retries). */
export const MAX_MEETING_SEGMENTS = 160;

/** Osparade möten purgas efter så här många dagar (lagringsminimering). */
export const MEETING_STALE_DAYS = 7;

export const MAX_MEETING_TITLE = 200;

/** Tak på sammanlagd transkript-text som får sparas i en anteckning. */
export const MAX_MEETING_NOTE_CHARS = 120_000;

/**
 * Samtyckestexten coachen bekräftar INNAN inspelningen startar (GDPR art. 7 +
 * art. 13 — mötet spelar in ANDRA människor, inte bara användarens egen röst).
 * Delad så att UI-texten och det som `consent_confirmed_at` intygar aldrig
 * divergerar.
 */
export const MEETING_CONSENT_TEXT =
  'Alla deltagare är informerade om att mötet transkriberas av AI ' +
  '(Voxtral, Mistral — EU-suveränt) och att protokollet kan sparas på ' +
  'bolagskortet. Ljudet lagras aldrig — bara texten.';

/** Markör som sätts in där ett segment saknas (uppladdning/transkribering föll). */
export const MEETING_GAP_MARKER =
  '[Lucka i inspelningen — ett avsnitt kunde inte transkriberas]';

export type MeetingStatus = 'recording' | 'ended' | 'saved' | 'discarded';

export const RESUMABLE_MEETING_STATUSES: readonly MeetingStatus[] = [
  'recording',
  'ended'
];

export function isResumableMeetingStatus(status: string): boolean {
  return (RESUMABLE_MEETING_STATUSES as readonly string[]).includes(status);
}

/**
 * Ett transkriberat segment. `speaker` är reserverat från dag 1 för framtida
 * talarindelning (Fas 3 — diarisering UTAN identitet, anonyma etiketter som
 * en människa döper; biometrisk röstidentifiering byggs ALDRIG, § 31.4).
 */
export interface MeetingSegment {
  /** Ordningsnummer (0-baserat) — sätts av klienten, används för luck-detektering. */
  index: number;
  /** Transkriberad (personnummer-sanerad) text. Tom sträng = tystnad, inte fel. */
  text: string;
  /** ISO-tidsstämpel när segmentet spelades in (valfri). */
  at?: string;
  /** Reserverad anonym talar-etikett ("Talare 1") — aldrig en identitet. */
  speaker?: string;
}

export interface MeetingTranscriptRecord {
  id: string;
  tenant: string;
  owner: string;
  startup?: string;
  status: MeetingStatus;
  title?: string;
  segments?: MeetingSegment[];
  consent_confirmed_at?: string;
  started_at?: string;
  ended_at?: string;
  created: string;
  updated: string;
}

/** Normaliserar en segments-array från DB: filtrerar skräp, dedupe:ar på index. */
export function normalizeMeetingSegments(raw: unknown): MeetingSegment[] {
  if (!Array.isArray(raw)) return [];
  const byIndex = new Map<number, MeetingSegment>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const index = Number(rec.index);
    if (!Number.isInteger(index) || index < 0 || index > MAX_MEETING_SEGMENTS) continue;
    const text = typeof rec.text === 'string' ? rec.text : '';
    const seg: MeetingSegment = { index, text };
    if (typeof rec.at === 'string' && rec.at) seg.at = rec.at;
    if (typeof rec.speaker === 'string' && rec.speaker) seg.speaker = rec.speaker;
    // Sista skrivningen för ett index vinner (retry-uppladdningar).
    byIndex.set(index, seg);
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

/**
 * Sätter ihop segmenten till ett läsbart transkript. Saknade index (segment
 * vars uppladdning föll) blir en tydlig lucka-markör i stället för att texten
 * tyst hoppar — coachen ska aldrig luras tro att transkriptet är komplett.
 * Sammanhängande luckor markeras EN gång.
 */
export function assembleMeetingTranscript(raw: unknown): string {
  const segments = normalizeMeetingSegments(raw);
  if (segments.length === 0) return '';
  const maxIndex = segments[segments.length - 1].index;
  const byIndex = new Map(segments.map((s) => [s.index, s]));

  const parts: string[] = [];
  let buffer: string[] = [];
  let inGap = false;
  const flush = () => {
    const text = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
    buffer = [];
  };

  for (let i = 0; i <= maxIndex; i++) {
    const seg = byIndex.get(i);
    if (!seg) {
      if (!inGap) {
        flush();
        parts.push(MEETING_GAP_MARKER);
        inGap = true;
      }
      continue;
    }
    inGap = false;
    const clean = seg.text.replace(/\s+/g, ' ').trim();
    if (clean) {
      buffer.push(seg.speaker ? `${seg.speaker}: ${clean}` : clean);
    }
  }
  flush();
  return parts.join('\n\n');
}

/** Sammanlagd textlängd (för tak-kontroller och UI-visning). */
export function meetingTranscriptChars(raw: unknown): number {
  return normalizeMeetingSegments(raw).reduce((sum, s) => sum + s.text.length, 0);
}

/** h:mm:ss (eller m:ss under en timme) för mötestimern. */
export function formatMeetingClock(totalSeconds: number): string {
  const safe =
    Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Är mötet äldre än purge-fönstret? (`referenceIso` = radens `updated`.) */
export function isStaleMeeting(
  referenceIso: string | undefined,
  now: Date = new Date()
): boolean {
  if (!referenceIso) return false;
  const ts = new Date(referenceIso).getTime();
  if (Number.isNaN(ts)) return false;
  return now.getTime() - ts > MEETING_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Referens på ett assistant-meddelande när agenten förberett mötesläget
 * (verktyget `start_meeting`, § 34). UI:t renderar ett möteskort med en
 * "Starta mötet"-knapp — själva starten (och samtycket) är ALLTID ett
 * mänskligt klick; agenten kan aldrig starta en inspelning själv.
 */
export interface MeetingRequestRef {
  /** Förifyllt bolag (fuzzy-matchat av agenten) — coachen kan byta. */
  startup_id?: string;
  startup_name?: string;
  /** Förifylld mötestitel. */
  title?: string;
}
