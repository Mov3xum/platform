import PocketBase from 'pocketbase';
import { stripFilterBackslashes } from './pb-filter';

/**
 * Patchar SDK:ns `pb.filter(raw, params)` EN gång per process så att
 * strängparametrar (även strängar inuti objekt/arrayer som JSON-serialiseras)
 * aldrig bär bakstreck. SDK:n escapar bara `'` — ett värde som slutar på `\`
 * gav `'…\'` där det avslutande citattecknet räknas som escapat av
 * fexpr-skannern, och strängliteralen "svalde" resten av filtret (§ 10.3
 * A.8.9, incident 2026-09-30). Alla anropare av `pb.filter` (hundratals) får
 * skyddet utan ändring. Importeras som sidoeffekt av `auth.server.ts` och
 * `integrations/credentials.ts` (de två PB-fabrikerna) — och därmed av varje
 * request.
 */
type FilterFn = (raw: string, params?: Record<string, unknown>) => string;
const PATCHED = Symbol.for('movexum.pbFilterGuard');

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return stripFilterBackslashes(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitize(v);
    return out;
  }
  return value;
}

export function installPbFilterGuard(): void {
  const proto = PocketBase.prototype as unknown as Record<string | symbol, unknown>;
  if (proto[PATCHED]) return;
  const original = proto.filter as FilterFn;
  proto.filter = function guardedFilter(this: PocketBase, raw: string, params?: Record<string, unknown>) {
    return original.call(this, raw, params ? (sanitize(params) as Record<string, unknown>) : params);
  } as FilterFn;
  proto[PATCHED] = true;
}

installPbFilterGuard();
