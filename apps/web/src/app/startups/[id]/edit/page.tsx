import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { updateStartupAction, deleteStartupFormAction } from '@/lib/actions/startups';
import { StartupForm } from '@/components/StartupForm';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { StartupPhase } from '@platform/shared';
import type { StartupStatus } from '@/lib/labels';

interface StartupRecord {
  id: string;
  name: string;
  description: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
  tags?: string;
  tenant: string;
  // Bolagsregister (1700000058)
  org_nr?: string;
  kommun?: string;
  bolagsform?: string;
  industri?: string;
  intagsdatum?: string;
  avslutsdatum?: string;
  bolag_status?: string;
  // Movexum Bolagslista (1700000061)
  idea_name?: string;
  case_type?: string;
  status_completion_pct?: number;
  company_registered_at?: string;
  contacted_at?: string;
  phone?: string;
  signed_incubator_agreement?: boolean;
  signed_incubator_agreement_at?: string;
  signed_nda?: boolean;
  signed_nda_at?: string;
  founder_gender?: string;
  potential_bc_case?: boolean;
  founder_identifies_as?: string;
  signed_bc_agreement?: boolean;
  signed_bc_agreement_at?: string;
  preliminary_exit?: string;
  is_deeptech?: boolean;
  meets_excellence_criteria?: boolean;
  inflow_source?: string;
  approved_state_aid_art22?: boolean;
  area?: string;
  signed_vinnova_incubation_approval?: boolean;
  signed_vinnova_incubation_approval_at?: string;
  approved_de_minimis?: boolean;
  sent_to?: string;
  register_notes?: string;
  is_regional?: boolean;
  signed_partner_agreement?: boolean;
  signed_partner_agreement_at?: string;
}

export default async function EditStartupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect(`/startups/${id}`);
  }

  let startup: StartupRecord;
  try {
    startup = await getOneForTenant<StartupRecord>('startups', id);
  } catch {
    notFound();
  }

  const boundAction = updateStartupAction.bind(null, id);
  const canDelete = hasRole(user.roles, ['admin', 'incubator_lead']);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/startups/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {startup.name}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera bolag</h1>
        <p className="mt-2 text-sm text-foreground-muted">{startup.name}</p>
      </header>

      <StartupForm
        action={boundAction}
        submitLabel="Spara ändringar"
        initial={{
          name: startup.name,
          description: startup.description,
          phase: startup.phase,
          status: startup.status,
          irl_level: startup.irl_level ?? null,
          next_step: startup.next_step,
          tags: startup.tags,
          org_nr: startup.org_nr,
          kommun: startup.kommun,
          bolagsform: startup.bolagsform,
          industri: startup.industri,
          intagsdatum: startup.intagsdatum,
          avslutsdatum: startup.avslutsdatum,
          bolag_status: startup.bolag_status,
          idea_name: startup.idea_name,
          case_type: startup.case_type,
          status_completion_pct: startup.status_completion_pct ?? null,
          company_registered_at: startup.company_registered_at,
          contacted_at: startup.contacted_at,
          phone: startup.phone,
          signed_incubator_agreement: startup.signed_incubator_agreement,
          signed_incubator_agreement_at: startup.signed_incubator_agreement_at,
          signed_nda: startup.signed_nda,
          signed_nda_at: startup.signed_nda_at,
          founder_gender: startup.founder_gender,
          potential_bc_case: startup.potential_bc_case,
          founder_identifies_as: startup.founder_identifies_as,
          signed_bc_agreement: startup.signed_bc_agreement,
          signed_bc_agreement_at: startup.signed_bc_agreement_at,
          preliminary_exit: startup.preliminary_exit,
          is_deeptech: startup.is_deeptech,
          meets_excellence_criteria: startup.meets_excellence_criteria,
          inflow_source: startup.inflow_source,
          approved_state_aid_art22: startup.approved_state_aid_art22,
          area: startup.area,
          signed_vinnova_incubation_approval: startup.signed_vinnova_incubation_approval,
          signed_vinnova_incubation_approval_at: startup.signed_vinnova_incubation_approval_at,
          approved_de_minimis: startup.approved_de_minimis,
          sent_to: startup.sent_to,
          register_notes: startup.register_notes,
          is_regional: startup.is_regional,
          signed_partner_agreement: startup.signed_partner_agreement,
          signed_partner_agreement_at: startup.signed_partner_agreement_at
        }}
      />

      {canDelete ? (
        <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <h2 className="text-base font-semibold text-foreground">Farozon</h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Raderar bolaget och kopplade poster. Detta går inte att ångra.
          </p>
          <div className="mt-4">
            <ConfirmDeleteButton
              action={deleteStartupFormAction}
              hiddenField={{ name: 'id', value: id }}
              label="Radera bolag"
              description={`Du raderar "${startup.name}". Alla anteckningar, milstolpar och aktiviteter försvinner.`}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
