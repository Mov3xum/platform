import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import {
  getUnseenCount,
  listNotificationsForUser,
  toNotificationView
} from '@/lib/notifications-server';

/**
 * Klockan i topplisten (CLAUDE.md § 50) pollar hit: antal osedda notiser +
 * de senaste notiserna som visningsmodell. Läser med användarens egen token
 * (RLS: `@request.auth.id = user`) — svaret innehåller aldrig någon annans
 * notiser. Inloggningscookien är httpOnly, så webbläsaren kan inte prenumerera
 * på PocketBase direkt; pollning på fokus + intervall räcker (§ 44-mönstret).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? '10');
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 30) : 10;
  const countOnly = url.searchParams.get('count') === '1';

  const pb = await getServerPb();
  const [unseen, items] = await Promise.all([
    getUnseenCount(pb, user.id),
    countOnly ? Promise.resolve([]) : listNotificationsForUser(pb, user.id, { limit })
  ]);

  return NextResponse.json(
    { unseen, items: items.map(toNotificationView) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
