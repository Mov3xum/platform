'use server';

import type PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hasRole } from '@/lib/rbac';
import { logAiUsage } from '@/lib/ai/usage';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { translateCompassEntries } from '@/lib/ai/compass-translate';
import { logAgentAction } from '@/lib/core/write';
import { describePbError } from '@/lib/pb-error';
import {
  buildStoredCompassTranslation,
  compassTranslatableEntries,
  compassTranslationEntryState,
  normalizeCompassTranslations,
  sortCompassQuestions,
  summarizeCompassTranslation,
  type CompassTranslationSummary
} from '@platform/shared';
import type { CompassModule, CompassQuestion } from '@/lib/compass/types';

/* Engelsk version av en Startupkompass-modul (CLAUDE.md § 23.13).
   Två steg, människa-i-loopen (§ 10.1, EU AI Act art. 14):
   1. `suggestModuleTranslationAction` — AI-förslag (Mistral, EU) som fyller
      editorn. Sparar INGENTING.
   2. `saveModuleTranslationAction` — personalens granskade texter sparas och
      (valfritt) publiceras; först då visas språkknappen på /m/<slug>. */

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err
    ? (err as { status?: number }).status
    : undefined;
}

async function withFallback<T>(pb: PocketBase, run: (c: PocketBase) => Promise<T>): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    // PB v0.23.4 kan tyst neka behörig staff (§ 21.3) — roll + tenant är
    // redan verifierade av anroparen; superusern är robusthet, inte gräns.
    if (status === 400 || status === 403 || status === 404) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}

async function loadModule(
  pb: PocketBase,
  moduleId: string,
  tenant: string
): Promise<{ module: CompassModule; questions: CompassQuestion[] }> {
  if (!/^[a-z0-9]{1,30}$/i.test(moduleId)) throw new Error('Ogiltig modul.');
  const mod = await withFallback(pb, (c) => c.collection('compass_modules').getOne<CompassModule>(moduleId));
  if (String(mod.tenant ?? '') !== tenant) throw new Error('Modulen hittades inte.');
  const questions = await withFallback(pb, (c) =>
    c.collection('compass_questions').getFullList<CompassQuestion>({
      filter: c.filter('module = {:m}', { m: moduleId }),
      sort: 'sort_order',
      batch: 200
    })
  );
  return { module: mod, questions: sortCompassQuestions(questions) };
}

export type SuggestTranslationResult =
  | { ok: true; texts: Record<string, string>; translated: number; failed: boolean }
  | { ok: false; error: string };

/**
 * AI-förslag på engelska. `mode = 'missing'` översätter bara texter som
 * saknas eller vars svenska källa ändrats sedan översättningen; `'all'`
 * översätter om allt. Returnerar förslagen — sparar inget.
 */
export async function suggestModuleTranslationAction(
  moduleId: string,
  mode: 'missing' | 'all'
): Promise<SuggestTranslationResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) return { ok: false, error: 'Du saknar behörighet.' };
  const pb = await getServerPb();
  let loaded;
  try {
    loaded = await loadModule(pb, String(moduleId), user.tenant);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Modulen kunde inte läsas.' };
  }
  const entries = compassTranslatableEntries(loaded.module, loaded.questions);
  const stored = normalizeCompassTranslations(loaded.module.translations).en;
  const todo =
    mode === 'all' ? entries : entries.filter((e) => compassTranslationEntryState(e, stored) !== 'ok');
  if (todo.length === 0) return { ok: true, texts: {}, translated: 0, failed: false };

  try {
    await assertWithinAiBudget(pb, user.tenant);
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return { ok: false, error: 'Månadens AI-budget är förbrukad — översätt för hand eller höj taket.' };
    }
  }

  try {
    const res = await translateCompassEntries(todo);
    for (const u of res.usage) {
      await logAiUsage(pb, {
        tenant: user.tenant,
        userId: user.id,
        surface: 'suggestions',
        model: u.model,
        tokensIn: u.tokensIn,
        tokensOut: u.tokensOut
      });
    }
    return {
      ok: true,
      texts: res.texts,
      translated: Object.keys(res.texts).length,
      failed: res.failedBatches > 0 || Object.keys(res.texts).length < todo.length
    };
  } catch (err) {
    console.error('[compass] translation suggestion failed', { status: statusOf(err) });
    return { ok: false, error: 'AI-översättningen svarade inte just nu. Försök igen om en stund.' };
  }
}

export type SaveTranslationResult =
  | { ok: true; enabled: boolean; summary: CompassTranslationSummary }
  | { ok: false; error: string };

/**
 * Sparar personalens granskade engelska texter. Bara nycklar som finns i
 * modulen nu sparas (borttagna frågor rensas), varje text med hashen av sin
 * svenska källa. `enabled` = publicera (visa språkknappen publikt).
 */
export async function saveModuleTranslationAction(
  moduleId: string,
  texts: Record<string, string>,
  enabled: boolean
): Promise<SaveTranslationResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) return { ok: false, error: 'Du saknar behörighet.' };
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
    return { ok: false, error: 'Ogiltiga texter.' };
  }
  const pb = await getServerPb();
  let loaded;
  try {
    loaded = await loadModule(pb, String(moduleId), user.tenant);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Modulen kunde inte läsas.' };
  }
  const entries = compassTranslatableEntries(loaded.module, loaded.questions);
  const before = normalizeCompassTranslations(loaded.module.translations).en;
  const stored = buildStoredCompassTranslation(entries, texts, {
    enabled: enabled === true,
    updatedAt: new Date().toISOString(),
    updatedBy: user.id
  });
  if (enabled && Object.keys(stored.texts).length === 0) {
    return { ok: false, error: 'Fyll i minst rubriken på engelska innan du publicerar.' };
  }

  try {
    const saved = await withFallback(pb, (c) =>
      c.collection('compass_modules').update<CompassModule>(loaded.module.id, { translations: { en: stored } })
    );
    // PocketBase släpper okända fält TYST (§ 24.4) — läs tillbaka.
    if (!saved || !('translations' in saved) || saved.translations == null) {
      return {
        ok: false,
        error:
          'Fältet för den engelska versionen saknas i databasen — kör migration 1700000216 (eller "Sync PocketBase") och försök igen.'
      };
    }
  } catch (err) {
    console.error('[compass] translation save failed', { status: statusOf(err) });
    return { ok: false, error: describePbError(err, 'Kunde inte spara den engelska versionen.') };
  }

  const summary = summarizeCompassTranslation(entries, stored);
  await logAgentAction(pb, {
    actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
    action_type: 'update',
    collection: 'compass_modules',
    record_id: loaded.module.id,
    field: 'translations',
    before_value: { enabled: before?.enabled ?? false, translated: Object.keys(before?.texts ?? {}).length },
    after_value: {
      name: loaded.module.name,
      enabled: stored.enabled,
      translated: summary.translated,
      total: summary.total
    }
  });

  revalidatePath('/inflode/admin/modules');
  revalidatePath(`/inflode/admin/modules/${loaded.module.slug}`);
  if (loaded.module.public_slug) revalidatePath(`/m/${loaded.module.public_slug}`);
  return { ok: true, enabled: stored.enabled, summary };
}
