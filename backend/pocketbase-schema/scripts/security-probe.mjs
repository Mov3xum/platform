#!/usr/bin/env node
// CLAUDE.md § 21.8 — säkerhetsprov mot en LOKAL PocketBase (säkerhets-
// granskning 2026-11-15).
//
// Skapar två tenants, bolag och användare, kör attackerna från granskningen
// med användarnas egna tokens direkt mot PB-API:t och kontrollerar att de
// nekas — och att de legitima flödena fortfarande fungerar. Städar efter sig
// (tenant-raderingen kaskaderar).
//
// Kör bara mot localhost (skriptet skapar och raderar data). Förutsätter en PB
// som synkats med setup-via-api.mjs och startats med repots hooks och
// MOVEXUM_PB_AUTH_GATE_SECRET:
//
//   MOVEXUM_PB_AUTH_GATE_SECRET=x pocketbase serve --hooksDir=backend/pocketbase-schema/hooks
//   PB_URL=http://127.0.0.1:8090 PB_SU_EMAIL=… PB_SU_PASSWORD=… \
//     MOVEXUM_PB_AUTH_GATE_SECRET=x node backend/pocketbase-schema/scripts/security-probe.mjs
//
// Med --rate-limit provas även superuser-gränsen (låser superuser-inloggning
// från din IP i en minut).

const PB_URL = (process.env.PB_URL || '').replace(/\/$/, '');
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const GATE = (process.env.MOVEXUM_PB_AUTH_GATE_SECRET || '').trim();
const TEST_RATE_LIMIT = process.argv.includes('--rate-limit');

if (!PB_URL || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Saknar env: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD (och helst MOVEXUM_PB_AUTH_GATE_SECRET).');
  process.exit(2);
}
const host = new URL(PB_URL).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Vägrar köra mot ${host}: skriptet skapar och raderar data. Kör mot en lokal PB.`);
  process.exit(2);
}

const gateHeaders = GATE ? { 'X-Movexum-Auth-Gate': GATE } : {};

async function call(method, path, token, body, headers = {}) {
  const res = await fetch(PB_URL + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers, ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* tomt svar */
  }
  return { status: res.status, json };
}

const results = [];
function expect(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`);
}
const denied = (r) => r.status === 400 || r.status === 403 || r.status === 404;

const suAuth = await call('POST', '/api/collections/_superusers/auth-with-password', null, {
  identity: SU_EMAIL,
  password: SU_PASSWORD
});
if (suAuth.status !== 200) {
  console.error(`Superuser-inloggning misslyckades (HTTP ${suAuth.status}).`);
  process.exit(2);
}
const su = suAuth.json.token;

async function make(collection, data) {
  const r = await call('POST', `/api/collections/${collection}/records`, su, data);
  if (r.status >= 300) throw new Error(`${collection}: ${JSON.stringify(r.json)}`);
  return r.json;
}

