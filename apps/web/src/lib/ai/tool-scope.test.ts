import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALWAYS_ON_WRITE_TOOLS,
  SCOPED_TOOL_NAMES,
  TOOL_DOMAINS,
  makeToolResolver,
  matchToolDomains,
  scopeTools
} from './tool-scope';
import { DOMAIN_WRITE_TOOLS } from './write-receipt';

type T = { type: 'function'; function: { name: string } };
const def = (name: string): T => ({ type: 'function', function: { name } });

const CATALOG: T[] = [
  'query_collection',
  'count_collection',
  'search_records',
  'describe_collection',
  'aggregate_collection',
  'search_knowledge',
  'read_knowledge_document',
  'search_my_files',
  'web_search',
  ...DOMAIN_WRITE_TOOLS,
  'request_approval',
  'start_meeting',
  'memory_read',
  'generate_document',
  'render_visual'
].map(def);

const names = (tools: T[]) => tools.map((t) => t.function.name);

test('varje skrivverktyg i DOMAIN_WRITE_TOOLS är antingen alltid-på eller i en domän', () => {
  for (const tool of DOMAIN_WRITE_TOOLS) {
    assert.ok(
      ALWAYS_ON_WRITE_TOOLS.includes(tool) || SCOPED_TOOL_NAMES.has(tool),
      `${tool} saknas i tool-scope — lägg det i ALWAYS_ON_WRITE_TOOLS eller en domän`
    );
  }
});

test('domänverktyg och alltid-på överlappar inte', () => {
  for (const tool of ALWAYS_ON_WRITE_TOOLS) assert.ok(!SCOPED_TOOL_NAMES.has(tool), tool);
  const seen = new Set<string>();
  for (const d of TOOL_DOMAINS) {
    for (const t of d.tools) {
      assert.ok(!seen.has(t), `${t} finns i två domäner`);
      seen.add(t);
    }
  }
});

test('en ren läsfråga skickar läs-/sök-/minnes-/dokumentverktyg + generiska skrivverktyg, inga domänverktyg', () => {
  const out = names(scopeTools(CATALOG, 'Hur många aktiva bolag har vi i portföljen?'));
  for (const n of ['query_collection', 'search_knowledge', 'search_my_files', 'web_search', 'memory_read', 'generate_document', 'render_visual']) {
    assert.ok(out.includes(n), n);
  }
  for (const n of ALWAYS_ON_WRITE_TOOLS) assert.ok(out.includes(n), n);
  for (const n of SCOPED_TOOL_NAMES) assert.ok(!out.includes(n), `${n} skulle inte skickas`);
  assert.ok(out.length < CATALOG.length);
});

test('tom kontext ger samma bas som en läsfråga', () => {
  assert.deepEqual(names(scopeTools(CATALOG, '')), names(scopeTools(CATALOG, 'hej')));
});

test('årshjulsfråga aktiverar bara årshjulets verktyg', () => {
  const out = names(scopeTools(CATALOG, 'Lägg in nyhetsbrevet den 15:e varje månad i årshjulet'));
  assert.ok(out.includes('create_annual_wheel_item'));
  assert.ok(out.includes('update_annual_wheel_item'));
  assert.ok(!out.includes('create_procurement'));
  assert.ok(!out.includes('create_compass_module'));
});

test('kompassmodul + upphandling i samma kontext aktiverar båda domänerna', () => {
  const domains = matchToolDomains('Gör ett quiz i Startupkompassen och lägg upp ramavtalet som upphandling');
  assert.ok(domains.has('compass'));
  assert.ok(domains.has('procurement'));
  assert.ok(!domains.has('org_posts'));
});

test('målfråga aktiverar målstyrningens skrivverktyg', () => {
  const out = names(scopeTools(CATALOG, 'Skapa ett nytt mål och lägg till en indikator'));
  for (const tool of ['create_goal', 'add_goal_indicator', 'set_goal_status']) {
    assert.ok(out.includes(tool), tool);
  }
  assert.ok(!out.includes('create_procurement'));
});

test('uttryckligt verktygsnamn i texten räknas som träff', () => {
  assert.ok(matchToolDomains('kör schedule_agent för portföljöversikten').has('schedule'));
});

test('matchningen är skiftlägesoberoende och tar svenska tecken', () => {
  assert.ok(matchToolDomains('STARTA ETT MÖTE med Fixkod').has('events'));
  assert.ok(matchToolDomains('registrera de minimis-stöd från Vinnova').has('de_minimis'));
});

test('ordningen i katalogen bevaras', () => {
  const out = names(scopeTools(CATALOG, 'skapa ett event nästa vecka'));
  const idx = (n: string) => CATALOG.findIndex((t) => t.function.name === n);
  for (let i = 1; i < out.length; i++) assert.ok(idx(out[i - 1]) < idx(out[i]));
});

test('resolvern hittar ett verktyg ur den fulla katalogen (självläkning)', () => {
  const resolve = makeToolResolver(CATALOG);
  assert.equal(resolve('create_procurement')?.function.name, 'create_procurement');
  assert.equal(resolve('finns_inte'), undefined);
});
