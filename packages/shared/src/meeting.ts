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
 * LÄNGSTA segment i sekunder (hårt tak). Klienten fångar ljudet som en
 * kontinuerlig PCM-ström (Web Audio, ingen MediaRecorder-omstart — omstarten
 * tappade några hundra millisekunder tal i varje skarv) och klipper helst i
 * en PAUS i talet mellan `MEETING_MIN_SEGMENT_SECONDS` och det här taket, så
 * att ord aldrig delas mitt itu. Nås taket utan paus klipps segmentet ändå.
 * Kort nog för live-känsla och liten förlust vid krasch; lång nog för att
 * ge modellen sammanhang. Se `meeting-segmenter.ts`.
 */
export const MEETING_SEGMENT_SECONDS = 90;

/** Tidigast klipp (i en paus) för ordinarie segment. */
export const MEETING_MIN_SEGMENT_SECONDS = 60;

/**
 * Det FÖRSTA segmentet hålls kort så att live-transkriptet syns snabbt —
 * annars ser ett kort möte (eller de första 90 sekunderna av ett långt) ut
 * som att transkriberingen inte fungerar. Ett tidigt fel (t.ex. Voxtral
 * felkonfigurerad) upptäcks då också direkt i stället för efter 90 s.
 * Segmentlängder är en ren klientangelägenhet — servern bryr sig bara om
 * index (luck-detekteringen) och per-klipp-taken i voice.ts.
 */
export const MEETING_FIRST_SEGMENT_SECONDS = 20;

/** Tidigast klipp (i en paus) för det första segmentet. */
export const MEETING_FIRST_SEGMENT_MIN_SECONDS = 8;

/**
 * Så lång sammanhängande tystnad (ms) som räknas som en paus att klippa i.
 * Naturliga andningspauser mellan meningar är 300–800 ms; 500 ms fångar dem
 * utan att klippa mitt i en tvekan inne i en mening.
 */
export const MEETING_PAUSE_MS = 500;

/** Hårt tak på möteslängd (robusthet/kostnad, EU AI Act art. 15). */
export const MAX_MEETING_SECONDS = 3 * 60 * 60;

/**
 * Hårt tak på antal segment per möte. 3 h med klipp tidigast var 60:e sekund
 * = 180 segment; marginalen täcker det korta första segmentet och retries.
 */
export const MAX_MEETING_SEGMENTS = 240;

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
 * En talartur inom ETT segment (Fas 3-diarisering, § 34.4 — env-gated).
 * Etiketten är SEGMENTLOKAL och anonym ("S1", "S2"): ljudet finns inte kvar
 * att jämföra mot mellan segment och röstavtryck byggs aldrig, så "S1" i två
 * olika segment är inte nödvändigtvis samma person. Transkriptet renderar
 * därför turerna som repliker med talstreck, inte med numrerade talare —
 * numreringen sätter den språkliga turindelningen (Fas 2) eller coachen.
 */
export interface MeetingTurn {
  speaker: string;
  text: string;
}

export const MAX_MEETING_TURNS_PER_SEGMENT = 200;

/** Markör för en replik (talarbyte upptäckt i ljudet). */
export const MEETING_TURN_PREFIX = '– ';

/**
 * Ett transkriberat segment. `speaker` är reserverat för en framtida
 * segmentövergripande talarindelning (anonyma etiketter som en människa
 * döper; biometrisk röstidentifiering byggs ALDRIG, § 31.4).
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
  /** Talarturer inom segmentet när diarisering var på (annars utelämnat). */
  turns?: MeetingTurn[];
  /** Språkkod modellen rapporterade för segmentet (diagnostik, PII-fri). */
  language?: string;
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

/** Normaliserar ett segments talarturer: bara `{speaker, text}` med text, cappat. */
export function normalizeMeetingTurns(raw: unknown): MeetingTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === 'string' ? rec.text.replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const speaker = typeof rec.speaker === 'string' && rec.speaker.trim() ? rec.speaker.trim() : '?';
    out.push({ speaker, text });
    if (out.length >= MAX_MEETING_TURNS_PER_SEGMENT) break;
  }
  return out;
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
    if (typeof rec.language === 'string' && /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(rec.language)) {
      seg.language = rec.language.toLowerCase();
    }
    const turns = normalizeMeetingTurns(rec.turns);
    if (turns.length > 0) seg.turns = turns;
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
    // Diariserat segment med MINST två talarbyten: varje tur blir en egen
    // replik med talstreck (aldrig numrerade talare — etiketterna är
    // segmentlokala, se MeetingTurn). En enda tur är bara vanlig text.
    if (seg.turns && seg.turns.length >= 2) {
      flush();
      for (const turn of seg.turns) {
        parts.push(`${MEETING_TURN_PREFIX}${turn.text}`);
      }
      continue;
    }
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
