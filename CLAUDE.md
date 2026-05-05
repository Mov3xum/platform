# CLAUDE.md — Movexum Inkubatorplattform

> **Detta dokument är obligatorisk kontext för all utveckling i detta repo.**
> Movexums grafiska profil ska följas slaviskt. Avvik aldrig från färger,
> typsnitt eller logotyp utan att uppdatera detta dokument samt
> `packages/shared/src/design/tokens.css` i samma PR.

---

## 1. Repo-översikt

Modulär inkubatorplattform för Movexum/Moveum. Monorepo (yarn workspaces).

```
apps/web/              # Next.js 15 (App Router, RSC first)
  src/app/             # Routes
  src/components/      # UI-komponenter
  src/lib/             # Auth, RBAC, PocketBase-klient
  public/brand/        # Logotyper
  public/fonts/        # Self-hosted variable fonts (WOFF2)

packages/shared/       # Delade paket (design-tokens + typer)
  src/design/tokens.css   # KÄLLA AV SANNING för färger
  src/design/tokens.ts    # TS-mirror för icke-CSS-bruk

backend/               # PocketBase migrations & hooks
infra/                 # Coolify / deploy
```

**Stack:** Next.js 15, React 19, Tailwind v4, PocketBase, TypeScript, Coolify
på UpCloud. **Ingen Vercel, inga externa CDN-anrop, EU-suveränitet.**

**Kommandon:**
```bash
yarn dev         # starta Next.js dev-server
yarn build       # produktionsbygge
yarn typecheck   # tsc --noEmit
yarn lint        # next lint
```

---

## 2. Movexums grafiska profil — bindande

### 2.1 Logotyp

Wordmark `movexum` (versaler/gemener följer originalet — alltid gemener).

| Mode  | Fil                                          | Färg                |
| ----- | -------------------------------------------- | ------------------- |
| Light | `apps/web/public/brand/movexum-wordmark-light.svg` | Svart `#121212` |
| Dark  | `apps/web/public/brand/movexum-wordmark-dark.svg`  | Vit `#f2f2f2`   |
| Flex  | `apps/web/public/brand/movexum-wordmark.svg`       | `currentColor`  |

Använd alltid komponenten `<Logo />` (i `apps/web/src/components/Logo.tsx`)
för att garantera korrekt logotyp per mode. Skala aldrig under 96 px bredd
i UI och bevara minst 16 px luft runtomkring.

### 2.2 Färgpalett (BINDANDE — exakt enligt grafisk profil)

#### Mörka toner

| Namn          | Hex       | CMYK              | RGB           |
| ------------- | --------- | ----------------- | ------------- |
| Mörkblå       | `#002c40` | 100, 74, 48, 53   | 0, 44, 64     |
| Mörklila      | `#452e75` | 90, 95, 16, 5     | 69, 46, 117   |
| Mörkgrön      | `#1d3a1f` | 84, 50, 90, 62    | 29, 58, 31    |
| Mörkorange    | `#4b2718` | 43, 75, 79, 68    | 75, 39, 24    |
| Mörkgul       | `#ca9323` | 19, 41, 94, 7     | 202, 147, 35  |

#### Djup-/Movexum-toner (de primära brand-färgerna)

| Namn           | Hex       | CMYK             | RGB           |
| -------------- | --------- | ---------------- | ------------- |
| Djupblå        | `#005470` | 93, 55, 36, 24   | 0, 84, 112    |
| Movexum blå    | `#00a8de` | 74, 13, 2, 0     | 0, 168, 222   |
| Movexum lila   | `#6138b5` | 80, 82, 0, 0     | 97, 56, 181   |
| Movexum grön   | `#4a7d4a` | 74, 30, 81, 15   | 29, 58, 31    |
| Movexum orange | `#d67e47` | 13, 57, 76, 3    | 214, 126, 71  |
| Movexum gul    | `#f0d22e` | 9, 13, 87, 0     | 240, 210, 46  |

#### Ljusa toner

