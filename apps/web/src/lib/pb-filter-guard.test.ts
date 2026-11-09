import { test } from 'node:test';
import assert from 'node:assert/strict';
import PocketBase from 'pocketbase';
import './pb-filter-guard';

// Låser att SDK:ns bundna filter aldrig släpper igenom ett avslutande
// bakstreck (fexpr: `'…\\'` = escapat citattecken = utbrytning).

test('pb.filter tar bort bakstreck ur strängparametrar', () => {
  const pb = new PocketBase('http://localhost:8080');
  const f = pb.filter('name ~ {:q} || email ~ {:q}', { q: 'evil\\' });
  assert.equal(f, "name ~ 'evil' || email ~ 'evil'");
  assert.ok(!f.includes('\\'));
});

test('pb.filter saneras även inuti objekt och arrayer; övriga typer orörda', () => {
  const pb = new PocketBase('http://localhost:8080');
  assert.equal(pb.filter('n = {:n} && b = {:b}', { n: 5, b: true }), 'n = 5 && b = true');
  const obj = pb.filter('j = {:j}', { j: { a: 'x\\' } });
  assert.ok(!obj.includes('\\\\'), obj);
});
