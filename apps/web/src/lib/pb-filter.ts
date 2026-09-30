/**
 * Säker konstruktion av PocketBase-filtersträngar.
 *
 * PocketBase tolkar `"` som stränggräns i filteruttryck. Interpolerar man
 * oescapad indata kan en angripare bryta sig ut ur strängen och injicera
 * egna villkor (`|| 1=1` etc.) — motsvarande SQL-injection. Använd ALLTID
 * `escFilter()` på varje dynamiskt strängvärde som interpoleras in i ett
 * filter (eller PB:s bundna `pb.filter("f = {:x}", { x })`).
 *
 * BAKSTRECK (2026-09-30): PocketBase/fexpr har INGEN C-liknande escape-
 * sekvens för bakstreck. Strängskannern avslutar bara vid ett citattecken
 * som INTE föregås av `\` — oavsett hur många bakstreck som står före. Att
 * "dubbla" bakstrecket (`\\`) hjälper alltså inte: värdet `a\` blev `"a\\"`,
 * vars avslutande citattecken föregås av `\` → strängen fortsätter in i
 * resten av filtret (utbrytning). Därför TAS BAKSTRECK BORT ur värdet — de
 * har ingen legitim roll i sökvärden (namn, org-nr, e-post, id:n).
 * Samma svaghet finns i SDK:ns `pb.filter` (escapar bara `'`) — se
 * `pb-filter-guard.ts`, som patchar den centralt.
 */
export function stripFilterBackslashes(value: string): string {
  return value.replace(/\\/g, '');
}

export function escFilter(value: string): string {
  return stripFilterBackslashes(value).replace(/"/g, '\\"');
}
