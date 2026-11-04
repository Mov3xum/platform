import { NextResponse } from 'next/server';
import { coreModules, isValidModuleId, MODULE_ID_ALIASES } from '@platform/shared';
import { getCurrentUser } from '@/lib/auth.server';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { recordVisit } from '@/lib/user-activity/record.server';

/**
 * Besöksbeacon för användaraktivitet (CLAUDE.md § 57). `ActivityBeacon` i
 * skalet POST:ar `{ module }` när sidmenyns modul byts. Servern litar bara på
 * sessionen (användare + tenant ur `getCurrentUser`) och på ett modul-id som
 * finns i modulregistret — aldrig en sökväg, aldrig en post. Svarar alltid
 * 204 utom vid fel på anropet; ett misslyckande här får aldrig synas för
 * användaren (klienten ignorerar svaret).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_PER_USER = 120;

const KNOWN_MODULE_IDS = new Set(coreModules.map((m) => MODULE_ID_ALIASES[m.id] ?? m.id));

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });

  let body: { module?: unknown } = {};
  try {
    body = (await request.json()) as { module?: unknown };
  } catch {
    return NextResponse.json({ error: 'Ogiltig request-body.' }, { status: 400 });
  }
  const raw = body.module;
  const moduleId = isValidModuleId(raw) ? (MODULE_ID_ALIASES[raw] ?? raw) : null;
  if (!moduleId || !KNOWN_MODULE_IDS.has(moduleId)) {
    return NextResponse.json({ error: 'Okänd modul.' }, { status: 400 });
  }

  const rateKey = `activity:visit:${user.id}`;
  const limited = await checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) return new NextResponse(null, { status: 429 });

  const counted = await recordVisit(user.id, user.tenant, moduleId);
  // Bara besök som faktiskt räknades belastar gränsen (throttlade är gratis).
  if (counted) await recordFailure(rateKey, RATE_WINDOW_MS);
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
