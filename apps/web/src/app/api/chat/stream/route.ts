import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { loadOwnedThread, executeThreadTurn } from '@/lib/ai/thread-turn';
import type { ChatAttachment } from '@/lib/ai/chat-input';
import type { Role } from '@platform/shared';

// Streamande chatt-turn för /chatt. Kör samma delade turn-/persistenslogik
// som server-action-fallbacken (`executeThreadTurn`) men strömmar agentens
// verktygssteg ("Läser bolagsdata", "Skapar PowerPoint") live till klienten
// medan turen körs, och avslutar med hela det sparade meddelandeflödet.
//
// Säkerhet: samma RBAC som sendThreadMessageAction (staff-only), ägar-/
// tenant-verifierad tråd, ingen ny dataväg (executeThreadTurn äger
// PII-skydd/whitelist). Same-origin POST → cookie följer med automatiskt;
// CSP `connect-src 'self'` tillåter fetchen.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return jsonError('Ej inloggad.', 401);
  if (!hasRole(user.roles, STAFF_ROLES)) return jsonError('Åtkomst nekad.', 403);

  let body: {
    threadId?: unknown;
    text?: unknown;
    includeWebContext?: unknown;
    attachments?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('Body måste vara JSON.', 400);
  }

  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  const text = typeof body.text === 'string' ? body.text : '';
  if (!threadId) return jsonError('threadId saknas.', 400);

  const includeWebContext = body.includeWebContext === true;
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments as ChatAttachment[])
    : undefined;

  const pb = await getServerPb();
  const thread = await loadOwnedThread(pb, threadId, user);
  if (!thread) return jsonError('Tråden hittades inte.', 404);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          /* klienten kopplade ifrån — turen körs ändå färdigt och sparas */
        }
      };
      try {
        const result = await executeThreadTurn(pb, user, thread, text, {
          includeWebContext,
          attachments,
          onStep: (step) => send({ type: 'step', ...step })
        });
        if (result.error) send({ type: 'error', error: result.error });
        else send({ type: 'final', messages: result.messages });
      } catch (err) {
        console.error('[chat-stream] turn threw', {
          tenant: user.tenant,
          error: err instanceof Error ? err.message : err
        });
        send({ type: 'error', error: 'Kunde inte hämta svar just nu — försök igen.' });
      } finally {
        try {
          controller.close();
        } catch {
          /* redan stängd */
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Hindra nginx/proxy från att buffra strömmen (annars syns inga steg
      // förrän hela svaret är klart).
      'X-Accel-Buffering': 'no'
    }
  });
}
