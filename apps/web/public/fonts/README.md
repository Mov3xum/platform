# Fonts Directory

Self-hosted variable fonts (WOFF2) – inga CDN-anrop.

## Movexum brand-typsnitt (grafisk profil)

1. **Sora Variable** → `sora-variable.woff2` (rubriker, alla weights 100–800)
   - Source: https://fonts.google.com/specimen/Sora
2. **Nunito Sans Variable** → `nunito-sans-variable.woff2` (brödtext, 200–900)
   - Source: https://fonts.google.com/specimen/Nunito+Sans
3. **JetBrains Mono Variable** → `jetbrains-mono-variable.woff2` (kod/teknik)
   - Source: https://www.jetbrains.com/lp/mono/

## Instruktioner

1. Ladda ner variable WOFF2 för respektive typsnitt
2. Döp om enligt namnen ovan och placera i denna mapp
3. Inga ytterligare steg – fonterna laddas via `apps/web/src/app/fonts.css`

## Varför self-hosted?

- EU-suveränitet (inga externa CDN-anrop)
- Bättre prestanda (samma origin)
- Integritet (ingen Google-tracking)

## TTF/OTF för PDF-inbäddning (genererade dokument) — **valfritt men rekommenderat**

WOFF2-filerna ovan används av webben. PDF-renderaren
(`apps/web/src/lib/documents/render-pdf.ts`, `@react-pdf/renderer`) bäddar in
brand-typsnitt via `Font.register`, men dess fontkit **kan inte läsa WOFF2**
(saknar brotli). Lägg därför till statiska TTF/OTF-varianter här för att få
Sora/Nunito (och korrekta svenska tecken) i genererade PDF:er:

| Fil | Typsnitt | Roll i PDF |
| --- | --- | --- |
| `Sora-SemiBold.ttf` | Sora SemiBold (600) | Rubriker |
| `NunitoSans-Regular.ttf` | Nunito Sans Regular (400) | Brödtext |
| `NunitoSans-Bold.ttf` | Nunito Sans Bold (700) | Fetstil i brödtext |

Ladda ner statiska TTF från Google Fonts (samma familjer som ovan) och döp dem
exakt enligt tabellen. Saknas de faller PDF:en tillbaka på Helvetica (fortsatt
snygg layout, men inte brand-typsnittet) — se `assets.ts`.

> **OBS:** PPTX/DOCX/XLSX refererar Sora/Nunito **vid namn** och behöver inga
> filer här — de renderas korrekt så länge den som öppnar dokumentet har
> typsnitten installerade. Bara PDF kräver inbäddning.
