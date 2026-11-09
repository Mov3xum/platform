#!/usr/bin/env node
/**
 * 'use server'-vakt (CLAUDE.md § 29.7, incident 2026-10). En fil som börjar
 * med direktivet 'use server' får BARA exportera async-funktioner (plus
 * typer). Next validerar exporterna när en server action anropas — inte vid
 * bygget — och då för ALLA actions som sidan använder. En enda exporterad
 * konstant (`export const MAX_AVATAR_BYTES = …` i lib/actions/account.ts)
 * fick därför varje action på /konto att svara 500 ("A 'use server' file can
 * only export async functions, found number"), inklusive kompetensprofilen.
 * `yarn typecheck`/`yarn build` fångar det inte; det här svepet gör det.
 *
 * Tillåtet: `export async function`, `export default async function`,
 * `export const x = async (…) =>`/`async function`, `export type`,
 * `export interface`. Allt annat (konstanter, synkrona funktioner, klasser,
 * enums, `export { … }`-re-exporter av värden) failar. Lägg delade
 * konstanter/hjälpare i en vanlig modul i stället.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/web/src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** Direktivet räknas bara som första sats (kommentarer/tomrader får föregå). */
function isUseServerFile(src) {
  const body = src.replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*/, '').trimStart();
  return /^['"]use server['"]\s*;?/.test(body);
}

const ALLOWED = [
  /^export\s+async\s+function\b/,
  /^export\s+default\s+async\s+function\b/,
  /^export\s+(const|let)\s+\w+\s*(:[^=]+)?=\s*async\b/,
  /^export\s+type\b/,
  /^export\s+interface\b/,
  /^export\s+declare\s+type\b/
];

const problems = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8');
  if (!isUseServerFile(src)) continue;
  src.split('\n').forEach((line, i) => {
    const t = line.trimStart();
    if (!t.startsWith('export ')) return;
    if (/^export\s*\{[^}]*\}/.test(t) && /^export\s+type\s*\{/.test(t)) return;
    if (ALLOWED.some((re) => re.test(t))) return;
    problems.push(`${relative(ROOT, file)}:${i + 1}: ${t.slice(0, 100)}`);
  });
}

if (problems.length > 0) {
  console.error("✗ 'use server'-filer får bara exportera async-funktioner och typer:");
  for (const p of problems) console.error('  ' + p);
  console.error('Flytta konstanter/synkrona hjälpare till en vanlig modul (se CLAUDE.md § 29.7).');
  process.exit(1);
}
console.log("✓ 'use server'-filer exporterar bara async-funktioner och typer.");
