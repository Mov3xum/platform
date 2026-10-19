'use client';

import { SCREENING_NOTE_MAX, SNI_MATCH_LABEL, formatSni, type OwnerEngagementView, type PersonLinkFact, type ScreeningManualFacts, type ScreeningSni, type SniMatch } from '@platform/shared';
import { NEUTRAL_STRONG_TONE, NEUTRAL_TONE, WARN_TONE, formatOrgNr, inputCls } from './shared';

const PERSON_LINK_LABEL: Record<OwnerEngagementView['companies'][number]['relation'], string> = {
  linked: 'Anknutet — prövas',
  uncertain: 'Oklart — avgör',
  none: 'Räknas inte'
};

/** Bransch-jämförelsen är information, inte utfall: samma SNI = markerad neutralt, oklart = gul. */
const SNI_MATCH_TONE: Record<SniMatch, string> = {
  same: NEUTRAL_STRONG_TONE,
  near: WARN_TONE,
  unknown: WARN_TONE,
  different: NEUTRAL_TONE
};

/**
 * Ägarnas andra bolag (§ 51.11) — för varje fysisk ägare de bolag personen
 * äger/kontrollerar utanför koncernen, med SNI-kod. Samma SNI-kod som
 * startup-bolaget ⇒ anknutet via fysisk person (bilaga I art. 3.3 st. 4): båda
 * bolagen ska klara kriterierna. Controllern kan avgöra varje bolag själv
 * (sparas med "Spara och räkna om").
 */
export function OwnerEngagements({
  engagements,
  subjectName,
  subjectSni,
  registerMode,
  facts,
  setFacts
}: {
  engagements?: OwnerEngagementView[];
  subjectName: string;
  subjectSni?: ScreeningSni[];
  registerMode: boolean;
  facts: ScreeningManualFacts;
  setFacts: (f: (prev: ScreeningManualFacts) => ScreeningManualFacts) => void;
}) {
  const setLink = (orgNr: string, v: PersonLinkFact | undefined) =>
    setFacts((f) => {
      const next = { ...(f.person_links ?? {}) };
      if (v) next[orgNr] = v;
      else delete next[orgNr];
      return { ...f, person_links: next };
    });
  return (
    <div>
      <h4 className="text-[13.5px] font-semibold text-foreground">Ägarnas andra bolag</h4>
      {!engagements ? (
        <p className="mt-1 text-[12.5px] text-foreground-muted">
          {registerMode
            ? 'Hämtades inte i den här körningen. Välj "Ägarnas andra bolag" vid nästa hämtning så söks varje fysisk ägares övriga bolag med SNI-kod.'
            : 'Söks bara vid hämtning från bolagsregistret (datadelen "Ägarnas andra bolag").'}
        </p>
      ) : engagements.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-foreground-muted">Inga fysiska huvudmän i registret — inga andra bolag att söka.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {!subjectSni?.length && (
            <p className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${WARN_TONE}`}>
              SNI-kod saknas för {subjectName} — bolagen kan inte jämföras på bransch.
            </p>
          )}
          {engagements.map((p, i) => (
            <div key={`${p.person_name ?? 'person'}-${i}`} className="overflow-x-auto rounded-xl border border-default">
              <table className="w-full text-[12.5px]">
                <caption className="bg-canvas-subtle px-3 py-2 text-left text-[12px] font-semibold text-foreground">
                  {p.person_name || 'Huvudman (namn saknas i svaret)'}
                  <span className="ml-2 font-normal text-foreground-muted">
                    äger {p.subjectShareLabel} av {subjectName}
                    {p.status === 'none' ? ' · inga andra bolag i registret' : ''}
                    {p.status === 'no_id' || p.status === 'failed' ? ` · kunde inte sökas: ${p.reason ?? 'okänt fel'}` : ''}
                  </span>
                </caption>
                {p.companies.length > 0 && (
                  <>
                    <thead className="text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
                      <tr className="border-t border-default">
                        <th className="px-3 py-1.5 font-medium">Bolag</th>
                        <th className="px-3 py-1.5 font-medium">Andel</th>
                        <th className="px-3 py-1.5 font-medium">SNI</th>
                        <th className="px-3 py-1.5 font-medium">Bransch</th>
                        <th className="px-3 py-1.5 font-medium">Bedömning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.companies.map((c) => (
                        <tr key={c.org_nr || c.name} className="border-t border-default align-top">
                          <td className="px-3 py-1.5 text-foreground">
                            {c.name || '–'}
                            {c.org_nr ? <span className="ml-2 text-[11.5px] text-foreground-subtle mx-tnum">{formatOrgNr(c.org_nr)}</span> : null}
                            {c.basic?.registeredAt ? (
                              <span className="block text-[11px] text-foreground-subtle mx-tnum">
                                Registrerat {c.basic.registeredAt.slice(0, 10)}
                                {c.basic.bolagStatus ? ` · ${c.basic.bolagStatus}` : ''}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-1.5 text-foreground-muted mx-tnum">{c.shareLabel}</td>
                          <td className="px-3 py-1.5 text-foreground-muted">
                            {c.basic?.sni?.length ? (
                              c.basic.sni.map((x) => (
                                <span key={x.code} className="block mx-tnum">
                                  {formatSni(x)}
                                </span>
                              ))
                            ) : (
                              <span className="text-foreground-subtle">{c.note ?? '–'}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SNI_MATCH_TONE[c.sniMatch]}`}>
                              {SNI_MATCH_LABEL[c.sniMatch]}
                              {c.matchedCode ? ` ${c.matchedCode}` : ''}
                            </span>
                          </td>
                          <td className="px-3 py-1.5">
                            <p className="text-[11.5px] font-semibold text-foreground">{PERSON_LINK_LABEL[c.relation]}</p>
                            <p className="text-[11.5px] text-foreground-muted">{c.reason}</p>
                            {c.org_nr && (
                              <select
                                aria-label={`Bedömning för ${c.name || c.org_nr}`}
                                className={`${inputCls} mt-1 max-w-[260px]`}
                                value={facts.person_links?.[c.org_nr]?.verdict ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setLink(c.org_nr!, v === 'linked' || v === 'not_linked' ? { verdict: v, note: facts.person_links?.[c.org_nr!]?.note } : undefined);
                                }}
                              >
                                <option value="">Systemets bedömning (SNI-kod)</option>
                                <option value="linked">Anknutet — samma eller angränsande marknad</option>
                                <option value="not_linked">Inte anknutet — annan marknad / ingen gemensam kontroll</option>
                              </select>
                            )}
                            {c.org_nr && facts.person_links?.[c.org_nr] && (
                              <input
                                className={`${inputCls} mt-1 max-w-[260px]`}
                                placeholder="Motivering (t.ex. vad bolaget gör)"
                                maxLength={SCREENING_NOTE_MAX}
                                value={facts.person_links[c.org_nr].note ?? ''}
                                onChange={(e) => setLink(c.org_nr!, { verdict: facts.person_links![c.org_nr!].verdict, note: e.target.value || undefined })}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
