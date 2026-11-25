/// <reference path="../pb_data/types.d.ts" />
// CLAUDE.md § 21.8 — auth-gate för användarinloggning direkt mot PocketBase.
//
// PocketBase har en egen publik adress. Webbappens inloggningsgränser (per IP,
// per e-post) gäller bara Next-routen, så användarlösenord kunde prövas
// obegränsat direkt mot `/api/collections/users/auth-with-password`, och
// återställningsmejl kunde skickas i mängd. PB:s egen rate-limit per IP går
// inte att använda för `users`: alla legitima inloggningar kommer från
// web-containerns IP (§ 23.2).
//
// När PB-resursen har env `MOVEXUM_PB_AUTH_GATE_SECRET` kräver vakten att
// requesten bär headern `X-Movexum-Auth-Gate` med samma värde — vilket bara
// webbappen (och CI:s verify-baseline) har. Vakten körs FÖRE lösenords-
// kontrollen, så en direkt gissning får 403 utan att lösenordet prövas.
// Utan env är vakten vilande (inget ändras). verify-baseline.mjs varnar då.
//
// Utrullning: sätt värdet på web-appen FÖRST, deploya, sätt det sedan på
// PB-resursen och som GitHub-secret (MOVEXUM_PB_AUTH_GATE_SECRET_<MILJÖ>).
// Superuser-requests (t.ex. "skicka återställning" i PB-dashboarden) släpps
// igenom.
//
// OBS: PB:s JSVM kör varje hanterare i en isolerad kontext — allt måste
// deklareras INNE i hanteraren.

function authGateHandler(e) {
  if (e.hasSuperuserAuth && e.hasSuperuserAuth()) return e.next();
  const secret = String($os.getenv('MOVEXUM_PB_AUTH_GATE_SECRET') || '').trim();
  if (!secret) return e.next();
  const provided = String(e.requestInfo().headers['x_movexum_auth_gate'] || '');
  if (!provided || !$security.equal(provided, secret)) {
    throw new ForbiddenError('Logga in via Movexums webbapp.');
  }
  return e.next();
}

onRecordAuthWithPasswordRequest(authGateHandler, 'users');
onRecordAuthWithOTPRequest(authGateHandler, 'users');
onRecordRequestOTPRequest(authGateHandler, 'users');
onRecordRequestPasswordResetRequest(authGateHandler, 'users');
onRecordRequestVerificationRequest(authGateHandler, 'users');
onRecordRequestEmailChangeRequest(authGateHandler, 'users');
