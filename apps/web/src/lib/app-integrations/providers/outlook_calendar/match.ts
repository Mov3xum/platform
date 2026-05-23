import 'server-only';
import type { OutlookEvent } from './calendar';

/**
 * Matchar Outlook-händelser mot CRM-entiteter via deltagar-/organisatörs-
 * e-post. Ren funktion — inga sidoeffekter, ingen I/O — så den är lätt att
 * enhetstesta med mock-events.
 *
 * CLAUDE.md § 14: e-posten används bara transient för matchning mot redan
 * samtyckta `contacts`/team-medlemmar. Inget persisteras, inget loggas,
 * inget når AI-kontexten.
 */

export interface EmailIndexEntry {
  kind: 'contact' | 'team';
  refId: string; // contact-id resp. team-member-id
  name: string;
  startupId: string;
}

/** email (lowercase) → en eller flera CRM-entiteter som delar adressen. */
export type EmailIndex = Map<string, EmailIndexEntry[]>;

export interface EventMatch {
  event: OutlookEvent;
  contactRefId?: string; // första matchade kontakt (för task-länk)
  contactName?: string;
  startupIds: string[]; // unika bolag som eventet matchar
}

function collectEmails(event: OutlookEvent): string[] {
  const set = new Set<string>();
  if (event.organizerEmail) set.add(event.organizerEmail);
  for (const e of event.attendeeEmails ?? []) set.add(e);
  return Array.from(set);
}

/**
 * Annoterar varje event med matchade entiteter. Events utan träff utelämnas
 * INTE — anropare avgör om de vill filtrera på `startupIds.length`.
 */
export function matchEventsToContacts(
  events: OutlookEvent[],
  index: EmailIndex
): EventMatch[] {
  return events.map((event) => {
    const startupIds = new Set<string>();
    let contactRefId: string | undefined;
    let contactName: string | undefined;

    for (const email of collectEmails(event)) {
      const entries = index.get(email);
      if (!entries) continue;
      for (const entry of entries) {
        startupIds.add(entry.startupId);
        // Föredra en `contact`-träff som task-länk; team-medlem som fallback.
        if (!contactRefId || (entry.kind === 'contact' && contactName === undefined)) {
          if (entry.kind === 'contact') {
            contactRefId = entry.refId;
            contactName = entry.name;
          } else if (!contactName) {
            contactName = entry.name;
          }
        }
      }
    }

    return {
      event,
      contactRefId,
      contactName,
      startupIds: Array.from(startupIds)
    };
  });
}

/** Behåller bara events som matchar minst ett bolag. */
export function matchedEventsForStartup(
  matches: EventMatch[],
  startupId: string
): EventMatch[] {
  return matches.filter((m) => m.startupIds.includes(startupId));
}
