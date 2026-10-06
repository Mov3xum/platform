'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  deriveCompetenceAreas,
  sanitizeDevelopmentInterests,
  sanitizeUserCompetenceTags,
  type Role
} from '@platform/shared';
import {
  loadCompetenceTagVocabulary,
  registerCompetenceTags
} from '@/lib/team/competence-tags.server';

// CLAUDE.md § 29 / § 29.7 — Egen profil: yrkestitel, kort bio, kompetens-
// hashtags med nivå och utvecklingsintressen. Användaren uppdaterar SIN EGEN
// users-rad (updateRule = "@request.auth.id = id" + fältlås 1700000174 som
// inte omfattar självservice-fälten), så reads/writes går via användarens
// auth-token. Taggar saneras mot slug-reglerna + tenantens vokabulär och
// kompetensOMRÅDENA (`users.competences`) HÄRLEDS ur taggarna (klienten är
// aldrig säkerhetsgränsen). Nya taggar registreras i tenantens vokabulär
// (status suggested) så kollegornas autocomplete lär sig språket. Ingen PII
// utöver det användaren själv skriver; bio cappas. Fälten når aldrig
// AI-kontexten — bara den isolerade teammatcharen läser dem.

/** Bara Movexum-personal bidrar till den gemensamma vokabulären (§ 29.7). */
const VOCABULARY_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export type ProfileActionState = { error?: string; ok?: boolean; warning?: string };

function parseJsonField(formData: FormData, name: string): unknown {
  const raw = String(formData.get(name) || '').trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveMyProfileAction(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const user = await requireUser();

  const title = String(formData.get('title') || '').trim().slice(0, 120);
  const bio = String(formData.get('bio') || '').trim().slice(0, 1000);

  const pb = await getServerPb();
  const vocabulary = await loadCompetenceTagVocabulary(pb, user.tenant);

  const tags = sanitizeUserCompetenceTags(parseJsonField(formData, 'competence_tags_json'), vocabulary);
  const developmentInterests = sanitizeDevelopmentInterests(
    parseJsonField(formData, 'development_interests_json')
  );
  // Områdena är en härledning av taggarna — bakåtkompatibelt med alla ytor
  // som läser users.competences (teampanel, kandidatlista, chatt-guide).
  const competences = deriveCompetenceAreas(tags);

  try {
    await pb.collection('users').update(user.id, {
      title: title || null,
      bio: bio || null,
      competences,
      competence_tags: tags,
      development_interests: developmentInterests,
      // Driver "inaktuell profil"-påminnelsen (§ 29.7). Okänt fält släpps
      // tyst av PB på en instans utan 1700000179 — ofarligt här.
      competence_updated_at: new Date().toISOString()
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara profilen.' };
  }

  // Rollgränsen för vokabulären ligger här (createRule är roll-lös men
  // body-låst): en bolagsmedlem/observer sparar sina taggar på sin egen
  // profil men lägger inget i personalens gemensamma lista.
  if (hasRole(user.roles, VOCABULARY_ROLES)) {
    await registerCompetenceTags(pb, {
      actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
      tags,
      vocabulary
    });
  }

  // Schema-drift (§ 24.4-invarianten): PB släpper okända fält tyst. Läs
  // tillbaka och säg ifrån om taggarna inte fastnade.
  let warning: string | undefined;
  if (tags.length > 0) {
    try {
      const rec = (await pb
        .collection('users')
        .getOne(user.id, { fields: 'id,competence_tags' })) as unknown as { competence_tags?: unknown };
      if (!Array.isArray(rec.competence_tags) || rec.competence_tags.length === 0) {
        warning =
          'Dina kompetensområden sparades, men hashtags och nivåer saknas i databasens schema ' +
          '(kör migration 1700000178). Taggarna syns inte för teammatchningen förrän dess.';
      }
    } catch {
      /* ignore */
    }
  }

  revalidatePath('/min-profil');
  revalidatePath('/uppdrag/new');
  revalidatePath('/konto');
  return warning ? { ok: true, warning } : { ok: true };
}
