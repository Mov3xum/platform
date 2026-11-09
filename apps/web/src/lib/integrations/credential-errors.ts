// Varför integrationsnycklar inte kunde sparas eller läsas (CLAUDE.md § 11.5).
//
// Ren modul (ingen IO) så att meddelandena kan enhetstestas och delas av
// connect-actionen, synken och förhandsgranskningen. Tidigare svarade alla
// fyra felvägarna samma sak ("kontrollera MOVEXUM_INTEGRATION_KEY" /
// "saknas eller kunde inte dekrypteras") och inget loggades — en saknad
// superuser, en felaktig nyckel och en koppling som aldrig fått nycklar
// sparade gick inte att skilja åt (incident 2026-10).

export type CredentialFailureReason =
  | 'superuser_missing'
  | 'superuser_auth'
  | 'key_missing'
  | 'key_invalid'
  | 'not_saved'
  | 'decrypt_failed'
  | 'read_failed'
  | 'write_failed';

export type CredentialResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: CredentialFailureReason };

const MESSAGES: Record<CredentialFailureReason, string> = {
  superuser_missing:
    'POCKETBASE_SUPERUSER_EMAIL/POCKETBASE_SUPERUSER_PASSWORD saknas på web-appen i Coolify.',
  superuser_auth:
    'Superuser-inloggningen mot PocketBase misslyckades. Kontrollera POCKETBASE_SUPERUSER_PASSWORD på web-appen (loggraden "[superuser] auth failed" visar status).',
  key_missing: 'MOVEXUM_INTEGRATION_KEY saknas på web-appen i Coolify. Lägg till den och redeploya.',
  key_invalid:
    'MOVEXUM_INTEGRATION_KEY är inte 32 bytes base64 (44 tecken som slutar med =). Generera en ny med "openssl rand -base64 32".',
  not_saved:
    'Inga inloggningsuppgifter är sparade för kopplingen. Klicka "Koppla bort" och anslut igen med nycklarna.',
  decrypt_failed:
    'De sparade inloggningsuppgifterna kunde inte dekrypteras. MOVEXUM_INTEGRATION_KEY har ändrats sedan de sparades. Klicka "Koppla bort" och anslut igen.',
  read_failed: 'Kunde inte läsa kopplingen från PocketBase. Försök igen om en stund.',
  write_failed: 'Kunde inte spara de krypterade uppgifterna i PocketBase. Försök igen om en stund.'
};

export function describeCredentialFailure(reason: CredentialFailureReason): string {
  return MESSAGES[reason];
}
