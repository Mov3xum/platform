/**
 * Avslutsstyrning för intag-chatten när modulen har ett tak på antal
 * utbyten (`compass_modules.max_exchanges`, § 23).
 *
 * Problemet: klienten låser inmatningen när besökaren skickat sitt sista
 * meddelande, men modellen visste inte om det och avslutade gärna med en
 * fråga ("Har du funderat på …?") som besökaren aldrig kan besvara. Den här
 * modulen ger modellen en instruktion per tur om hur många svar som återstår,
 * och på den SISTA turen förbjuds frågor: samtalet ska knytas ihop med
 * sammanfattning + nästa steg.
 *
 * Ren modul (ingen IO) — enhetstestad i `chat-closing.test.ts`. Används av
 * `intakeReply` så att den publika chatten och den interna testchatten får
 * identiskt beteende (ingen divergerande kopia).
 */

export interface ExchangeBudget {
  /** Antal användarmeddelanden i historiken, INKLUSIVE det som besvaras nu. */
  userTurns: number;
  /** Modulens tak (0/odefinierat = obegränsat). */
  maxExchanges: number | null | undefined;
}

export type ExchangeStage = 'unlimited' | 'open' | 'penultimate' | 'final';

/** Räknar antalet användarmeddelanden i en historik. */
export function countUserTurns(history: ReadonlyArray<{ role: string }>): number {
  return history.filter((m) => m.role === 'user').length;
}

/** Hur många svar besökaren har kvar EFTER den tur som besvaras nu. */
export function remainingExchanges(budget: ExchangeBudget): number | null {
  const max = Number(budget.maxExchanges);
  if (!Number.isFinite(max) || max <= 0) return null;
  const turns = Math.max(0, Math.floor(Number(budget.userTurns) || 0));
  return Math.max(0, max - turns);
}

export function exchangeStage(budget: ExchangeBudget): ExchangeStage {
  const remaining = remainingExchanges(budget);
  if (remaining === null) return 'unlimited';
  if (remaining === 0) return 'final';
  if (remaining === 1) return 'penultimate';
  return 'open';
}

/**
 * Instruktion som läggs SIST i systemprompten (efter persona/egen prompt) så
 * att en modulredaktör aldrig kan ta bort den. Returnerar null utan tak.
 */
export function exchangeBudgetGuidance(budget: ExchangeBudget): string | null {
  const stage = exchangeStage(budget);
  if (stage === 'unlimited') return null;
  const max = Math.floor(Number(budget.maxExchanges));
  const remaining = remainingExchanges(budget) ?? 0;

  if (stage === 'final') {
    return [
      '## Samtalets avslut (bindande)',
      `Detta är ditt SISTA svar i samtalet: besökaren har använt alla sina ${max} meddelanden och kan INTE svara igen efter detta.`,
      '- Ställ INGA frågor — inte ens retoriska. Avsluta inte med ett frågetecken.',
      '- Tacka och sammanfatta kort det viktigaste besökaren berättat (2–4 meningar).',
      '- Ge ett konkret nästa steg. Har besökaren lämnat e-post eller telefon: säg att någon från Movexum hör av sig dit. Annars: berätta hur besökaren själv når Movexum för ett kostnadsfritt möte.',
      '- Avsluta med en tydlig, varm avslutningsfras så att det känns som ett naturligt slut, inte ett avbrott.'
    ].join('\n');
  }

  if (stage === 'penultimate') {
    return [
      '## Samtalets avslut (bindande)',
      `Samtalet har ett tak på ${max} meddelanden från besökaren. Efter besökarens NÄSTA meddelande får du bara ett avslutande svar utan frågor.`,
      '- Ställ därför högst EN sista fråga nu. Saknas kontaktuppgifter (e-post eller telefon) är det den frågan som gäller, så att Movexum kan följa upp.',
      '- Signalera att samtalet närmar sig sitt slut ("Innan vi rundar av …").'
    ].join('\n');
  }

  return [
    '## Samtalets längd',
    `Samtalet har ett tak på ${max} meddelanden från besökaren; ${remaining} återstår efter detta.`,
    '- Prioritera det viktigaste: idén, vem den är för och kontaktuppgifter. Planera så att du hinner avsluta med en sammanfattning och ett konkret nästa steg innan taket nås — samtalet får aldrig sluta mitt i en fråga.'
  ].join('\n');
}

/** Sätter ihop bas-prompten med avslutsinstruktionen. */
export function withExchangeBudget(systemPrompt: string, budget: ExchangeBudget | undefined): string {
  const guidance = budget ? exchangeBudgetGuidance(budget) : null;
  return guidance ? `${systemPrompt}\n\n${guidance}` : systemPrompt;
}
