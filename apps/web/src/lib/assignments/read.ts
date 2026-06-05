import 'server-only';
import type PocketBase from 'pocketbase';
import { getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Returnerar PB-klienten som ska användas för att LÄSA bolagstilldelningar
 * (workshops + utbildningsdokument) och bolagsraden de hänger på.
 *
 * VARFÖR superuser: PB v0.23.4:s rule-eval kan TYST returnera noll rader för
 * en annars behörig bolagsmedlem (`linked_startups`-matchningen i list/view-
 * regeln, CLAUDE.md § 21.3). Till skillnad från en SKRIVNING — som ger 400/403
 * och kan superuser-fallbackas vid fel (mönstret i § 18.3) — ger en trasig
 * LÄSREGEL ingen felsignal alls, bara en tom lista. Fallback-på-fel räcker
 * därför inte för läsningar; vi måste läsa via superuser för att tilldelningen
 * ska bli synlig för bolaget oavsett om den senaste regel-fixen nått live-DB.
 *
 * SÄKERHET: superuser KRINGGÅR RLS. Anroparen MÅSTE därför (1) redan ha
 * verifierat att den inloggade får se bolaget (staff/observer = tenant-brett;
 * `startup_member` = bolaget finns i `linked_startups`), och (2) ALLTID skopa
 * varje fråga explicit på `tenant` + `startup` i appen (med `escFilter`).
 * Helpern ger bara klienten — den gör ingen egen behörighetskontroll.
 *
 * Saknas superuser-credentials (t.ex. lokal dev) faller vi tillbaka på
 * användarens token → RLS gäller som vanligt (best-effort, samma beteende
 * som tidigare).
 */
export async function getAssignmentReadPb(): Promise<PocketBase> {
  const su = await getSuperuserPb();
  if (su.ok) return su.pb;
  return getServerPb();
}