| Namn      | Hex       | CMYK         | RGB           |
| --------- | --------- | ------------ | ------------- |
| Ljuslila  | `#8e6fd6` | 59, 61, 0, 0 | 142, 111, 214 |
| Ljusgrön  | `#88b48b` | 53, 13, 54, 1| 136, 180, 139 |

#### Pasteller

| Namn            | Hex       | CMYK       | RGB           |
| --------------- | --------- | ---------- | ------------- |
| Pastell blå     | `#ebfafc` | 9, 0, 3, 0 | 235, 250, 252 |
| Pastell lila    | `#e4dbfe` | 12, 16, 0, 0 | 228, 219, 254 |
| Pastell grön    | `#d9eddd` | 19, 0, 18, 0 | 217, 237, 221 |
| Pastell orange  | `#f1e5df` | 6, 11, 12, 0 | 241, 229, 223 |
| Pastell gul     | `#f8f1da` | 4, 4, 18, 0  | 248, 241, 218 |

#### Neutraler

| Namn  | Hex       | CMYK            | RGB           |
| ----- | --------- | --------------- | ------------- |
| Svart | `#121212` | 79, 70, 61, 88  | 18, 18, 18    |
| Vit   | `#f2f2f2` | 6, 4, 5, 0      | 242, 242, 242 |

### 2.3 Roller per färg

- **Movexum lila (`#6138b5`)** är primär brand. Används för CTA, fokus
  och accenter i light mode.
- **Ljuslila (`#8e6fd6`)** är primär i dark mode (bättre kontrast på svart).
- **Movexum blå (`#00a8de`)** används för länkar / informationsaccent.
- **Djupblå (`#005470`)** används för länkar i light mode.
- **Movexum grön / Pastell grön** = positiv status (active, achieved).
- **Movexum gul / Mörkgul** = varning / paused.
- **Movexum orange / Mörkorange** = error / rejected (vi använder INTE
  vanlig "röd" — Movexums profil saknar röd helt).
- **Pasteller** används som lugn yta i light mode (bg-canvas-subtle, bg-tags m.m.).
- **Mörka tonerna** används som accenter i dark mode.

### 2.4 Typografi (BINDANDE)

| Användning  | Typsnitt       | Vikter (rekommenderade)         |
| ----------- | -------------- | ------------------------------- |
| Rubriker    | **Sora**       | Regular 400, Semi Bold 600, Bold 700 |
| Brödtext    | **Nunito Sans**| Regular 400, Medium 500, Semi Bold 600, Bold 700 |
| Kod / data  | JetBrains Mono | Regular 400                     |

Filer (variable WOFF2) ligger i `apps/web/public/fonts/` och laddas via
`apps/web/src/app/fonts.css`. CSS-variabler:

```css
--font-heading: "Sora Variable", system-ui, sans-serif;
--font-body:    "Nunito Sans Variable", system-ui, sans-serif;
--font-mono:    "JetBrains Mono Variable", monospace;
```

Använd `font-heading` / `font-body` Tailwind-utility:erna eller låt
`<h1>`–`<h6>` ärva (sker automatiskt via `globals.css`).
**Använd ALDRIG Inter, Fraunces eller andra typsnitt** — de fanns i
ett tidigare utkast och har avvecklats.

---

## 3. Dark / light mode

### 3.1 Implementation

- Klassbaserat: `<html class="dark">` aktiverar dark mode.
- `ThemeScript` (i `apps/web/src/components/ThemeProvider.tsx`) injiceras
  i `<head>` och sätter klassen FÖRE hydration → ingen färgblink.
- `ThemeToggle`-komponenten finns i Navbar och växlar light/dark.
- Preferens lagras i `localStorage` under nyckeln `movexum-theme`.
  Om nyckeln saknas faller vi tillbaka på `prefers-color-scheme`.
- Tailwind v4 dark variant definieras med `@custom-variant dark (&:is(.dark *));`.

### 3.2 Token-mapping

`packages/shared/src/design/tokens.css` är källan av sanning. Den
exponerar två sorters tokens:

