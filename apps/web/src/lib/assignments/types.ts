/**
 * Delade typer för tilldelnings-samarbete (CLAUDE.md § 18.4). Hålls i en egen
 * fil utan `server-only` så att klientkomponenter kan importera typen.
 */

export interface AssignableResource {
  id: string;
  name: string;
}

/** Options-objekt som skickas till assign-server-actions. */
export interface AssignmentCollabOptions {
  instructions?: string;
  collaboratorIds?: string[];
  meeting?: { title: string; startsAt: string; endsAt?: string; location?: string };
}
