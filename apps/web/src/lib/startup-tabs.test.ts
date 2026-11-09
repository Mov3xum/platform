import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTUP_TABS, activeStartupTab, legacyStartupAnchorTarget, startupTabHref } from './startup-tabs';

test('flikarna har unika id:n och sökvägar', () => {
  assert.equal(new Set(STARTUP_TABS.map((t) => t.id)).size, STARTUP_TABS.length);
  assert.equal(new Set(STARTUP_TABS.map((t) => t.path)).size, STARTUP_TABS.length);
});

test('aktiv flik följer sökvägen', () => {
  assert.equal(activeStartupTab('/startups/abc', 'abc'), 'overview');
  assert.equal(activeStartupTab('/startups/abc/utveckling', 'abc'), 'utveckling');
  assert.equal(activeStartupTab('/startups/abc/verktyg/run1', 'abc'), 'verktyg');
  assert.equal(activeStartupTab('/startups/abc/edit', 'abc'), 'overview');
  assert.equal(startupTabHref('abc', 'ekonomi', 'agarbild'), '/startups/abc/ekonomi#agarbild');
});

test('gamla ankare leder till rätt flik och behåller query', () => {
  assert.equal(legacyStartupAnchorTarget('abc', '#de-minimis'), '/startups/abc/ekonomi#de-minimis');
  assert.equal(legacyStartupAnchorTarget('abc', '#statsstod', '?bedomning=ok'), '/startups/abc/ekonomi?bedomning=ok#statsstod');
  assert.equal(legacyStartupAnchorTarget('abc', '#partners'), '/startups/abc/ekonomi#kapital');
  assert.equal(legacyStartupAnchorTarget('abc', '#tools'), '/startups/abc/verktyg');
  assert.equal(legacyStartupAnchorTarget('abc', '#readiness'), '/startups/abc/utveckling#irl');
  assert.equal(legacyStartupAnchorTarget('abc', '#notes'), null);
  assert.equal(legacyStartupAnchorTarget('abc', '#okant'), null);
  assert.equal(legacyStartupAnchorTarget('abc', ''), null);
});
