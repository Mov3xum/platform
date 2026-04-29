# Moveum Inkubatorplattform

Det här repot innehåller en grundstruktur för en modulär inkubatorplattform med startup-fokus.
Plattformen är tänkt att drivas med:

- Frontend: Next.js (Vercel)
- Backend/data: PocketBase på UpCloud med SQLite-lagring
- Deployment-hantering: Coolify
- Gemensamt integrationsbibliotek för RBAC och startup-moduler

## Arkitektur

- `apps/web`: frontend-portal för inkubatorn
- `packages/shared`: gemensamt integrationsbibliotek med roller, typer och PocketBase-klient
- `backend/pocketbase-schema`: beskriver PocketBase-samlingar och schema
- `infra/coolify.yml`: startpunkt för Coolify-konfiguration

## Roller

Systemet stöder upp till fem roller enligt RBAC:

1. `admin`
2. `incubator_lead`
3. `mentor`
4. `startup`
5. `observer`

## Moduler

Plattformen är designad för att samla data i den gemensamma startup-modulen:

- startup-översikt
- IRL-faser
- aktiviteter & nästa steg
- dokumentation från möten
- personer i bolaget
- signerade avtal (NDA etc.)
- onboarding och avtalshantering

## Kom igång

1. `npm install`
2. `npm run dev`

## Nästa steg

- implementera PocketBase-samlingarna i `backend/pocketbase-schema`
- koppla frontend till PocketBase via `packages/shared`
- skapa Coolify-pipeline i `infra/coolify.yml`
- konfigurera SQLite-lagring för PocketBase på UpCloud
- bygga in startupkompassen, utbildningsmoduler och digital onboarding
