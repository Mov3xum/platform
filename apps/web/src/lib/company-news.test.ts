import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY_NEWS_FILTER, COMPANY_NEWS_KINDS, isCompanyNewsActivity } from './company-news';

test('bolagsnytt: människopublicerade bolagsaktiviteter ingår', () => {
  assert.equal(isCompanyNewsActivity({ kind: 'manual', startup: 's1' }), true);
  assert.equal(isCompanyNewsActivity({ kind: '', startup: 's1' }), true);
  assert.equal(isCompanyNewsActivity({ kind: undefined, startup: 's1' }), true);
  assert.equal(isCompanyNewsActivity({ kind: 'note', startup: 's1' }), true);
  assert.equal(isCompanyNewsActivity({ kind: 'meeting', startup: 's1' }), true);
});

test('bolagsnytt: systemhändelser och rader utan bolag ingår inte', () => {
  for (const kind of [
    'tool_run',
    'integration_sync',
    'workshop_assignment',
    'workshop_run',
    'education_document',
    'agreement',
    'onboarding',
    'mission',
    'support_check',
    'assignment',
    'approval',
    'phase',
    'irl',
    'kompass',
    'chat'
  ]) {
    assert.equal(isCompanyNewsActivity({ kind, startup: 's1' }), false, kind);
  }
  // Portföljhändelse utan bolag är ingen bolagsnyhet.
  assert.equal(isCompanyNewsActivity({ kind: 'manual', startup: '' }), false);
  assert.equal(isCompanyNewsActivity({ kind: 'manual' }), false);
});

test('bolagsnytt: rader knutna till en verktygskörning är arbetsflöde, inte nyheter', () => {
  assert.equal(isCompanyNewsActivity({ kind: 'note', startup: 's1', tool_run: 'r1' }), false);
  assert.equal(isCompanyNewsActivity({ kind: 'manual', startup: 's1', tool: 't1' }), false);
});

test('bolagsnytt: PB-filtret speglar JS-regeln', () => {
  for (const kind of COMPANY_NEWS_KINDS) {
    assert.ok(COMPANY_NEWS_FILTER.includes(`kind = "${kind}"`), `filter saknar kind "${kind}"`);
  }
  assert.ok(COMPANY_NEWS_FILTER.includes('startup.tenant = {:tenant}'));
  assert.ok(COMPANY_NEWS_FILTER.includes('startup != ""'));
  assert.ok(COMPANY_NEWS_FILTER.includes('tool_run = ""'));
  assert.ok(COMPANY_NEWS_FILTER.includes('tool = ""'));
  // Bara bundna parametrar — aldrig ett interpolerat värde (ISO 27001 A.8.9).
  assert.ok(!COMPANY_NEWS_FILTER.includes('${'));
});
