import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_MEMORY_CATEGORIES,
  AGENT_MEMORY_CATEGORY_IDS,
  DEFAULT_AGENT_MEMORY_CATEGORY,
  agentMemoryCategoryLabel,
  countAgentMemoryByCategory,
  groupAgentMemoryByCategory,
  inferAgentMemoryCategory,
  isAgentMemoryCategory,
  matchesAgentMemoryQuery,
  normalizeAgentMemoryCategory,
  resolveAgentMemoryCategory
} from './agent-memory';

describe('agent memory categories — taxonomy', () => {
  it('has unique ids, the default is present and comes last', () => {
    const ids = AGENT_MEMORY_CATEGORIES.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(AGENT_MEMORY_CATEGORY_IDS.includes(DEFAULT_AGENT_MEMORY_CATEGORY));
    assert.equal(ids[ids.length - 1], DEFAULT_AGENT_MEMORY_CATEGORY);
  });

  it('every category has label, description and icon; keywords are lowercase', () => {
    for (const c of AGENT_MEMORY_CATEGORIES) {
      assert.ok(c.label.length > 0);
      assert.ok(c.description.length > 0);
      assert.ok(c.icon.length > 0);
      for (const kw of c.keywords) assert.equal(kw, kw.toLowerCase());
    }
  });

  it('isAgentMemoryCategory validates membership', () => {
    assert.equal(isAgentMemoryCategory('terminologi'), true);
    assert.equal(isAgentMemoryCategory('nonsense'), false);
    assert.equal(isAgentMemoryCategory(null), false);
  });

  it('agentMemoryCategoryLabel falls back to Övrigt', () => {
    assert.equal(agentMemoryCategoryLabel('bolag'), 'Bolagsfakta');
    assert.equal(agentMemoryCategoryLabel('x'), 'Övrigt');
    assert.equal(agentMemoryCategoryLabel(undefined), 'Övrigt');
  });
});

describe('normalizeAgentMemoryCategory', () => {
  it('accepts exact ids regardless of case/whitespace', () => {
    assert.equal(normalizeAgentMemoryCategory(' Datatolkning '), 'datatolkning');
    assert.equal(normalizeAgentMemoryCategory('PORTFOLJ'), 'portfolj');
  });

  it('accepts Swedish spellings and labels', () => {
    assert.equal(normalizeAgentMemoryCategory('portfölj'), 'portfolj');
    assert.equal(normalizeAgentMemoryCategory('arbetssätt'), 'arbetssatt');
    assert.equal(normalizeAgentMemoryCategory('övrigt'), 'ovrigt');
    assert.equal(normalizeAgentMemoryCategory('Terminologi & definitioner'), 'terminologi');
    assert.equal(normalizeAgentMemoryCategory('Bolagsfakta'), 'bolag');
  });

  it('returns null for unknown or empty input (never a silent default)', () => {
    assert.equal(normalizeAgentMemoryCategory('finansiering'), null);
    assert.equal(normalizeAgentMemoryCategory(''), null);
    assert.equal(normalizeAgentMemoryCategory(42), null);
    assert.equal(normalizeAgentMemoryCategory(undefined), null);
  });
});

