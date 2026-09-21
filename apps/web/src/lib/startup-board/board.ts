// Ren modell (ingen IO) för bolagskanbanen — fliken "Aktiviteter" på
// bolagskortet (/startups/[id]/aktiviteter, CLAUDE.md § 15.7).
//
// Tavlan visar bolagets `tasks` fördelade på SEX kolumner (Miro-stil).
// Kolumn-id:n är råa tasks.status-värden (migration 1700000129 lade till
// backlog/review), så drag-and-drop persisterar status direkt utan
// mappningslager. `cancelled` visas inte på tavlan.

export type StartupBoardStatus =
  | 'backlog'
  | 'open'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'done';

export const STARTUP_BOARD_COLUMNS: { id: StartupBoardStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlogg' },
  { id: 'open', label: 'Att göra' },
  { id: 'in_progress', label: 'Pågår' },
  { id: 'review', label: 'Granskas' },
  { id: 'blocked', label: 'Blockerad' },
  { id: 'done', label: 'Klar' }
];

export const STARTUP_BOARD_STATUSES = STARTUP_BOARD_COLUMNS.map((c) => c.id);

export function isStartupBoardStatus(value: string): value is StartupBoardStatus {
  return (STARTUP_BOARD_STATUSES as string[]).includes(value);
}

/** Movexum-kollega på ett kort. Interna användare — aldrig AI-kontext (§ 15.3). */
export interface BoardAssignee {
  id: string;
  name: string;
}

export interface StartupBoardTask {
  id: string;
  status: StartupBoardStatus;
  title: string;
  /** tasks.kind — driver ikon/etikett. */
  kind: string;
  dueAt?: string;
  ownerId?: string;
  ownerName?: string;
  assignees: BoardAssignee[];
  /** Förberäknad per-kort RBAC (staff eller ägare). */
  canEdit: boolean;
}
