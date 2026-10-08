// Gränser för "Mitt konto" som delas av klientformuläret och server-actionen.
// Ligger UTANFÖR `lib/actions/account.ts`: en 'use server'-fil får bara
// exportera async-funktioner — en exporterad konstant där fick VARJE
// server action på /konto (profil, lösenord, kompetensprofil) att svara 500
// ("A 'use server' file can only export async functions, found number").
// Låst av `yarn check:use-server` (CLAUDE.md § 29.7).

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
