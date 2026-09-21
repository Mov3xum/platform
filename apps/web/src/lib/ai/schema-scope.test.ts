import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_SCHEMA_COLLECTIONS,
  MAX_DETAILED_COLLECTIONS,
  selectRelevantCollections,
  buildScopedSchemaSummary,
  type ScopableCollection
} from './schema-scope';

function col(name: string, fields: string[] = ['id', 'name'], tenantField: string | null = 'tenant'): ScopableCollection {
  return {
    name,
    description: `Beskrivning av ${name}`,
    tenantField,
    fields: fields.map((f) => ({ name: f }))
  };
}

const COLLECTIONS: ScopableCollection[] = [
  col('startups', ['name', 'phase', 'irl_level', 'status']),
  col('activities', ['title', 'type', 'status']),
  col('tasks', ['title', 'status', 'due_at']),
  col('agreements', ['title', 'status', 'document_hash']),
  col('agreement_signatures', ['party', 'signed_at']),
  col('capital_rounds', ['type', 'amount_sek', 'received_at']),
  col('startup_financials', ['year', 'revenue_sek']),
  col('compass_leads', ['name', 'status']),
  col('workshops', ['title']),
  col('workshop_assignments', ['status']),
  col('de_minimis_stod', ['belopp_eur', 'beslutsdatum']),
  col('incubator_events', ['name', 'starts_at']),
  col('event_signups', ['status']),
  col('contacts', ['first_name']),
  col('milestones', ['title', 'status']),
  col('web_cache', ['key'], null)
];

// ── selectRelevantCollections ────────────────────────────────────────────────

test('kärnkollektionerna är alltid relevanta, även med tom text', () => {
  const relevant = selectRelevantCollections(COLLECTIONS, '');
  for (const core of CORE_SCHEMA_COLLECTIONS) assert.ok(relevant.has(core), core);
  assert.equal(relevant.size, CORE_SCHEMA_COLLECTIONS.length);
});

test('svenska synonymer mappar till rätt kollektioner', () => {
  const relevant = selectRelevantCollections(COLLECTIONS, 'hur många avtal har bolagen signerat?');
  assert.ok(relevant.has('agreements'));
  assert.ok(relevant.has('agreement_signatures'));
  // Orelaterade kollektioner får INTE fältlistor.
  assert.ok(!relevant.has('compass_leads'));
  assert.ok(!relevant.has('workshops'));
});

test('kapital/investering träffar capital_rounds; ekonomi träffar financials', () => {
  const a = selectRelevantCollections(COLLECTIONS, 'vilka investeringar har gjorts i år?');
  assert.ok(a.has('capital_rounds'));
  const b = selectRelevantCollections(COLLECTIONS, 'vad var omsättningen 2025?');
  assert.ok(b.has('startup_financials'));
});

test('explicit kollektionsnamn i texten matchar generiskt', () => {
  const relevant = selectRelevantCollections(COLLECTIONS, 'lista rader ur compass_leads tack');
  assert.ok(relevant.has('compass_leads'));
});

test('namn-tokens matchar framtida kollektioner utan synonympost', () => {
  const cols = [...COLLECTIONS, col('fakturor', ['belopp'])];
  const relevant = selectRelevantCollections(cols, 'visa alla fakturor för Enava');
  assert.ok(relevant.has('fakturor'));
});

test('taket respekteras men kärnset evicteras aldrig', () => {
  const text =
    'avtal kapital ekonomi nyckeltal lead workshop möte kontakt milstolpe stöd event uppdrag';
  const relevant = selectRelevantCollections(COLLECTIONS, text, { maxDetailed: 5 });
  assert.ok(relevant.size <= 5);
  for (const core of CORE_SCHEMA_COLLECTIONS) assert.ok(relevant.has(core), core);
});

test('default-taket är bundet', () => {
  const text = COLLECTIONS.map((c) => c.name).join(' ');
  const relevant = selectRelevantCollections(COLLECTIONS, text);
  assert.ok(relevant.size <= MAX_DETAILED_COLLECTIONS);
});

// ── buildScopedSchemaSummary ─────────────────────────────────────────────────

test('relevanta kollektioner får fältlistor, övriga bara beskrivning', () => {
  const relevant = new Set(['startups', 'agreements']);
  const summary = buildScopedSchemaSummary(COLLECTIONS, relevant);
  assert.ok(summary.includes('- startups: Beskrivning av startups. Fält: name, phase, irl_level, status'));
  assert.ok(summary.includes('- agreements: Beskrivning av agreements. Fält:'));
  // Kompakt rad utan fältlista:
  assert.ok(summary.includes('- compass_leads: Beskrivning av compass_leads'));
  assert.ok(!summary.includes('- compass_leads: Beskrivning av compass_leads. Fält:'));
});

test('indexet listar ALLA kollektioner + describe_collection-instruktion', () => {
  const summary = buildScopedSchemaSummary(COLLECTIONS, new Set(['startups']));
  for (const c of COLLECTIONS) assert.ok(summary.includes(`- ${c.name}`), c.name);
  assert.ok(summary.includes('describe_collection'));
});

test('ej tenant-scopade kollektioner markeras som referensdata', () => {
  const summary = buildScopedSchemaSummary(COLLECTIONS, new Set());
  assert.ok(summary.includes('- web_cache [referensdata, ej tenant-scopad]:'));
});

test('utan kompakta rader utelämnas ÖVRIGA-sektionen', () => {
  const all = new Set(COLLECTIONS.map((c) => c.name));
  const summary = buildScopedSchemaSummary(COLLECTIONS, all);
  assert.ok(!summary.includes('ÖVRIGA'));
});
