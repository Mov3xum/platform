/**
 * Säker konstruktion av PocketBase-filtersträngar.
 *
 * PocketBase tolkar `"` som stränggräns i filteruttryck. Interpolerar man
 * oescapad indata kan en angripare bryta sig ut ur strängen och injicera
 * egna villkor (`|| 1=1` etc.) — motsvarande SQL-injection. Använd ALLTID
 * `escFilter()` på varje dynamiskt strängvärde som interpoleras in i ett
 * filter.
 *
 * VIKTIGT: backslash måste escapas FÖRE citationstecken, annars kan ett
 * värde som slutar på `\` ändå bryta ut (`\"` blir då en escapad `"`).
 */
export function escFilter(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