1. **`--movexum-*`** — råa hex-värden från grafiska profilen.
   Påverkas **aldrig** av dark mode. Använd när färgen ska vara fast
   (logotyp, accentdetaljer i diagram, brand-illustrationer).
2. **Semantiska tokens** (`canvas`, `surface`, `foreground`, `brand`,
   `link`, m.fl.) — mappas om i `.dark`-blocket.
   Använd dessa för all UI-yta.

| Semantisk token         | Light mode                     | Dark mode                      |
| ----------------------- | ------------------------------ | ------------------------------ |
| `--color-canvas`        | Vit `#f2f2f2`                  | Svart `#121212`                |
| `--color-canvas-subtle` | Pastell blå `#ebfafc`          | `#1c1c1c`                      |
| `--color-canvas-muted`  | Pastell lila `#e4dbfe`         | `#2a2a2a`                      |
| `--color-surface`       | Vit `#ffffff`                  | `#1c1c1c`                      |
| `--color-foreground`    | Svart `#121212`                | Vit `#f2f2f2`                  |
| `--color-foreground-muted` | `#404040`                   | `#cccccc`                      |
| `--color-brand`         | Movexum lila `#6138b5`         | Ljuslila `#8e6fd6`             |
| `--color-brand-foreground` | Vit `#f2f2f2`               | Svart `#121212`                |
| `--color-link`          | Djupblå `#005470`              | Movexum blå `#00a8de`          |

### 3.3 Tailwind utility-klasser

Tokens exponeras som Tailwind v4-utilities via `@theme` i
`apps/web/src/app/globals.css`:

**Brand (oförändrad i dark mode):**
```
bg-movexum-lila        text-movexum-lila        border-movexum-lila
bg-movexum-bla         text-movexum-bla         ...
bg-movexum-pastell-bla bg-movexum-pastell-lila  bg-movexum-pastell-gron
bg-movexum-svart       bg-movexum-vit
```

**Semantiska (mappas om automatiskt i dark mode):**
```
bg-canvas         bg-canvas-subtle      bg-canvas-muted
bg-surface        bg-surface-elevated
text-foreground   text-foreground-muted text-foreground-subtle
text-foreground-inverse
border-default    border-strong
bg-brand          text-brand            text-brand-foreground   hover:bg-brand-hover
text-link
ring-ring
```

**Skalor (1–9 för respektive färg):**
```
bg-primary-{50..900}    bg-accent-{50..900}    bg-success-{50,500,700}
bg-warning-{50,500,700} bg-error-{50,500,700}  bg-neutral-{50..900}
```

### 3.4 Regler för komponenter

- **Använd alltid semantiska tokens som default** (`bg-canvas`,
  `text-foreground`, `border-default`). Då fungerar dark mode utan att
  lägga till `dark:`-varianter överallt.
- **`dark:` används bara för undantag** — t.ex. när en specifik
  brand-färg ska bytas mot en mörkare/ljusare variant beroende på mode
  (se `Badges.tsx` för exempel).
- **Fokus-ringar** ska använda `ring-movexum-pastell-lila` i light mode
  och `dark:ring-movexum-morklila` i dark mode.
- **Skuggor** använder `shadow-movexum-svart/5` (eller `/10`, `/20`)
  istället för `shadow-slate-900/5`.
- **Status-/varningsfärger** använder Movexum-paletten (grön/gul/orange),
  ALDRIG Tailwinds default röd/emerald/amber.

---

## 4. Komponentstil — definition of done

Innan en PR mergas:

1. ✅ Inga referenser till `slate-*`, `cyan-*`, `red-*`, `emerald-*`,
   `amber-*`, `bg-white`, `text-white` (utom som `text-brand-foreground`).
   Sök med `grep -rn "slate-\|cyan-\|emerald-\|amber-" apps/web/src`.
2. ✅ Komponenten ser bra ut i både light och dark mode (testa via
   `ThemeToggle` i Navbar eller manuell `document.documentElement.classList.toggle('dark')`).
