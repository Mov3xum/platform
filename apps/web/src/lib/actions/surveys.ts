'use server';

import type PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hasRole } from '@/lib/rbac';
import { getSurvey, newPublicSlug } from '@/lib/surveys/store';
import {
  SURVEY_TEMPLATES,
  isSurveyKind,
  normalizeSurveyQuestions,
  type SurveyQuestion
} from '@platform/shared';

// Marknadsverktyg → Utvärdering (CLAUDE.md § 39). RBAC: admin/incubator_lead/
// coach (samma krets som Startupkompassens modul-admin). Tenant korsverifieras
// mot den inloggade före varje skrivning; superuser-fallback bara vid PB
// v0.23.4:s tysta regel-nekande (400/403/404, § 21.3) EFTER den kontrollen.

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

async function requireManager() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) throw new Error('Forbidden');
  if (!user.tenant) throw new Error('Forbidden');
  return user;
}

async function writeWithFallback<T>(
  pb: PocketBase,
  run: (c: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 400 && status !== 403 && status !== 404) throw err;
    const su = await getSuperuserPb();
    if (!su.ok) throw err;
    return await run(su.pb);
  }
}

function cap(v: FormDataEntryValue | null, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

/** Skapar en enkät från en mall och skickar staff vidare till byggaren. */
export async function createSurveyAction(formData: FormData) {
  const user = await requireManager();
  const kindRaw = String(formData.get('kind') || 'custom');
  const kind = isSurveyKind(kindRaw) ? kindRaw : 'custom';
  const tpl = SURVEY_TEMPLATES[kind];
  const name = cap(formData.get('name'), 160) || tpl.label;

  const pb = await getServerPb();
  let created: { id: string } | null = null;
  // Den slumpade sluggen kolliderar i praktiken aldrig; ett unikt-index-fel
  // (400) ger ett nytt försök i stället för ett hårt fel.
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const payload = {
      tenant: user.tenant,
      name,
      kind,
      description: tpl.description,
      welcome_title: tpl.welcome_title,
      welcome_body: tpl.welcome_body,
      thank_you_message: tpl.thank_you_message,
      questions: tpl.questions,
      is_active: false,
      public_slug: newPublicSlug(),
      created_by: user.id
    };
    try {
      created = await writeWithFallback(pb, (c) =>
        c.collection('surveys').create<{ id: string }>(payload)
      );
    } catch (err) {
      if (attempt === 2) {
        console.error('[surveys] create failed', (err as { status?: number })?.status);
        throw new Error('Kunde inte skapa enkäten. Har migration 1700000149 körts?');
      }
    }
  }
  revalidatePath('/inflode/utvardering');
  redirect(`/inflode/utvardering/${created!.id}`);
}

export interface SaveSurveyInput {
  id: string;
  name: string;
  description: string;
  welcome_title: string;
  welcome_body: string;
  thank_you_message: string;
  questions: SurveyQuestion[];
  is_active: boolean;
}

export type SaveSurveyResult = { ok: true; questions: SurveyQuestion[] } | { ok: false; error: string };

export async function saveSurveyAction(input: SaveSurveyInput): Promise<SaveSurveyResult> {
  const user = await requireManager();
  const pb = await getServerPb();
  const existing = await getSurvey(pb, user.tenant, String(input?.id || ''));
  if (!existing) return { ok: false, error: 'Enkäten hittades inte.' };

  const name = String(input.name || '').trim().slice(0, 160);
  if (!name) return { ok: false, error: 'Enkäten behöver ett namn.' };

  // Frågornas id:n är stabila — svaren lagras under dem. Normaliseringen
  // behåller inskickade id:n; nya frågor får härledda.
  const questions = normalizeSurveyQuestions(input.questions);
  if (input.is_active && questions.length === 0) {
    return { ok: false, error: 'Lägg till minst en fråga innan du publicerar.' };
  }

  const payload = {
    name,
    description: String(input.description || '').trim().slice(0, 500),
    welcome_title: String(input.welcome_title || '').trim().slice(0, 160),
    welcome_body: String(input.welcome_body || '').trim().slice(0, 2000),
    thank_you_message: String(input.thank_you_message || '').trim().slice(0, 500),
    questions,
    is_active: input.is_active === true
  };
  try {
    await writeWithFallback(pb, (c) => c.collection('surveys').update(existing.id, payload));
  } catch (err) {
    console.error('[surveys] update failed', (err as { status?: number })?.status);
    return { ok: false, error: 'Kunde inte spara enkäten.' };
  }
  revalidatePath('/inflode/utvardering');
  revalidatePath(`/inflode/utvardering/${existing.id}`);
  return { ok: true, questions };
}

export async function deleteSurveyAction(formData: FormData) {
  const user = await requireManager();
  const id = String(formData.get('id') || '');
  const pb = await getServerPb();
  const existing = await getSurvey(pb, user.tenant, id);
  if (existing) {
    try {
      await writeWithFallback(pb, (c) => c.collection('surveys').delete(existing.id));
    } catch (err) {
      console.error('[surveys] delete failed', (err as { status?: number })?.status);
      throw new Error('Kunde inte radera enkäten.');
    }
  }
  revalidatePath('/inflode/utvardering');
  redirect('/inflode/utvardering');
}
