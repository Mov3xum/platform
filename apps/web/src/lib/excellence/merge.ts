import type { GroupCompanyFacts } from '@platform/shared';

// REN hjälpare (§ 51.7): slår ihop ett NYTT uppslag för ett koncernbolag med
// det som redan finns i underlaget. Bara de delar som faktiskt hämtades nu
// ersätter — en hämtning av enbart bokslut rör inte ägarbilden, och en
// hämtning av bara verklig huvudman ersätter enbart huvudmannens rader
// (samma regel som `startup_ownership.source_part`, § 11.8).

export function mergeGroupCompanyFacts(existing: GroupCompanyFacts | undefined, fresh: GroupCompanyFacts): GroupCompanyFacts {
  if (!existing) return fresh;
  const freshParts = new Set<'group_structure' | 'beneficial_owners'>();
  if (fresh.groupStructureFetched) freshParts.add('group_structure');
  if (fresh.beneficialOwnersFetched) freshParts.add('beneficial_owners');
  // Rader utan `part` (äldre underlag) räknas till den del som hämtades nu
  // bara när BÅDA delarna hämtades — annars kan de inte särskiljas och behålls.
  const replaceUntagged = freshParts.size === 2;
  const kept = existing.ownership.filter((o) => {
    if (!o.part) return !replaceUntagged;
    return !freshParts.has(o.part);
  });
  return {
    ...existing,
    name: fresh.name ?? existing.name,
    dataFetched: existing.dataFetched || fresh.dataFetched,
    basic: fresh.basic ?? existing.basic,
    financials: fresh.financials !== undefined ? fresh.financials : existing.financials,
    ownership: freshParts.size > 0 ? [...kept, ...fresh.ownership] : existing.ownership,
    groupStructureFetched: existing.groupStructureFetched || fresh.groupStructureFetched,
    beneficialOwnersFetched: existing.beneficialOwnersFetched || fresh.beneficialOwnersFetched,
    groupMembers: fresh.groupMembers !== undefined ? fresh.groupMembers : existing.groupMembers,
    deMinimis: fresh.deMinimis ?? existing.deMinimis,
    ownerEngagements: fresh.ownerEngagements !== undefined ? fresh.ownerEngagements : existing.ownerEngagements
  };
}

/** Byter ut (eller lägger till) bolaget med samma org-nr i listan över koncernbolag. */
export function upsertGroupCompany(related: readonly GroupCompanyFacts[], fresh: GroupCompanyFacts): GroupCompanyFacts[] {
  const idx = related.findIndex((r) => r.orgNr === fresh.orgNr);
  if (idx === -1) return [...related, fresh];
  return related.map((r, i) => (i === idx ? mergeGroupCompanyFacts(r, fresh) : r));
}
