#!/usr/bin/env node
/**
 * Filter-injection-vakt (CLAUDE.md § 10.3 A.8.9). Varje dynamiskt VÄRDE som
 * interpoleras in i en PocketBase-filtersträng inom dubbla/enkla citationstecken
 * MÅSTE gå genom `escFilter()` — annars kan otrusted indata bryta sig ur strängen
 * (motsvarande SQL-injection; PB:s `&&` binder hårdare än `||` → cross-tenant-
 * läsning). Det här svepet failar CI om ett `"${...}"` i en filtersträng inte är
 * escFilter-wrappat, så regressioner fångas INNAN de når staging/produktion.
 *
 * Alternativet är PocketBase-bunden syntax: `pb.filter('f = {:x}', { x })` —
 * den matchar inte `"${...}"` och passerar därför automatiskt (föredragen för
 * ny kod).
 *
 * Scope: bara template-literaler i ett filter-sammanhang (`filter:`,
 * `filter =`, `getFirstListItem(...)`) — så HTML-attribut (`href="${url}"`)
 * och JSON aldrig falsklarmar. Fragment-interpolation utan citationstecken
 * (`&& (${linkedFilter})`) räknas inte som värde och berörs inte (de byggs
 * redan säkert uppströms med escFilter, § 21.2).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../apps/web/src', import.meta.url));

// Filtersträngar fångas från dessa konstruktioner; gruppen är literalens kropp.
const FILTER_LITERAL_RE = /(?:filter\s*[:=]\s*|getFirstListItem(?:<[^>]*>)?\(\s*)`([^`]*)`/g;
// Ett interpolerat värde inom citationstecken i en filter: "${EXPR}" / '${EXPR}'.
const QUOTED_INTERP_RE = /["']\$\{([^}]*)\}["']/g;
// Tillåtet: värdet är escFilter(...)-wrappat (ev. med .trim() etc. inuti).
const SAFE_EXPR_RE = /^escFilter\s*\(/;

/** Rad-nummer för ett index i filinnehållet (1-baserat). */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
}

function main() {
  const files = [];
  walk(ROOT, files);
  const violations = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let m;
    FILTER_LITERAL_RE.lastIndex = 0;
    while ((m = FILTER_LITERAL_RE.exec(text)) !== null) {
      const body = m[1];
      const bodyStart = m.index + m[0].length - body.length - 1;
      let q;
      QUOTED_INTERP_RE.lastIndex = 0;
      while ((q = QUOTED_INTERP_RE.exec(body)) !== null) {
        const expr = q[1].trim();
        if (SAFE_EXPR_RE.test(expr)) continue;
        violations.push({
          file: relative(ROOT, file),
          line: lineOf(text, bodyStart + q.index),
          expr
        });
      }
    }
  }

  if (violations.length) {
    console.error('\n✗ Filter-injection-vakt: oescapade värden i PocketBase-filter\n');
    for (const v of violations) {
      console.error(`  apps/web/src/${v.file}:${v.line}  →  "\${${v.expr}}"`);
    }
    console.error(
      `\n${violations.length} oescapat värde(n). Wrappa varje interpolerat värde i ` +
        '`escFilter(...)` (import från @/lib/pb-filter), ELLER använd PB:s bundna ' +
        'syntax `pb.filter("f = {:x}", { x })`. Se CLAUDE.md § 10.3.\n'
    );
    process.exit(1);
  }
  console.log(`✓ Filter-injection-vakt: alla filter-värden escapas (${files.length} filer)`);
}

main();
