# Fonts Directory

This directory contains self-hosted font files in WOFF2 format. No Google Fonts CDN calls are made.

## Required Fonts

Download these variable fonts and place them in this directory:

1. **Inter Variable** → `inter-variable.woff2`
   - Source: https://github.com/rsms/inter/releases
   - Variable font (100-900 weights)

2. **Fraunces Variable** → `fraunces-variable.woff2`
   - Source: https://github.com/undercasetype/Fraunces/releases
   - Variable font (100-900 weights)

3. **JetBrains Mono Variable** → `jetbrains-mono-variable.woff2`
   - Source: https://www.jetbrains.com/lp/mono/
   - Variable font (100-800 weights)

## Instructions

1. Download each font's variable WOFF2 file
2. Rename to match the names above
3. Place in this directory
4. No additional configuration needed — fonts load via `/src/app/fonts.css`

## Why Self-Hosted?

- EU sovereignty (no external CDN calls)
- Better performance (fonts loaded from same origin)
- Privacy (no Google tracking)
