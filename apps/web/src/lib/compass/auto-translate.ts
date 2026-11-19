import 'server-only';
import type PocketBase from 'pocketbase';
import {
  compassEntriesToTranslate,
  compassTranslatableEntries,
  mergeCompassTranslation,
  normalizeCompassTranslations,
  type TranslatableQuestion
} from '@platform/shared';
import { translateCompassEntries } from '@/lib/ai/compass-translate';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { logAiUsage } from '@/lib/ai/usage';
import type { CompassModule } from './types';

/* Automatisk engelsk version av en Startupkompass-modul (CLAUDE.md § 23.13).

   När en besökare väljer English på /m/<slug> översätts modulens
   besökartexter (Mistral, EU) och sparas på modulen
   (`compass_modules.translations.en`). Nästa besökare får de sparade
   texterna direkt; bara texter som saknas eller vars svenska källa ändrats
   översätts på nytt. Det finns inget redaktörssteg.

   Fail-soft i varje led: saknad nyckel, nått månadstak (§ 9.6), fel från
   modellen eller ett schema utan fältet ger det som redan finns sparat —
   resten visas på svenska. Sidan går aldrig sönder av översättningen. */

/** Samtidiga besökare på samma modul delar EN pågående översättning. */
const inflight = new Map<string, Promise<Record<string, string>>>();
/** Efter ett misslyckat försök väntar vi innan nästa — ingen anropsstorm. */
const retryAfter = new Map<string, number>();
const RETRY_COOLDOWN_MS = 5 * 60_000;
/**
 * Så länge väntar en besökare på översättningen. Tar den längre visas det
 * som redan finns (resten på svenska) medan översättningen går klart i
 * bakgrunden och sparas — nästa sidvisning får den.
 */
const VISITOR_WAIT_MS = 15_000;

function withVisitorTimeout(
  run: Promise<Record<string, string>>,
  fallback: Record<string, string>
): Promise<Record<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Record<string, string>>((resolve) => {
    timer = setTimeout(() => resolve(fallback), VISITOR_WAIT_MS);
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

/**
 * De engelska texterna för modulen — översätter och sparar det som saknas.
 * `pb` måste få skriva modulen (superuser på den publika sidan). `tenant`
 * härleds av anroparen FRÅN modulen, aldrig från requesten.
 */
export async function ensureEnglishTexts(
  pb: PocketBase,
  module: CompassModule,
  questions: TranslatableQuestion[],
  tenant: string
): Promise<Record<string, string>> {
  const entries = compassTranslatableEntries(module, questions);
  const stored = normalizeCompassTranslations(module.translations).en;
  const current = stored?.texts ?? {};
  const todo = compassEntriesToTranslate(entries, stored);
  if (todo.length === 0) return current;
  if ((retryAfter.get(module.id) ?? 0) > Date.now()) return current;

  const running = inflight.get(module.id);
  if (running) return withVisitorTimeout(running, current);

  const run = (async (): Promise<Record<string, string>> => {
    try {
      await assertWithinAiBudget(pb, tenant);
      const res = await translateCompassEntries(todo);
      for (const u of res.usage) {
        // Anonymt publikt flöde — loggas utan användare, räknas mot taket.
        await logAiUsage(pb, {
          tenant,
          surface: 'suggestions',
          model: u.model,
          tokensIn: u.tokensIn,
          tokensOut: u.tokensOut
        });
      }
      const merged = mergeCompassTranslation(entries, stored, res.texts, new Date().toISOString());
      if (compassEntriesToTranslate(entries, merged).length > 0) {
        retryAfter.set(module.id, Date.now() + RETRY_COOLDOWN_MS);
      } else {
        retryAfter.delete(module.id);
      }
      try {
        const saved = await pb
          .collection('compass_modules')
          .update<CompassModule>(module.id, { translations: { en: merged } });
        // PocketBase släpper okända fält TYST (§ 24.4): utan migration
        // 1700000216 sparas inget och varje visning skulle översätta om.
        if (saved.translations == null) {
          retryAfter.set(module.id, Date.now() + RETRY_COOLDOWN_MS);
          console.warn('[compass] translations field missing — run migration 1700000216');
        }
      } catch (err) {
        retryAfter.set(module.id, Date.now() + RETRY_COOLDOWN_MS);
        console.warn('[compass] could not store translation', { status: statusOf(err) });
      }
      return merged.texts;
    } catch (err) {
      retryAfter.set(module.id, Date.now() + RETRY_COOLDOWN_MS);
      console.warn('[compass] auto-translation failed', {
        reason: err instanceof AiBudgetExceededError ? 'budget' : 'model',
        status: statusOf(err)
      });
      return current;
    } finally {
      inflight.delete(module.id);
    }
  })();
  inflight.set(module.id, run);
  return withVisitorTimeout(run, current);
}

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err
    ? (err as { status?: number }).status
    : undefined;
}
