# PocketBase-schema för Moveum Inkubatorplattform

Det här katalogen innehåller startpunkter för PocketBase-schemats samlingar.
Det är inte en separat applikation som deployas. Den här mappen används för PocketBase-schema och hook-konfigurationer som sedan synkas till din UpCloud-hostade PocketBase-instans.
PocketBase körs mot en SQLite-databas på UpCloud, där databasfilen kan ligga i `backend/pocketbase-data`.

## Rekommenderade samlingar

- `startups`
  - `name`
  - `description`
  - `innovationReadinessLevel`
  - `nextStep`
  - `teamMembers`
  - `documents`

- `users`
  - `name`
  - `email`
  - `role`
  - `tenant`
  - `startupId`

- `agreements`
  - `startupId`
  - `title`
  - `signedAt`
  - `fileUrl`

- `activities`
  - `startupId`
  - `type`
  - `status`
  - `dueDate`
  - `owner`

## Användning

1. Skapa samlingarna i PocketBase via admin-UI eller importera JSON.
2. Anslut frontend via `NEXT_PUBLIC_POCKETBASE_URL`.
3. Använd PocketBase + SQLite som backend på UpCloud.
4. Implementera RBAC baserat på `role` i `users`-samlingen.

## Notes

- Tanken är att startupmodulen är central och att alla moduler matar data till den.
- `packages/shared` innehåller typer och gemensamma definitions-objekt för roller.
