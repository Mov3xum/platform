import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countUserTurns,
  exchangeBudgetGuidance,
  exchangeStage,
  remainingExchanges,
  withExchangeBudget
} from './chat-closing';

test('utan tak: ingen instruktion', () => {
  assert.equal(exchangeStage({ userTurns: 3, maxExchanges: 0 }), 'unlimited');
  assert.equal(exchangeStage({ userTurns: 3, maxExchanges: undefined }), 'unlimited');
  assert.equal(exchangeBudgetGuidance({ userTurns: 3, maxExchanges: null }), null);
  assert.equal(withExchangeBudget('BAS', { userTurns: 1, maxExchanges: 0 }), 'BAS');
  assert.equal(withExchangeBudget('BAS', undefined), 'BAS');
});

test('räknar återstående svar efter den tur som besvaras nu', () => {
  assert.equal(remainingExchanges({ userTurns: 1, maxExchanges: 5 }), 4);
  assert.equal(remainingExchanges({ userTurns: 5, maxExchanges: 5 }), 0);
  // Över taket (routen avvisar, men hjälparen får aldrig bli negativ).
  assert.equal(remainingExchanges({ userTurns: 7, maxExchanges: 5 }), 0);
});

test('stadier: öppet → näst sista → sista', () => {
  assert.equal(exchangeStage({ userTurns: 1, maxExchanges: 5 }), 'open');
  assert.equal(exchangeStage({ userTurns: 3, maxExchanges: 5 }), 'open');
  assert.equal(exchangeStage({ userTurns: 4, maxExchanges: 5 }), 'penultimate');
  assert.equal(exchangeStage({ userTurns: 5, maxExchanges: 5 }), 'final');
  // Tak på 1: första svaret är också det sista.
  assert.equal(exchangeStage({ userTurns: 1, maxExchanges: 1 }), 'final');
});

test('sista turen förbjuder frågor och kräver avslut', () => {
  const text = exchangeBudgetGuidance({ userTurns: 5, maxExchanges: 5 }) ?? '';
  assert.match(text, /SISTA svar/);
  assert.match(text, /INGA frågor/);
  assert.match(text, /nästa steg/);
  assert.match(text, /alla sina 5 meddelanden/);
});

test('näst sista turen tillåter högst en fråga och prioriterar kontaktuppgifter', () => {
  const text = exchangeBudgetGuidance({ userTurns: 4, maxExchanges: 5 }) ?? '';
  assert.match(text, /högst EN sista fråga/);
  assert.match(text, /kontaktuppgifter/);
});

test('öppet läge anger hur många svar som återstår', () => {
  const text = exchangeBudgetGuidance({ userTurns: 2, maxExchanges: 5 }) ?? '';
  assert.match(text, /tak på 5 meddelanden/);
  assert.match(text, /3 återstår/);
});

test('instruktionen läggs SIST i systemprompten', () => {
  const composed = withExchangeBudget('Du agerar som "Coach".', { userTurns: 5, maxExchanges: 5 });
  assert.ok(composed.startsWith('Du agerar som "Coach".\n\n## Samtalets avslut'));
});

test('countUserTurns räknar bara användarmeddelanden', () => {
  assert.equal(
    countUserTurns([{ role: 'assistant' }, { role: 'user' }, { role: 'assistant' }, { role: 'user' }]),
    2
  );
});

test('varje stadium förbjuder att räknaren visas för besökaren', () => {
  for (const userTurns of [1, 4, 5]) {
    const g = exchangeBudgetGuidance({ userTurns, maxExchanges: 5 }) ?? '';
    assert.match(g, /Nämn ALDRIG taket/);
  }
});