const sfx = `${Date.now().toString(36)}`;
const tenants = [];
try {
  const tA = await make('tenants', { name: `Prov A ${sfx}`, slug: `prov-a-${sfx}`, type: 'incubator' });
  tenants.push(tA);
  const tB = await make('tenants', { name: `Prov B ${sfx}`, slug: `prov-b-${sfx}`, type: 'incubator' });
  tenants.push(tB);
  const startup = (tenant, name) => make('startups', { tenant: tenant.id, name, phase: 'inflode', status: 'active' });
  const s1 = await startup(tA, 'Eget bolag');
  const s2 = await startup(tA, 'Annat bolag');
  const sB = await startup(tB, 'Annan tenants bolag');

  const pw = `Prov-${sfx}-lösen!`;
  const user = (tenant, email, roles, linked = []) =>
    make('users', {
      email,
      password: pw,
      passwordConfirm: pw,
      tenant: tenant.id,
      roles,
      linked_startups: linked,
      verified: true
    });
  const member = await user(tA, `medlem-${sfx}@prov.invalid`, ['startup_member'], [s1.id]);
  const coach = await user(tA, `coach-${sfx}@prov.invalid`, ['coach']);

  // ── Auth-gaten ──
  const noGate = await call('POST', '/api/collections/users/auth-with-password', null, {
    identity: member.email,
    password: pw
  });
  if (GATE) {
    expect('inloggning direkt mot PB utan gate-header nekas', noGate.status === 403, `HTTP ${noGate.status}`);
    const reset = await call('POST', '/api/collections/users/request-password-reset', null, { email: member.email });
    expect('lösenordsåterställning direkt mot PB nekas', reset.status === 403, `HTTP ${reset.status}`);
  } else {
    console.log('⚠ MOVEXUM_PB_AUTH_GATE_SECRET saknas — gaten provas inte.');
  }
  const login = async (email) => {
    const r = await call('POST', '/api/collections/users/auth-with-password', null, { identity: email, password: pw }, gateHeaders);
    if (r.status !== 200) throw new Error(`inloggning ${email}: HTTP ${r.status}`);
    return r.json.token;
  };
  const mt = await login(member.email);
  const ct = await login(coach.email);
  expect('inloggning med gate-header fungerar', Boolean(mt && ct), 'ingen token');

  // ── Flytt av poster ──
  const kpi = await make('startup_kpis', {
    tenant: tA.id,
    startup: s1.id,
    kpi_name: 'Prov',
    value_text: '1',
    measured_at: '2026-01-01 00:00:00.000Z'
  });
  let r = await call('PATCH', `/api/collections/startups/records/${s2.id}`, ct, { tenant: tB.id });
  expect('coach kan inte flytta ett bolag till en annan tenant', denied(r), `HTTP ${r.status}`);
  r = await call('PATCH', `/api/collections/startup_kpis/records/${kpi.id}`, mt, { startup: s2.id });
  expect('medlem kan inte flytta sin KPI till ett annat bolag', denied(r), `HTTP ${r.status}`);
  r = await call('PATCH', `/api/collections/startup_kpis/records/${kpi.id}`, mt, { tenant: tB.id, startup: sB.id });
  expect('medlem kan inte flytta sin KPI till en annan tenant', denied(r), `HTTP ${r.status}`);

  // ── Relationer till andra bolag/tenants vid create ──
  r = await call('POST', '/api/collections/startup_kpis/records', mt, {
    tenant: tA.id,
    startup: s2.id,
    kpi_name: 'Falsk',
    value_text: '1',
    measured_at: '2026-01-01 00:00:00.000Z'
  });
  expect('medlem kan inte skapa en KPI åt ett annat bolag', denied(r), `HTTP ${r.status}`);
  r = await call('POST', '/api/collections/notes/records', mt, { startup: s2.id, author: member.id, body: 'x' });
  expect('medlem kan inte skriva en anteckning på ett annat bolag', denied(r), `HTTP ${r.status}`);
  r = await call('POST', '/api/collections/notes/records', ct, { startup: sB.id, author: coach.id, body: 'x' });
  expect('coach kan inte skriva en anteckning på en annan tenants bolag', denied(r), `HTTP ${r.status}`);
  r = await call('POST', '/api/collections/startup_kpis/records', ct, {
    tenant: tA.id,
    startup: sB.id,
    kpi_name: 'Falsk',
    value_text: '1',
    measured_at: '2026-01-01 00:00:00.000Z'
  });
  expect('coach kan inte koppla en post till en annan tenants bolag', denied(r), `HTTP ${r.status}`);

  // ── Rollhöjning ──
  r = await call('PATCH', `/api/collections/users/records/${member.id}`, mt, { roles: ['admin'] });
  expect('medlem kan inte ge sig själv admin-roll', denied(r), `HTTP ${r.status}`);
  r = await call('PATCH', `/api/collections/users/records/${member.id}`, mt, { linked_startups: [s2.id] });
  expect('medlem kan inte koppla sig till ett annat bolag', denied(r), `HTTP ${r.status}`);

  // ── Legitima flöden som måste fungera ──
  r = await call('PATCH', `/api/collections/startup_kpis/records/${kpi.id}`, mt, { value_text: '2' });
  expect('medlem kan uppdatera sin egen KPI', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  r = await call('PATCH', `/api/collections/startup_kpis/records/${kpi.id}`, mt, {
    value_text: '3',
    tenant: tA.id,
    startup: s1.id
  });
  expect('medlem kan skicka tillbaka samma tenant/bolag', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  r = await call('POST', '/api/collections/notes/records', mt, { startup: s1.id, author: member.id, body: 'egen' });
  expect('medlem kan skriva en anteckning på sitt bolag', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  r = await call('PATCH', `/api/collections/startup_kpis/records/${kpi.id}`, ct, { startup: s2.id });
  expect('coach kan koppla om en post till ett annat bolag i tenanten', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  r = await call('PATCH', `/api/collections/startups/records/${s1.id}`, ct, { next_step: 'Nästa steg' });
  expect('coach kan uppdatera ett bolagskort', r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.json)}`);

  // ── Superuser-gränsen (valfri — låser superuser från din IP i en minut) ──
  if (TEST_RATE_LIMIT) {
    let limited = false;
    for (let i = 0; i < 15 && !limited; i++) {
      const x = await call('POST', '/api/collections/_superusers/auth-with-password', null, {
        identity: SU_EMAIL,
        password: 'fel-lösenord'
      });
      limited = x.status === 429;
    }
    expect('superuser-inloggning stryps efter upprepade försök', limited, 'inget 429');
  }
} catch (err) {
  expect('provet kunde köras', false, err?.message || String(err));
} finally {
  for (const tenant of tenants.reverse()) {
    await call('DELETE', `/api/collections/tenants/records/${tenant.id}`, su).catch(() => {});
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} av ${results.length} kontroller godkända.`);
process.exit(failed.length ? 1 : 0);
