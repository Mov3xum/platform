/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 21.8 — tenant-vakt för kollektioner UTAN eget `tenant`-fält.
//
// Kollektioner med `tenant`-fält pinnas i createRule
// (`@request.body.tenant = @request.auth.tenant`, scripts/security-rules.mjs).
// Följande kollektioner ärver tenant via en förälder (bolag, kontakt, modul,
// konversation) och kan inte pinnas i en regel utan en relations-join — som
// PB v0.23.4 tyst nekar i createRules (§ 21.3). Utan vakt kunde en inloggad
// användare med sin egen token skapa en aktivitet/anteckning/teammedlem på en
// ANNAN tenants bolag (bolags-id:n syns i länkar och publika sidor).
//
// Vakten körs på create- OCH update-requests från API:t (inte på interna
// $app-skrivningar), slår upp varje satt förälder och nekar (403) om
// förälderns tenant inte är den inloggades. Superuser-requests (server-
// actionernas verifierade fallback, § 21.3) släpps igenom. Saknad förälder
// (tom relation) lämnas till kollektionens egna regler/validering.
//
// OBS: PB:s JSVM kör varje hanterare i en isolerad kontext — allt som
// hanteraren behöver måste deklareras INNE i den.

function guardHandler(e) {
  const PARENTS = {
    activities: [['startup', 'startups']],
    notes: [['startup', 'startups']],
    milestones: [['startup', 'startups']],
    agreements: [['startup', 'startups']],
    startup_team_members: [['startup', 'startups']],
    partner_engagements: [
      ['startup', 'startups'],
      ['partner', 'partners']
    ],
    startup_contacts: [
      ['startup', 'startups'],
      ['contact', 'contacts']
    ],
    compass_questions: [['module', 'compass_modules']],
    compass_messages: [['conversation', 'compass_conversations']],
    compass_responses: [['conversation', 'compass_conversations']]
  };

  if (e.hasSuperuserAuth && e.hasSuperuserAuth()) {
    return e.next();
  }
  const auth = e.auth;
  if (!auth) {
    // Oinloggade når aldrig hit (createRules kräver auth) — låt reglerna avgöra.
    return e.next();
  }
  const authTenant = String(auth.get('tenant') || '');
  const record = e.record;
  const name = record.collection().name;
  const parents = PARENTS[name] || [];

  for (let i = 0; i < parents.length; i++) {
    const field = parents[i][0];
    const parentCollection = parents[i][1];
    let ids = record.get(field);
    if (ids == null || ids === '') continue;
    if (!Array.isArray(ids)) ids = [ids];
    for (let j = 0; j < ids.length; j++) {
      const id = String(ids[j] || '');
      if (!id) continue;
      let parent = null;
      try {
        parent = $app.findRecordById(parentCollection, id);
      } catch (err) {
        parent = null;
      }
      if (!parent || !authTenant || String(parent.get('tenant') || '') !== authTenant) {
        throw new ForbiddenError('Posten hör inte till din organisation.');
      }
    }
  }
  return e.next();
}

onRecordCreateRequest(
  guardHandler,
  'activities',
  'notes',
  'milestones',
  'agreements',
  'startup_team_members',
  'partner_engagements',
  'startup_contacts',
  'compass_questions',
  'compass_messages',
  'compass_responses'
);

onRecordUpdateRequest(
  guardHandler,
  'activities',
  'notes',
  'milestones',
  'agreements',
  'startup_team_members',
  'partner_engagements',
  'startup_contacts',
  'compass_questions',
  'compass_messages',
  'compass_responses'
);
