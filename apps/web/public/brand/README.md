# Brand-assets

Movexum-wordmark för UI **och** för genererade dokument (PPTX/XLSX/DOCX/PDF).

## SVG (UI)

`<Logo />`-komponenten i UI:t använder dessa (live-text, följer `currentColor`):

- `movexum-wordmark-light.svg` — svart wordmark (ljust läge)
- `movexum-wordmark-dark.svg` — vit wordmark (mörkt läge)
- `movexum-wordmark.svg` — flex (`currentColor`)

## PNG (genererade dokument) — **lägg till dessa**

Dokument-renderarna (`apps/web/src/lib/documents/`) kan **inte** bädda in SVG —
office-format och pdf-lib kräver raster. Lägg därför till PNG-versioner med
**transparent bakgrund** här:

| Fil | Innehåll | Används på |
| --- | --- | --- |
| `movexum-wordmark-light.png` | **Svart** wordmark | Vita/ljusa ytor (innehållssidor, sidhuvud, footer, Excel-data) |
| `movexum-wordmark-dark.png` | **Vit** wordmark | Mörka/brandfärgade ytor (omslag, Excel-banner) |

**Rekommendation:**

- Bredd/höjd-förhållande **~4.29 : 1** (som wordmark-SVG:ens viewBox 600×140).
  Renderaren skalar efter höjd och antar det förhållandet — kraftigt avvikande
  proportioner blir lätt distorderade.
- Höjd ≥ 280 px (t.ex. **1200×280**) för skarp utskrift.
- Transparent bakgrund (PNG-32).

Saknas PNG-filerna renderas dokumenten ändå — bara utan logga (fail-soft, se
`apps/web/src/lib/documents/assets.ts`).
