import Link from 'next/link';
import { getServerPb } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { pbFileUrl } from '@/lib/pb-file';
import { Icon } from '@/components/proto/Icon';
import { loadRegelverk } from '@/lib/de-minimis/data';
import { DeMinimisBars } from '@/app/de-minimis/DeMinimisBars';
import { AddStodForm } from '@/app/de-minimis/[startupId]/AddStodForm';
import { StodList, type StodRow } from '@/app/de-minimis/[startupId]/StodList';
import {
  samladSummaSek,
  summarize,
  type DeMinimisStod,
  type DeMinimisStodCalc,
  type DeMinimisUnit
} from '@platform/shared';

/**
 * Inbäddad de minimis-modul för bolagskortet (CLAUDE.md § 20.5) och "Mitt
 * bolag". Förenklat flöde: progress-barer (samlad summa i kronor + per
 * förordning) + ett mall-drivet registreringsformulär + listan över stöd.
 *
 * Ingen manuell enhets-/org.nr-hantering — bolaget behandlas som EN enhet
 * ("ett enda företag"); enheten skapas lazy av `addStodAction` när det första
 * stödet registreras. Staff som behöver gruppera flera org.nr under en enhet
 * når den avancerade vyn via "Öppna fullskärm". Reads går via `getServerPb()`
 * så RLS (§ 21) gäller; filtervärden escapas med `escFilter` (ISO 27001 A.8.9).
 */
export async function DeMinimisSection({
  startupId,
  canManage
}: {
  startupId: string;
  /** Behålls för anropskompatibilitet (bolaget behandlas som en enhet). */
  startupName?: string;
  canManage: boolean;
}) {
  const pb = await getServerPb();

  let units: DeMinimisUnit[] = [];
  let stodRows: DeMinimisStod[] = [];
  try {
    units = await pb
      .collection(PB_COLLECTIONS.deMinimisUnits)
      .getFullList<DeMinimisUnit>({ filter: `startup = "${escFilter(startupId)}"`, sort: 'created' });
    stodRows = await pb
      .collection(PB_COLLECTIONS.deMinimisStod)
      .getFullList<DeMinimisStod>({ filter: `startup = "${escFilter(startupId)}"`, sort: '-beslutsdatum' });
  } catch (error) {
    console.error('[de-minimis] failed to load section data (inline)', { startupId, error });
  }

  const regelverk = await loadRegelverk(pb);

  // Aggregera ALLA bolagets stöd (oavsett enhet) — bolaget = ett enda företag.
  const calcRows: DeMinimisStodCalc[] = stodRows.map((s) => ({
    forordning: s.forordning,
    belopp_eur: s.belopp_eur,
    beslutsdatum: s.beslutsdatum
  }));
  const { perForordning, samlat } = summarize(calcRows, regelverk);
  const samladSek = samladSummaSek(stodRows, new Date());

  const stodViewRows: StodRow[] = stodRows.map((s) => ({
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

  const primaryUnitId = units[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-default bg-canvas-subtle p-4 text-[13px] text-foreground-muted">
        Ett enda företag får totalt ta emot max 300 000 EUR i de minimis-stöd under en rullande
        treårsperiod (sektorstöd inräknat). Detta är ett internt stödverktyg; slutlig prövning
        görs av stödgivaren.
      </div>

      {/* SEK-headline: hur mycket bolaget tagit emot "på kronan". */}
      <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Mottaget de minimis-stöd (rullande 3 år)
        </p>
        <p className="mt-1 text-3xl font-semibold text-foreground">
          {samladSek.complete ? '' : '≥ '}
          {Math.round(samladSek.sek).toLocaleString('sv-SE')} kr
        </p>
        {!samladSek.complete ? (
          <p className="mt-1 text-[11px] text-foreground-subtle">
            Vissa poster saknar belopp i kronor – summan är en undre gräns.
          </p>
        ) : null}

        <div className="mt-5">
          <DeMinimisBars
            perForordning={perForordning}
            samlat={samlat}
            regelverk={regelverk}
            samladSek={samladSek}
          />
        </div>

        {primaryUnitId ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <a
              href={`/api/de-minimis/units/${primaryUnitId}/forsakran`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-link transition hover:bg-canvas-subtle"
            >
              <Icon name="download" size={14} /> Generera försäkran (PDF)
            </a>
          </div>
        ) : null}
      </div>

      {canManage ? (
        <div className="rounded-2xl border border-default bg-canvas-subtle p-5">
          <p className="mb-1 text-sm font-semibold text-foreground">Registrera de minimis-stöd</p>
          <p className="mb-4 text-xs text-foreground-muted">
            Välj stödgivare ur listan, fyll i belopp i kronor och beslutsdatum, spara.
          </p>
          <AddStodForm startupId={startupId} regelverk={regelverk} />
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Registrerade stöd
        </p>
        <StodList rows={stodViewRows} canManage={canManage} />
      </div>

      <p className="text-[11px] text-foreground-subtle">
        Behöver du gruppera flera organisationsnummer under ett enda företag?{' '}
        <Link href={`/de-minimis/${startupId}`} className="font-medium text-link hover:underline">
          Öppna fullskärm
        </Link>
        .
      </p>
    </div>
  );
}
