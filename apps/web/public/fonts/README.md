# Fonts Directory

Self-hosted brand-typsnitt – inga CDN-anrop, EU-suveränt.

## Movexum brand-typsnitt (grafisk profil § 2.4)

Sora (rubriker) + Nunito Sans (brödtext) är de **enda** godkända typsnitten.
Inga andra familjer (JetBrains Mono/Inter/Fraunces/Helvetica/Arial/system-ui
som primär) får förekomma någonstans i plattformen – varken i UI, genererade
dokument, PDF:er, diagram eller mejl. `font-mono`/`--mx-mono` är ommappade till
Nunito Sans (tabular-nums via `.mx-tnum` där siffror behöver linjera).

### Webb (variable WOFF2, laddas via `apps/web/src/app/fonts.css`)

| Fil | Familj | Roll |
| --- | --- | --- |
| `sora-variable.woff2` | Sora Variable | Rubriker (100–800) |
| `nunito-sans-variable.woff2` | Nunito Sans Variable | Brödtext upright (200–1000) |
| `nunito-sans-italic-variable.woff2` | Nunito Sans Variable | Brödtext italic (200–1000) |

### PDF-inbäddning (statiska TTF, `apps/web/src/lib/documents/assets.ts`)

`@pdf-lib/fontkit` kan **inte** läsa WOFF2 (saknar brotli), så genererade
PDF:er bäddar in dessa statiska TTF i stället. Saknas de faller PDF:en tillbaka
på Helvetica – därför ligger de nu incheckade här så brand-typsnittet alltid
används.

| Fil | Typsnitt | Roll i PDF |
| --- | --- | --- |
| `Sora-SemiBold.ttf` | Sora SemiBold (600) | Rubriker |
| `NunitoSans-Regular.ttf` | Nunito Sans Regular (400) | Brödtext |
| `NunitoSans-Bold.ttf` | Nunito Sans Bold (700) | Fetstil i brödtext |

> PPTX/DOCX/XLSX refererar Sora/Nunito **vid namn** (OOXML bäddar inte in
> typsnitt via pptxgenjs/docx/exceljs) – de renderas korrekt så länge den som
> öppnar dokumentet har typsnitten. Bara PDF kräver de inbäddade TTF:erna ovan.

## Licenser (SIL Open Font License 1.1)

- `Sora-OFL.txt` – Sora
- `NunitoSans-OFL.txt` – Nunito Sans

OFL kräver att licensen distribueras med typsnitten; behåll dessa filer.

## Regenerera filerna

Variable-källorna (Google Fonts) instansieras med `fonttools`:

- WOFF2 (webb): pinna `wdth=100, opsz=12, YTLC=500`, behåll `wght`-axeln.
- Statiska TTF (PDF): pinna även `wght` (400 / 700 för Nunito, 600 för Sora).

## Varför self-hosted?

- EU-suveränitet (inga externa CDN-anrop)
- Bättre prestanda (samma origin)
- Integritet (ingen Google-tracking)
