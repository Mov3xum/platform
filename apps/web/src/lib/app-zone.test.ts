import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appZoneForPath } from './app-zone';

test('Impact Navigator är den gröna zonen — rot och undersidor', () => {
  assert.equal(appZoneForPath('/impactnavigator'), 'impact');
  assert.equal(appZoneForPath('/impactnavigator/omip77vgymfj3hu/vasentlighet'), 'impact');
  assert.equal(appZoneForPath('/impactnavigator/jamfor'), 'impact');
});

test('övriga sidor har ingen zon — inte ens en sökväg som bara börjar likadant', () => {
  assert.equal(appZoneForPath('/hem'), null);
  assert.equal(appZoneForPath('/impactnavigatorx'), null);
  assert.equal(appZoneForPath('/startups/abc'), null);
});
