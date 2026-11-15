/// <reference path="../pb_data/types.d.ts" />
// CLAUDE.md § 21.8 — tenant- och bolagsvakt för ALLA användarskrivningar.
//
// Andra lagret bakom API-reglerna (scripts/security-rules.mjs). Vakten körs på
// create- OCH update-requests från API:t (inte på interna $app-skrivningar) för
// alla bas-kollektioner och nekar (403) när en inloggad användare med sin egen
// token försöker:
//
//  1. flytta en post till en annan tenant (ändra `tenant` vid update);
//  2. peka en relation på en post i en ANNAN tenant — förälderns tenant tas ur
//     dess `tenant`-fält, annars ur dess bolag (`startup.tenant`). Täcker även
//     kollektioner utan eget `tenant`-fält (aktiviteter, anteckningar,
//     teammedlemmar, kompassfrågor …) som tidigare låg i en hårdkodad lista;
//  3. (ren bolagsmedlem) peka en relation på ett ANNAT bolag än sina egna —
//     direkt (`startup`) eller via en förälder som tillhör ett bolag
//     (t.ex. en analys, `assessment.startup`). Stänger också den kända
//     luckan att en medlem kunde skapa poster för ett annat bolag i samma
//     tenant (createRules kan inte joina, § 21.3).
//
// Bakgrund (säkerhetsgranskning 2026-11-15): verifierat mot PB 0.23.4 lokalt
// kunde en coach flytta ett bolag till en annan tenant och en bolagsmedlem
// flytta sin KPI-rad till ett annat bolag och en annan tenant.
//
// Bara relationer som ÄNDRAS prövas (vid update: id:n som inte fanns förut),
// så äldre data blockerar aldrig en orelaterad ändring. Saknad förälder lämnas
// till PB:s egen relationsvalidering. Superuser-requests (server-actionernas
// verifierade fallback, § 21.3) släpps igenom, liksom auth-kollektioner
// (`users` har egna fältlås) och systemkollektioner.
//
// OBS: PB:s JSVM kör varje hanterare i en isolerad kontext — allt som
// hanteraren behöver måste deklareras INNE i den. Inga toppnivå-konstanter
// (alla hook-filer delar scope, § 55.8).

function tenantGuardHandler(e) {
  const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

  if (e.hasSuperuserAuth && e.hasSuperuserAuth()) return e.next();
  const auth = e.auth;
  if (!auth) return e.next(); // gäster: kollektionens regler avgör

  const record = e.record;
  const collection = record.collection();
  if (collection.system || String(collection.type) !== 'base') return e.next();

  const authTenant = String(auth.get('tenant') || '');
  const roles = auth.getStringSlice('roles');
  let isStaff = false;
  let isMember = false;
  for (let i = 0; i < roles.length; i++) {
    const role = String(roles[i]);
    if (STAFF_ROLES.indexOf(role) >= 0) isStaff = true;
    if (role === 'startup_member') isMember = true;
  }
  const pureMember = isMember && !isStaff;
  const linked = [];
  if (pureMember) {
    const ls = auth.getStringSlice('linked_startups');
    for (let i = 0; i < ls.length; i++) linked.push(String(ls[i]));
  }

  const isNew = record.isNew();
  const original = isNew ? null : record.original();

  function deny(message) {
    throw new ForbiddenError(message);
  }

  // 1. Ingen flytt mellan tenants.
  if (collection.fields.getByName('tenant')) {
    const next = String(record.get('tenant') || '');
    if (!isNew && next !== String(original.get('tenant') || '')) {
      deny('Posten kan inte flyttas till en annan organisation.');
    }
    if (isNew && next && next !== authTenant) {
      deny('Posten hör inte till din organisation.');
    }
  }

  const metaCache = {};
  function targetMeta(collectionId) {
    if (metaCache[collectionId]) return metaCache[collectionId];
    let meta = { name: '', hasTenant: false, hasStartup: false, ok: false };
    try {
      const target = $app.findCollectionByNameOrId(collectionId);
      meta = {
        name: String(target.name),
        hasTenant: !!target.fields.getByName('tenant'),
        hasStartup: !!target.fields.getByName('startup'),
        ok: true
      };
    } catch (_err) {
      /* okänd kollektion — lämnas till PB:s validering */
    }
    metaCache[collectionId] = meta;
    return meta;
  }

  function findRecord(collectionNameOrId, id) {
    try {
      return $app.findRecordById(collectionNameOrId, id);
    } catch (_err) {
      return null;
    }
  }

  const fields = collection.fields;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (String(field.type()) !== 'relation') continue;
    const name = String(field.name);
    if (name === 'tenant') continue; // prövat ovan

    const before = {};
    if (original) {
      const old = original.getStringSlice(name);
      for (let j = 0; j < old.length; j++) before[String(old[j])] = true;
    }
    const ids = record.getStringSlice(name);
    for (let j = 0; j < ids.length; j++) {
      const id = String(ids[j] || '');
      if (!id || before[id]) continue;

      const meta = targetMeta(String(field.collectionId));
      if (!meta.ok) continue;

      if (meta.name === 'tenants') {
        if (id !== authTenant) deny('Posten hör inte till din organisation.');
        continue;
      }
      if (!meta.hasTenant && !meta.hasStartup && meta.name !== 'startups') continue;

      const target = findRecord(String(field.collectionId), id);
      if (!target) continue;

      // 2. Förälderns tenant måste vara den inloggades.
      let targetTenant = '';
      let targetStartup = '';
      if (meta.name === 'startups') targetStartup = id;
      else if (meta.hasStartup) targetStartup = String(target.get('startup') || '');
      if (meta.hasTenant) {
        targetTenant = String(target.get('tenant') || '');
      } else if (targetStartup) {
        const startup = findRecord('startups', targetStartup);
        targetTenant = startup ? String(startup.get('tenant') || '') : '';
      } else {
        continue; // föräldern bär ingen tenant (t.ex. global katalog)
      }
      if (!authTenant || targetTenant !== authTenant) {
        deny('Posten hör inte till din organisation.');
      }

      // 3. En ren bolagsmedlem får bara peka på sina egna bolag.
      if (pureMember && targetStartup && linked.indexOf(targetStartup) < 0) {
        deny('Posten hör inte till ditt bolag.');
      }
    }
  }

  return e.next();
}

onRecordCreateRequest(tenantGuardHandler);
onRecordUpdateRequest(tenantGuardHandler);
