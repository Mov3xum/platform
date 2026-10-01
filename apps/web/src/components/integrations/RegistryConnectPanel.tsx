'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { ConnectForm } from '@/app/integrationer/[slug]/ConnectForm';

interface FieldSpec {
  key: string;
  label: string;
  type: 'password' | 'text';
  help?: string;
  required?: boolean;
}

interface Props {
  providerSlug: string;
  providerName: string;
  fields: FieldSpec[];
  connected: boolean;
  /** Katalograden saknas (migration 1700000173 inte körd, ingen superuser). */
  catalogMissingReason?: string;
}

/**
 * Inline-anslutning för bolagsregister-providrar (Roaring, Bolagsverket) direkt
 * på kortet under Inställningar → Integrationer: nycklarna klistras in här,
 * verifieras mot leverantörens token-endpoint (`connectIntegrationAction`) och
 * lagras AES-256-GCM-krypterade (§ 11.5). Synk och "Testa mot org-nr" ligger
 * kvar på detaljsidan. Ren presentation — RBAC och validering i actionen.
 */
export function RegistryConnectPanel({
  providerSlug,
  providerName,
  fields,
  connected,
  catalogMissingReason
}: Props) {
  const detailHref = `/integrationer/${providerSlug}`;

  if (catalogMissingReason) {
    return (
      <div className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
        {catalogMissingReason}
      </div>
    );
  }

  if (connected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground-muted">
            <Check className="h-3.5 w-3.5 text-movexum-morkgron" />
            Nycklar sparade (krypterade)
          </span>
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
          >
            Synka &amp; testa
          </Link>
        </div>
        <details className="group rounded-xl border border-default bg-canvas-subtle px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-foreground-muted">
            Byt nycklar
          </summary>
          <div className="pt-3">
            <ConnectForm
              providerSlug={providerSlug}
              providerName={providerName}
              fields={fields}
              submitLabel="Spara nya nycklar"
              successMessage="Nycklarna är verifierade och sparade."
            />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-foreground-subtle">
        Klistra in nycklarna från leverantörens utvecklarportal. Anslutningen
        verifieras direkt mot leverantören innan något sparas.
      </p>
      <ConnectForm
        providerSlug={providerSlug}
        providerName={providerName}
        fields={fields}
        successMessage={`${providerName} ansluten. Öppna "Synka & testa" för att prova mot ett org-nr.`}
      />
      <Link
        href={detailHref}
        className="inline-flex text-[11.5px] text-link hover:underline"
      >
        Öppna detaljsidan (synk, testa mot org-nr, regelefterlevnad) →
      </Link>
    </div>
  );
}
