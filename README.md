# Moveum Inkubatorplattform

Modulär inkubatorplattform för Movexum/Moveum med extension-point-arkitektur och EU-suveränitet.

## Teknologi

- **Frontend**: Next.js 15 + React 19 (App Router, Server Components)
- **Styling**: Tailwind v4 med OKLCH-tokens, inga externe CDN-anrop
- **Komponenter**: shadcn/ui-forking, cmdk, sonner
- **Backend**: PocketBase 0.22+ (självhostad)
- **Deployment**: Coolify containers på UpCloud (ej Vercel)
- **Design-system**: OKLCH-tokens, selvhostade fonter (Inter, Fraunces, JetBrains Mono variable)

## Arkitektur

```
apps/web/              # Next.js-app (Server Components first)
  ├── src/
  │   ├── app/         # App Router (layout + routes)
  │   ├── components/  # UI-komponenter
  │   ├── lib/         # Auth, PB, registry, utilities
  │   └── modules/     # Moduler (startups, coaching, o.s.v.)
  └── public/fonts/    # Selvhostade fonter (WOFF2)

packages/shared/       # Gemensamt library
  ├── src/
  │   ├── design/      # Tokens (TS + CSS)
  │   └── types/       # Gemensamma typer
```

## Moduler

Plattformen använder extension-point-mönstret. Moduler registreras och kan bidra med:

- **Navigation items** (sidomeny)
- **Dashboard widgets**
- **Startup-flikar** (Overview, Team, Milestones, Notes)
- **Search providers** (command palette)
- **Global commands**

### Befintliga moduler

- `startups` — Bolagöversikt, fas-tidslinje, team, milstolpar, anteckningar
- `coaching` (coming_soon)
- `programs` (coming_soon)
- `funding` (coming_soon)
- ... 8 fler skisser

## Roller & Behörigheter

5 roller: `admin`, `incubator_lead`, `mentor`, `startup`, `observer`

Moduler definierar `requiredRoles` — användare måste ha minst en av rollerna.

## Kom igång

```bash
npm install
npm run dev
```

Öppna http://localhost:3000.

## Designbeslut

| Aspekt | Val |
|---|---|
| Routing | Tunna shims i `app/(app)/` importerar från `modules/` |
| Styling | Tailwind v4 + OKLCH CSS custom props |
| Fonter | Selvhostade WOFF2 (`/public/fonts`) |
| Dark mode | Klassbaserat (`.dark` på `<html>`) |
| Auth-token | httpOnly-cookie via middleware |
| Realtime | PocketBase-prenumeration (minimal v1) |
| Hosting | Coolify containers (no vendor lock-in) |
| i18n | Modul som andra moduler (`LocalizedText { sv, en }`) |

## PocketBase-schema

Migrations under `backend/pocketbase-schema/migrations/`:

- `users` — admin role + roles[] + linked_startup
- `startups` — fase, namn, beskrivning, coaches[]
- `startup_team_members` — relation
- `startup_milestones` — aktiviteter & måltal
- `startup_tags` — kategorisering

Starta local dev:
```bash
pocketbase serve --http=localhost:8080
```

## Nästa steg

1. Ladda ner och placera fonter i `apps/web/public/fonts/`
2. Implementera PocketBase-migrations
3. Starta `npm run dev` — Tailwind-tokens & layout bör renderas
4. Deploytesterna i Coolify när repot är ready

---

**Repo:** Moveum/platform  
**Maintainers:** Hampusgranstrom (with admin access via hampus@boxmeal)
- bygga in startupkompassen, utbildningsmoduler och digital onboarding
