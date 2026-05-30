import { getServerPb } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { pbFileUrl } from '@/lib/pb-file';
import { Icon } from '@/components/proto/Icon';
import { loadRegelverk } from '@/lib/de-minimis/data';
import { DeMinimisBars } from '@/app/de-minimis/DeMinimisBars';
import { AddStodForm } from '@/app/de-minimis/[startupId]/AddStodForm';
import { CreateUnitForm } from '@/app/de-minimis/[startupId]/CreateUnitForm';
import { OrgnrManager, type OrgnrRow } from '@/app/de-minimis/[startupId]/OrgnrManager';
import { StodList, type StodRow } from '@/app/de-minimis/[startupId]/StodList';
import { UnitActions } from '@/app/de-minimis/[startupId]/UnitActions';
import {
  summarize,
  type DeMinimisStod,
  type DeMinimisStodCalc,
  type DeMinimisUnit,
  type DeMinimisUnitOrgnr
} from '@platform/shared';

/**
 * Inbäddad de minimis-modul för bolagskortet (CLAUDE.md § 20). Reproducerar
 * kroppen av `de-minimis/[startupId]/page.tsx` UTAN PageShell/yttre nav så att
 * progress-barerna (summa-läsning via `summarize`) OCH alla formulär ("mallar")
 * blir direkt användbara inline. Återanvänder de befintliga klientformulären
 * och `DeMinimisBars` (ingen duplicerad logik). Reads går via `getServerPb()`
 * så RLS (§ 19) gäller; alla dynamiska filtervärden escapas med `escFilter`
 * (ISO 27001 A.8.9).
 */
export async function DeMinimisSection({
  startupId,
  startupName,
  canManage
}: {
  startupId: string;
  startupName: string;
  canManage: boolean;
}) {
  const pb = await getServerPb();

  let units: DeMinimisUnit[] = [];
  let orgnrRows: DeMinimisUnitOrgnr[] = [];
  let stodRows: DeMinimisStod[] = [];
  try {
    units = await pb
      .collection(PB_COLLECTIONS.deMinimisUnits)
      .getFullList<DeMinimisUnit>({ filter: `startup = "${escFilter(startupId)}"`, sort: 'created' });
    orgnrRows = await pb
      .collection(PB_COLLECTIONS.deMinimisUnitOrgnr)
      .getFullList<DeMinimisUnitOrgnr>({ filter: `unit.startup = "${escFilter(startupId)}"` });
    stodRows = await pb
      .collection(PB_COLLECTIONS.deMinimisStod)
      .getFullList<DeMinimisStod>({ filter: `startup = "${escFilter(startupId)}"` });
  } catch (error) {
    console.error('[de-minimis] failed to load unit data (inline)', { startupId, error });
  }

  const regelverk = await loadRegelverk(pb);

  const orgnrByUnit = new Map<string, OrgnrRow[]>();
  for (const r of orgnrRows) {
    const key = String(r.unit);
    if (!orgnrByUnit.has(key)) orgnrByUnit.set(key, []);
    orgnrByUnit.get(key)!.push({ id: r.id, organisationsnummer: r.organisationsnummer });
  }

  const stodByUnit = new Map<string, DeMinimisStod[]>();
  for (const s of stodRows) {
    const key = String(s.unit);
    if (!stodByUnit.has(key)) stodByUnit.set(key, []);
    stodByUnit.get(key)!.push(s);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-default bg-canvas-subtle p-4 text-[13px] text-foreground-muted">
        Sektorstöd (jordbruk/fiske) räknas in i den samlade summan — ett enda företag får
        totalt max 300 000 EUR i de minimis under den rullande treårsperioden. Detta är ett
        internt stödverktyg; slutlig prövning görs av stödgivaren.
      </div>

      {units.length === 0 ? (
        <div className="rounded-2xl border border-default bg-surface p-6">
          <h3 className="text-base font-semibold text-foreground">Skapa en enhet</h3>
          <p className="mb-4 mt-1 text-sm text-foreground-muted">
            En enhet (&quot;ett enda företag&quot;) samlar de organisationsnummer som hör ihop
            och summerar stödet gemensamt. Skapa en för att börja registrera de minimis-stöd.
          </p>
          {canManage ? (
            <CreateUnitForm startupId={startupId} defaultName={startupName} />
          ) : (
            <p className="text-sm text-foreground-subtle">
              Ingen enhet finns ännu. Kontakta inkubatorpersonalen för att lägga upp en.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {units.map((unit) => {
            const unitStod = stodByUnit.get(unit.id) ?? [];
            const calcRows: DeMinimisStodCalc[] = unitStod.map((s) => ({
              forordning: s.forordning,
              belopp_eur: s.belopp_eur,
              beslutsdatum: s.beslutsdatum
            }));
            const { perForordning, samlat } = summarize(calcRows, regelverk);
            const stodViewRows: StodRow[] = unitStod.map((s) => ({
              id: s.id,
              forordning: s.forordning,
              stodgivare: s.stodgivare,
              beslutsdatum: s.beslutsdatum,
              belopp_eur: s.belopp_eur,
              belopp_sek: s.belopp_sek,
              valutakurs: s.valutakurs,
              beslut_referens: s.beslut_referens,
              syfte: s.syfte,
              registrerad_i_eair: s.registrerad_i_eair,
              dokumentUrl: s.dokument ? pbFileUrl('de_minimis_stod', s.id, s.dokument) : null
            }));

            return (
              <section
                key={unit.id}
                className="rounded-2xl border border-default bg-surface p-6"
              >
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{unit.namn}</h3>
                    <p className="text-xs text-foreground-subtle">Ett enda företag (single undertaking)</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/api/de-minimis/units/${unit.id}/forsakran`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-link transition hover:bg-canvas-subtle"
                    >
                      <Icon name="download" size={14} /> Generera försäkran (PDF)
                    </a>
                    <UnitActions unitId={unit.id} namn={unit.namn} canManage={canManage} />
                  </div>
                </div>

                <DeMinimisBars perForordning={perForordning} samlat={samlat} regelverk={regelverk} />

                <div className="mt-6 border-t border-default pt-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                    Organisationsnummer i enheten
                  </p>
                  <OrgnrManager
                    unitId={unit.id}
                    rows={orgnrByUnit.get(unit.id) ?? []}
                    canManage={canManage}
                  />
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_minmax(320px,400px)]">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                      Registrerade stöd
                    </p>
                    <StodList rows={stodViewRows} canManage={canManage} />
                  </div>
                  {canManage ? (
                    <div className="rounded-xl border border-default bg-canvas-subtle p-4">
                      <p className="mb-3 text-sm font-semibold text-foreground">Lägg till stöd</p>
                      <AddStodForm unitId={unit.id} regelverk={regelverk} />
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}

          {canManage ? (
            <div className="rounded-2xl border border-dashed border-default bg-surface p-5">
              <p className="mb-3 text-sm font-medium text-foreground">Lägg till ytterligare en enhet</p>
              <CreateUnitForm startupId={startupId} defaultName={`${startupName} (enhet ${units.length + 1})`} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