describe('inferAgentMemoryCategory (deterministic, no AI)', () => {
  it('classifies the terminology note from the screenshot', () => {
    assert.equal(
      inferAgentMemoryCategory(
        'finansiering_skillnad_investering_bidrag_lån',
        'I Movexum-plattformen skiljer vi tydligt på tre typer av finansiering för bolag: ' +
          '1. Investeringar (equity/convertible). 2. Lån (debt) — dessa räknas separat.'
      ),
      'terminologi'
    );
  });

  it('classifies data-interpretation rules', () => {
    assert.equal(
      inferAgentMemoryCategory(
        'kapital/räkneregel',
        'Räkna aldrig type = loan som investering. Filtrera capital_rounds på type = equity.'
      ),
      'datatolkning'
    );
  });

  it('classifies answer-format preferences', () => {
    assert.equal(
      inferAgentMemoryCategory(
        'svarsformat',
        'Hampus föredrar korta svar i tabell, alltid med belopp i SEK.'
      ),
      'arbetssatt'
    );
  });

  it('classifies company facts', () => {
    assert.equal(
      inferAgentMemoryCategory('Fixkod AB', 'Bolaget bytte namn från Kodfix till Fixkod AB 2025.'),
      'bolag'
    );
  });

  it('classifies portfolio observations', () => {
    assert.equal(
      inferAgentMemoryCategory(
        'portfölj/bidragskällor',
        'Vanliga bidragskällor senaste 2 åren: Vinnova, Almi, Region Gävleborg.'
      ),
      'portfolj'
    );
  });

  it('classifies internal processes', () => {
    assert.equal(
      inferAgentMemoryCategory(
        'intagsprocess',
        'Intag sker kvartalsvis; fas boost chamber kräver signerat avtal.'
      ),
      'processer'
    );
  });

  it('falls back to övrigt when nothing matches', () => {
    assert.equal(inferAgentMemoryCategory('x', 'y'), DEFAULT_AGENT_MEMORY_CATEGORY);
    assert.equal(inferAgentMemoryCategory(undefined, null), DEFAULT_AGENT_MEMORY_CATEGORY);
  });

  it('weights the key higher than the body', () => {
    // Nyckeln säger terminologi, innehållet nämner ett bolag en gång.
    assert.equal(
      inferAgentMemoryCategory('terminologi', 'Bolaget kallas internt X.'),
      'terminologi'
    );
  });
});

describe('resolveAgentMemoryCategory', () => {
  it('prefers a valid stored value', () => {
    assert.deepEqual(
      resolveAgentMemoryCategory({ category: 'processer', key: 'portfölj', content: 'trend' }),
      { category: 'processer', categorySource: 'stored' }
    );
  });

  it('infers when stored value is missing or invalid', () => {
    assert.deepEqual(resolveAgentMemoryCategory({ category: '', key: 'portfölj', content: 'trend' }), {
      category: 'portfolj',
      categorySource: 'inferred'
    });
    assert.equal(resolveAgentMemoryCategory({ category: 'legacy', key: 'x', content: 'y' }).categorySource, 'inferred');
  });
});

describe('grouping, counting and search', () => {
  const items = [
    { id: '1', category: 'portfolj' as const, key: 'a', content: 'Vinnova' },
    { id: '2', category: 'terminologi' as const, key: 'b', content: 'rundor' },
    { id: '3', category: 'portfolj' as const, key: 'c', content: 'Almi' },
    { id: '4', category: 'ovrigt' as const, key: 'd', content: 'z' }
  ];

  it('groups in taxonomy order, keeps intra-group order, skips empty categories', () => {
    const groups = groupAgentMemoryByCategory(items);
    assert.deepEqual(
      groups.map((g) => g.category.id),
      ['terminologi', 'portfolj', 'ovrigt']
    );
    assert.deepEqual(groups[1].items.map((i) => i.id), ['1', '3']);
  });

  it('counts per category', () => {
    assert.deepEqual(countAgentMemoryByCategory(items), { portfolj: 2, terminologi: 1, ovrigt: 1 });
  });

  it('matchesAgentMemoryQuery is case-insensitive and requires all words', () => {
    const item = { key: 'finansiering/bidrag', content: 'Vinnova Excellensmedel', scopeLabel: 'Fixkod AB' };
    assert.equal(matchesAgentMemoryQuery(item, ''), true);
    assert.equal(matchesAgentMemoryQuery(item, 'VINNOVA'), true);
    assert.equal(matchesAgentMemoryQuery(item, 'vinnova bidrag'), true);
    assert.equal(matchesAgentMemoryQuery(item, 'fixkod'), true);
    assert.equal(matchesAgentMemoryQuery(item, 'vinnova almi'), false);
  });
});
