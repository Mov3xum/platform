/**
 * Begriplig token-rad under ett chattsvar (§ 28.2) — ren, enhetstestad.
 *
 * Tidigare visades EN summa ("133 034 tokens") som blandade det modellen
 * skrev för användaren med hela den dolda kontexten (systemprompt, verktyg,
 * historik, verktygsresultat) för VARJE anrop i agent-loopen. Läst som
 * "kostnaden för mitt meddelande" var den missvisande. Nu: synligt bara
 * modell + det modellen faktiskt genererade (jämförbart med ett svar i
 * Claude/ChatGPT); kontexten redovisas på begäran, med förklaring.
 */

const SV_NUMBER = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });

export interface TurnUsageInput {
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Antal modellanrop i turen (1 + ett per verktygssteg). */
  apiCalls?: number | null;
}

export interface TurnUsageText {
  /** "2 300 tokens genererade" — tomt när inget finns att visa. */
  headline: string;
  /** Förklaring av kontexten som skickades — tomt när in-tokens saknas. */
  detail: string;
}

function n(v: number | null | undefined): number {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
}

export function formatTokenCount(tokens: number | null | undefined): string {
  return SV_NUMBER.format(n(tokens));
}

export function describeTurnUsage(input: TurnUsageInput): TurnUsageText {
  const tokensIn = n(input.tokensIn);
  const tokensOut = n(input.tokensOut);
  const calls = n(input.apiCalls);

  const headline = tokensOut > 0 ? `${formatTokenCount(tokensOut)} tokens genererade` : '';

  if (tokensIn === 0) return { headline, detail: '' };

  const callsPart =
    calls > 1
      ? ` över ${calls} anrop — varje verktygssteg är ett eget anrop som läser om systemprompt, verktyg, historik och tidigare verktygsresultat (Mistral har ingen prompt-cache)`
      : '';
  const detail =
    `Kontext som modellen läste: ${formatTokenCount(tokensIn)} tokens${callsPart}. ` +
    `Svaret självt: ${formatTokenCount(tokensOut)} tokens. ` +
    'Period- och miljöstatistik finns i Insikter.';
  return { headline, detail };
}
