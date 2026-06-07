import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escFilter } from './pb-filter';

// Låser filter-injection-skyddet (CLAUDE.md § 10.3 A.8.9). Oescapad indata i
// en PocketBase-filtersträng är motsvarigheten till SQL-injection.

test('escFilter escapar citationstecken', () => {
  assert.equal(escFilter('a"b'), 'a\\"b');
});

test('escFilter escapar backslash FÖRE citationstecken', () => {
  // Värde som slutar på \ får inte kunna bryta ut: \" får inte bli en
  // escapad ". Backslashen måste dubblas först.
  assert.equal(escFilter('a\\'), 'a\\\\');
  assert.equal(escFilter('a\\"b'), 'a\\\\\\"b');
});

test('escFilter neutraliserar ett injection-försök', () => {
  const evil = '" || 1=1 || name="';
  const escaped = escFilter(evil);
  // Inga oescapade citationstecken kvar som kan bryta ut ur strängen.
  assert.ok(!/(^|[^\\])"/.test(escaped), `oescapad " kvar i: ${escaped}`);
});

test('escFilter lämnar ofarliga värden orörda', () => {
  assert.equal(escFilter('Acme AB'), 'Acme AB');
  assert.equal(escFilter('556677-8899'), '556677-8899');
});

test('escFilter neutraliserar cross-tenant-utbrytning via route-param-id', () => {
  // Klassisk IDOR-via-filter-injection: PB:s && binder hårdare än ||, så ett
  // okontrollerat id kan annars bli `(tenant=A && id=x) || (tenant != "")`.
  const evil = 'x" || tenant != "';
  const filter = `tenant = "T" && id = "${escFilter(evil)}"`;
  // Räkna citationstecken: alla utom strängavgränsarna måste vara escapade.
  assert.ok(!/(^|[^\\])"\s*\|\|/.test(`id = "${escFilter(evil)}"`), `bröt ut: ${filter}`);
});

/**
 * Property/fuzz: för GODTYCKLIG indata måste `"${escFilter(x)}"` ge en
 * sträng-literal som inte kan brytas ut ur. Invarianten vi bevisar: tar man
 * bort alla escapade sekvenser (`\\` och `\"`) finns det INGET kvarvarande
 * `"` i kroppen — dvs den enda oescapade `"` är avgränsaren.
 */
function bodyHasUnescapedQuote(escaped: string): boolean {
  // Ta bort escapade par (\\ och \") vänster-till-höger, kolla efter kvarvarande ".
  const stripped = escaped.replace(/\\[\\"]/g, '');
  return stripped.includes('"');
}

function randomString(rng: () => number): string {
  // Tecken som spelar roll för filter-syntaxen + brus.
  const alphabet = ['"', '\\', "'", '|', '&', '=', ' ', 'x', '0', '\n', '\t', '(', ')', '~'];
  const len = Math.floor(rng() * 24);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

test('escFilter: fuzz — ingen indata kan bryta ut ur en dubbelciterad literal', () => {
  // Deterministisk PRNG (mulberry32) → reproducerbar fuzz utan beroenden.
  let seed = 0x9e3779b9;
  const rng = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 5000; i++) {
    const input = randomString(rng);
    const escaped = escFilter(input);
    assert.ok(
      !bodyHasUnescapedQuote(escaped),
      `fuzz-utbrytning för ${JSON.stringify(input)} → ${JSON.stringify(escaped)}`
    );
    // En backslash får aldrig lämnas udda (skulle escapa avgränsaren).
    const trailingBackslashes = (escaped.match(/\\+$/)?.[0].length ?? 0);
    assert.equal(trailingBackslashes % 2, 0, `udda trailing-backslash: ${JSON.stringify(escaped)}`);
  }
});
