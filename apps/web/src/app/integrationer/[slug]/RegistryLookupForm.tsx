'use client';

import { useActionState } from 'react';
import {
  previewRegistryLookupAction,
  type RegistryLookupState
} from '@/lib/actions/integrations';

interface Props {
  providerSlug: string;
  providerName: string;
}

const initialState: RegistryLookupState = {};

function sek(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} kr` : '–';
}

function pct(v?: number) {
  return typeof v === 'number' ? `${v.toLocaleString('sv-SE')} %` : undefined;
}

const OWNER_KIND_LABEL: Record<string, string> = {
  company: 'Bolag',
  person: 'Fysisk person',
  public_body: 'Offentlig/akademi',
  investor: 'Investerare',
  other: 'Okänd'
};

// "Testa mot org-nr" (§ 11.8): hämtar och visar vad providern tolkade för ett
// bolag UTAN att skriva något. Syftet är att verifiera fältmappningen mot en
// riktig leverantörsrespons innan portföljen synkas — därför visas även
// normaliserarens PII-fria noteringar om vad som saknades.
export function RegistryLookupForm({ providerSlug, providerName }: Props) {
  const [state, formAction, pending] = useActionState(previewRegistryLookupAction, initialState);
  const c = state.company;

  return (
    <section className="rounded-2xl border border-default bg-surface px-5 py-5">
      <h2 className="text-[14px] font-semibold text-foreground">Testa mot org-nr</h2>
      <p className="mt-1 text-[12px] text-foreground-muted">
        Hämtar ett bolag från {providerName} och visar exakt vad som skulle skrivas till
        bolagskortet — utan att spara något. Kör detta på ett känt bolag innan du synkar
        hela portföljen.
      </p>
      <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="provider_slug" value={providerSlug} />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Organisationsnummer
          </span>
          <input
            name="org_nr"
            inputMode="numeric"
            placeholder="559572-8790"
            className="mt-1 block w-48 rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl border border-strong px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Hämtar…' : 'Hämta'}
        </button>
      </form>

      {state.error && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-xs text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}

      {c && (
        <div className="mt-4 space-y-4 text-[13px]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Grunddata {c.name ? `— ${c.name}` : ''}
            </p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(c.startup).length === 0 && (
                <dd className="text-foreground-muted">Inga fält kunde tolkas.</dd>
              )}
              {Object.entries(c.startup).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-default py-1">
                  <dt className="text-foreground-subtle">{k}</dt>
                  <dd className="text-right text-foreground">{String(v)}</dd>
                </div>
              ))}
            </dl>
            {c.isPersonal && (
              <p className="mt-2 text-xs text-foreground-muted">
                Enskild firma — org-nr är ett personnummer och exkluderas ur AI-kontexten.
              </p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Bokslut ({c.financials.length} år)
            </p>
            {c.financials.length === 0 ? (
              <p className="mt-1 text-foreground-muted">Inga årsrader i svaret.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-default">
                <table className="w-full text-[12px]">
                  <thead className="bg-canvas-subtle text-left text-foreground-subtle">
                    <tr>
                      <th className="px-3 py-2 font-medium">År</th>
                      <th className="px-3 py-2 font-medium">Omsättning</th>
                      <th className="px-3 py-2 font-medium">Anställda</th>
                      <th className="px-3 py-2 font-medium">Balansomslutning</th>
                      <th className="px-3 py-2 font-medium">Eget kapital</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.financials.map((f) => (
                      <tr key={f.year} className="border-t border-default">
                        <td className="px-3 py-2 font-medium text-foreground">{f.year}</td>
                        <td className="px-3 py-2 text-foreground-muted">{sek(f.revenue_sek)}</td>
                        <td className="px-3 py-2 text-foreground-muted">{f.employees ?? '–'}</td>
                        <td className="px-3 py-2 text-foreground-muted">{sek(f.balance_sheet_sek)}</td>
                        <td className="px-3 py-2 text-foreground-muted">{sek(f.equity_sek)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Ägarbild ({c.ownership.length} rader)
            </p>
            {c.ownership.length === 0 ? (
              <p className="mt-1 text-foreground-muted">
                Inga ägare/innehav i svaret (fristående bolag, eller källan levererar ingen ägarbild).
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-default rounded-xl border border-default">
                {c.ownership.map((o, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-foreground">
                      <span className="mr-2 rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                        {o.direction === 'owner' ? 'Ägare' : 'Innehav'}
                      </span>
                      {o.owner_kind === 'person' ? 'Fysisk person' : o.name || o.org_nr || 'Okänd'}
                      <span className="ml-2 text-foreground-subtle">
                        {OWNER_KIND_LABEL[o.owner_kind] || o.owner_kind}
                        {o.indirect ? ' · indirekt' : ''}
                      </span>
                    </span>
                    <span className="text-foreground-muted">
                      {pct(o.capital_pct) ||
                        (typeof o.pct_min === 'number' && typeof o.pct_max === 'number'
                          ? `${o.pct_min}–${o.pct_max} %`
                          : '–')}
                      {o.control_basis ? ` · ${o.control_basis}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {c.notes.length > 0 && (
            <div className="rounded-xl border border-default bg-canvas-subtle px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Noteringar från tolkningen
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-foreground-muted">
                {c.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
