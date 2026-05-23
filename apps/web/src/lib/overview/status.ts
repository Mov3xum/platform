// Normaliserad modell för "Min översikt"-boarden. Pure module (ingen IO)
// så den kan importeras både server-side (aggregate.ts) och i klient-
// komponenterna (OverviewBoard m.fl.).
//
// Två kollektioner med olika status-enums mappas till fyra board-kolumner:
//   tasks.status:      open | in_progress | blocked  | done | cancelled
//   activities.status: planned | in_progress | (—)    | done | cancelled
// `cancelled` filtreras bort helt. Activities saknar "blocked" → kolumnen
// "Väntar" är inte ett giltigt drop-mål för aktivitetskort.

export type WorkItemSource = 'task' | 'activity';
export type BoardStatus = 'todo' | 'in_progress' | 'waiting' | 'done';

export const BOARD_COLUMNS: { id: BoardStatus; label: string }[] = [
  { id: 'todo', label: 'Att göra' },
  { id: 'in_progress', label: 'Pågående' },
  { id: 'waiting', label: 'Väntar' },
  { id: 'done', label: 'Klar' }
];

/** Råstatus → board-kolumn. Returnerar null för värden som inte ska visas. */
export function toBoardStatus(source: WorkItemSource, raw: string): BoardStatus | null {
  if (source === 'task') {
    switch (raw) {
      case 'open':
        return 'todo';
      case 'in_progress':
        return 'in_progress';
      case 'blocked':
        return 'waiting';
      case 'done':
        return 'done';
      default:
        return null; // cancelled / okänt
    }
  }
  // activity
  switch (raw) {
    case 'planned':
      return 'todo';
    case 'in_progress':
      return 'in_progress';
    case 'done':
      return 'done';
    default:
      return null; // cancelled — och 'waiting' finns inte
  }
}

/** Board-kolumn → råstatus att persistera. null = ogiltig för källan. */
export function toRawStatus(source: WorkItemSource, board: BoardStatus): string | null {
  if (source === 'task') {
    switch (board) {
      case 'todo':
        return 'open';
      case 'in_progress':
        return 'in_progress';
      case 'waiting':
        return 'blocked';
      case 'done':
        return 'done';
    }
  }
  // activity har ingen 'waiting'
  switch (board) {
    case 'todo':
      return 'planned';
    case 'in_progress':
      return 'in_progress';
    case 'done':
      return 'done';
    case 'waiting':
      return null;
  }
  return null;
}

/** Får ett kort av denna källa släppas i kolumnen? */
export function isDroppableForSource(source: WorkItemSource, board: BoardStatus): boolean {
  return toRawStatus(source, board) !== null;
}

export interface WorkItem {
  id: string;
  source: WorkItemSource;
  status: BoardStatus;
  title: string;
  /** tasks.kind | activities.type — driver ikon/etikett. */
  kind: string;
  dueAt?: string;
  startsAt?: string;
  ownerId?: string;
  ownerName?: string;
  startupId?: string;
  startupName?: string;
  /** Endast UI för ägaren — får ALDRIG skickas till AI-kontext (§15.3). */
  contactName?: string;
  /** Förberäknad per-item RBAC (staff eller ägare). */
  canEdit: boolean;
}

export type OutlookState = 'connected' | 'disconnected' | 'error';

export interface AgendaItem {
  id: string;
  source: 'event' | 'outlook';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  url?: string;
  isOnline?: boolean;
}
