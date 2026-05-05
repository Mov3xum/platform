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
