import 'server-only';
import { headers } from 'next/headers';
import { configuredAppUrl } from '@/lib/app-integrations/app-url';

/**
 * Origin för länkar i utgående mejl (enkätlänk § 47.5, svarslänk § 53.5).
 * Konfigurerad app-URL vinner — `x-forwarded-host` kan i värsta fall vara
 * klientstyrd (mejlade länkar får aldrig peka på en främmande host). Utan
 * konfiguration används staffs egen request (proxy-headers först).
 */
export async function requestOrigin(): Promise<string> {
  const configured = configuredAppUrl();
  if (configured) return configured;
  const h = await headers();
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0]!.trim();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  return host ? `${proto}://${host}` : '';
}