3. ✅ Rubriker använder Sora (ärvs automatiskt från `<h1>`–`<h6>`).
4. ✅ Brödtext ärver Nunito Sans från `<body>`.
5. ✅ Logotyp använder `<Logo />`-komponenten — ALDRIG inline emoji eller
   "M"-cirklar.
6. ✅ Inga inline `style={{ color: '#...' }}`-värden för brand-färger.
   Använd CSS-variabler eller Tailwind-utilities.
7. ✅ `yarn typecheck` och `yarn build` är gröna.

---

## 5. När du ska lägga till en ny färg

**STOPP.** Movexums grafiska profil definierar paletten. Du ska inte
lägga till ad-hoc-färger.

Om du ändå behöver en variant (t.ex. en hover-state):

1. Härled den från en befintlig brand-färg (justerad luminans/alpha).
2. Lägg till den i `packages/shared/src/design/tokens.css` med ett
   semantiskt namn.
3. Mappa om i `.dark`-blocket.
4. Exponera via `@theme` i `apps/web/src/app/globals.css` om den ska
   bli en Tailwind-utility.
5. Dokumentera den i avsnitt 3.2 ovan.

---

## 6. Roller, RBAC och moduler

(Oförändrat från README — se `apps/web/src/lib/rbac.ts` och
`packages/shared` för rollkonstanter.) 5 roller: `admin`,
`incubator_lead`, `coach`/`mentor`, `startup_member`, `observer`.

Moduler registreras via extension-points (`coreModules` i `@platform/shared`)
och har `requiredRoles`. Routing-shims i `apps/web/src/app/` importerar
från modulpaketen.

---

## 7. Övriga tekniska beslut

| Aspekt          | Val                                                     |
| --------------- | ------------------------------------------------------- |
| Routing         | Tunna shims i `app/` importerar från `modules/`         |
| Styling         | Tailwind v4 + CSS custom properties (hex)               |
| Fonter          | Self-hosted WOFF2 i `/public/fonts`                     |
| Dark mode       | Klassbaserat (`.dark` på `<html>`) + `ThemeScript`      |
| Auth            | httpOnly-cookie via middleware                          |
| Realtime        | PocketBase-prenumeration                                |
| Hosting         | Coolify containers på UpCloud                           |
| i18n            | `LocalizedText { sv, en }`                              |

---

## 8. Snabbreferens — vanliga klassmappningar

| Förr (slate/cyan)                    | Nu (Movexum)                                    |
| ------------------------------------ | ------------------------------------------------ |
| `bg-slate-50` / `bg-slate-100`       | `bg-canvas-subtle`                               |
| `bg-slate-950` (CTA)                 | `bg-brand` + `text-brand-foreground`             |
| `hover:bg-slate-800`                 | `hover:bg-brand-hover`                           |
| `text-slate-950` / `text-slate-900`  | `text-foreground`                                |
| `text-slate-700` / `text-slate-600`  | `text-foreground-muted`                          |
| `text-slate-500`                     | `text-foreground-subtle`                         |
| `border-slate-200` / `border-slate-100` | `border-default`                              |
| `border-slate-300`                   | `border-strong`                                  |
| `text-cyan-700`                      | `text-link`                                      |
| `bg-cyan-600`                        | `bg-movexum-bla` (eller `bg-brand`)              |
| `bg-emerald-50 text-emerald-700`     | `bg-movexum-pastell-gron text-movexum-morkgron` |
| `bg-amber-50 text-amber-700`         | `bg-movexum-pastell-gul text-movexum-morkgul`   |
| `bg-red-50 text-red-700`             | `bg-movexum-pastell-orange text-movexum-morkorange` (Movexum saknar röd) |
| `focus:ring-cyan-100`                | `focus:ring-movexum-pastell-lila` + `dark:focus:ring-movexum-morklila` |

---

**Maintainers:** Hampusgranstrom (admin: hampus@boxmeal)
**Repo:** `mov3xum/platform`
