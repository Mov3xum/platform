'use client';

import { useActionState } from 'react';
import { ALL_PHASES } from '@platform/shared';
import { founderGenderLabels, phaseLabels, statusLabels } from '@/lib/labels';
import type { StartupFormState } from '@/lib/actions/startups';

const initialState: StartupFormState = {};

export interface StartupFormInitial {
  name?: string;
  description?: string;
  phase?: string;
  status?: string;
  irl_level?: number | null;
  next_step?: string;
  tags?: string;
  // Bolagsregister (befintliga fält 1700000058)
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
  status_completion_pct?: number | null;
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

export interface StartupFormProps {
  action: (prev: StartupFormState, formData: FormData) => Promise<StartupFormState>;
  initial?: StartupFormInitial;
  submitLabel: string;
}

const inputClass =
  'block w-full rounded-xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

const checkboxClass =
  'h-4 w-4 rounded border-default text-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

export function StartupForm({ action, initial = {}, submitLabel }: StartupFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const safeState = state ?? initialState;
  const fe = safeState.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-8">
      <Section title="Grundinfo">
        <Field label="Namn" error={fe.name} required>
          <input name="name" defaultValue={initial.name ?? ''} className={inputClass} required />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Idénamn">
            <input name="idea_name" defaultValue={initial.idea_name ?? ''} className={inputClass} />
          </Field>
          <Field label="Typ av case">
            <input name="case_type" defaultValue={initial.case_type ?? ''} className={inputClass} />
          </Field>
        </div>

        <Field label="Beskrivning">
          <textarea
            name="description"
            defaultValue={initial.description ?? ''}
            rows={4}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Bolagsfas" error={fe.phase} required>
            <select
              name="phase"
              defaultValue={initial.phase ?? 'inflode'}
              className={inputClass}
              required
            >
              {ALL_PHASES.map((p) => (
                <option key={p} value={p}>
                  {phaseLabels[p]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status" error={fe.status} required>
            <select
              name="status"
              defaultValue={initial.status ?? 'active'}
              className={inputClass}
              required
            >
              {(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="IRL-nivå (1–9)" error={fe.irl_level}>
            <input
              type="number"
              name="irl_level"
              min={1}
              max={9}
              defaultValue={initial.irl_level ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="Status avklarad %" error={fe.status_completion_pct}>
            <input
              type="number"
              name="status_completion_pct"
              min={0}
              max={100}
              defaultValue={initial.status_completion_pct ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="Område">
            <input name="area" defaultValue={initial.area ?? ''} className={inputClass} />
          </Field>
        </div>

        <Field label="Nästa steg">
          <input name="next_step" defaultValue={initial.next_step ?? ''} className={inputClass} />
        </Field>

        <Field label="Taggar (kommaseparerade)">
          <input name="tags" defaultValue={initial.tags ?? ''} className={inputClass} />
        </Field>
      </Section>

      <Section title="Bolagsregister">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Organisationsnummer (XXXXXX-XXXX)">
            <input name="org_nr" defaultValue={initial.org_nr ?? ''} className={inputClass} />
          </Field>
          <Field label="Ort / kommun">
            <input name="kommun" defaultValue={initial.kommun ?? ''} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Bolagsform">
            <select
              name="bolagsform"
              defaultValue={initial.bolagsform ?? ''}
              className={inputClass}
            >
              <option value="">— välj —</option>
              <option value="aktiebolag">Aktiebolag</option>
              <option value="handelsbolag">Handelsbolag</option>
              <option value="kommanditbolag">Kommanditbolag</option>
              <option value="enskild_firma">Enskild firma</option>
              <option value="ekonomisk_forening">Ekonomisk förening</option>
              <option value="ideell_forening">Ideell förening</option>
              <option value="annat">Annat</option>
            </select>
          </Field>
          <Field label="Industri">
            <input name="industri" defaultValue={initial.industri ?? ''} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Företag registrerat" error={fe.company_registered_at}>
            <input
              type="date"
              name="company_registered_at"
              defaultValue={initial.company_registered_at ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="Intagsdatum (inkubator)">
            <input
              type="date"
              name="intagsdatum"
              defaultValue={initial.intagsdatum ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="Avslutsdatum (inkubator)">
            <input
              type="date"
              name="avslutsdatum"
              defaultValue={initial.avslutsdatum ?? ''}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Bolagets operationella status">
            <select
              name="bolag_status"
              defaultValue={initial.bolag_status ?? ''}
              className={inputClass}
            >
              <option value="">— välj —</option>
              <option value="aktiv">Aktiv</option>
              <option value="vilande">Vilande</option>
              <option value="konkurs">Konkurs</option>
              <option value="likvidering">Likvidering</option>
              <option value="avregistrerat">Avregistrerat</option>
            </select>
          </Field>
          <Checkbox name="is_regional" label="Regionalt bolag" defaultChecked={!!initial.is_regional} />
        </div>
      </Section>

      <Section title="Kontakt">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Kontaktad" error={fe.contacted_at}>
            <input
              type="date"
              name="contacted_at"
              defaultValue={initial.contacted_at ?? ''}
              className={inputClass}
            />
          </Field>
          <Field
            label="Telefonnummer"
            error={fe.phone}
            help="Lagras tenant-isolerat. Visas ej för AI-agenter."
          >
            <input
              type="tel"
              name="phone"
              defaultValue={initial.phone ?? ''}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Inflöde startup från">
            <input
              name="inflow_source"
              defaultValue={initial.inflow_source ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="Skickad till">
            <input name="sent_to" defaultValue={initial.sent_to ?? ''} className={inputClass} />
          </Field>
        </div>
      </Section>

      <Section title="Kunskap — avtal &amp; godkännanden">
        <SignedPair
          boolName="signed_incubator_agreement"
          dateName="signed_incubator_agreement_at"
          label="Inkubatoravtal"
          defaultBool={!!initial.signed_incubator_agreement}
          defaultDate={initial.signed_incubator_agreement_at ?? ''}
        />
        <SignedPair
          boolName="signed_nda"
          dateName="signed_nda_at"
          label="Sekretessavtal (NDA)"
          defaultBool={!!initial.signed_nda}
          defaultDate={initial.signed_nda_at ?? ''}
        />
        <SignedPair
          boolName="signed_bc_agreement"
          dateName="signed_bc_agreement_at"
          label="Boost Chamber-avtal"
          defaultBool={!!initial.signed_bc_agreement}
          defaultDate={initial.signed_bc_agreement_at ?? ''}
        />
        <SignedPair
          boolName="signed_vinnova_incubation_approval"
          dateName="signed_vinnova_incubation_approval_at"
          label="Godkännande av inkubationsstöd från Vinnova"
          defaultBool={!!initial.signed_vinnova_incubation_approval}
          defaultDate={initial.signed_vinnova_incubation_approval_at ?? ''}
        />
        <SignedPair
          boolName="signed_partner_agreement"
          dateName="signed_partner_agreement_at"
          label="Partneravtal"
          defaultBool={!!initial.signed_partner_agreement}
          defaultDate={initial.signed_partner_agreement_at ?? ''}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox
            name="approved_state_aid_art22"
            label="Godkänd för statsstöd artikel 22"
            defaultChecked={!!initial.approved_state_aid_art22}
          />
          <Checkbox
            name="approved_de_minimis"
            label="Godkänd för de minimis"
            defaultChecked={!!initial.approved_de_minimis}
          />
        </div>
      </Section>

      <Section title="Profil &amp; bedömning">
        <div className="grid gap-3 sm:grid-cols-3">
          <Checkbox
            name="is_deeptech"
            label="Deeptech"
            defaultChecked={!!initial.is_deeptech}
          />
          <Checkbox
            name="meets_excellence_criteria"
            label="Uppfyller krav Excellens"
            defaultChecked={!!initial.meets_excellence_criteria}
          />
          <Checkbox
            name="potential_bc_case"
            label="Potentiellt BC-case"
            defaultChecked={!!initial.potential_bc_case}
          />
        </div>

        <Field label="Preliminär exit">
          <input
            name="preliminary_exit"
            defaultValue={initial.preliminary_exit ?? ''}
            className={inputClass}
          />
        </Field>

        <div className="rounded-xl border border-default bg-canvas-subtle/60 p-4 text-xs text-foreground-muted">
          <p className="mb-3 font-medium text-foreground-muted">
            Särskild kategori (GDPR art. 9) — frivilligt. Lagras endast för
            Vinnova-statistik och visas ALDRIG för AI-agenter.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kön på grundare" error={fe.founder_gender}>
              <select
                name="founder_gender"
                defaultValue={initial.founder_gender ?? ''}
                className={inputClass}
              >
                <option value="">— uppger ej —</option>
                {(Object.keys(founderGenderLabels) as Array<keyof typeof founderGenderLabels>).map(
                  (k) => (
                    <option key={k} value={k}>
                      {founderGenderLabels[k]}
                    </option>
                  )
                )}
              </select>
            </Field>
            <Field label="Grundaren identifierar sig som">
              <input
                name="founder_identifies_as"
                defaultValue={initial.founder_identifies_as ?? ''}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Noteringar">
        <Field label="Fria noteringar (visas i AI-prompt)">
          <textarea
            name="register_notes"
            defaultValue={initial.register_notes ?? ''}
            rows={5}
            className={inputClass}
          />
        </Field>
      </Section>

      {safeState.error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-4 py-2.5 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {safeState.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
        >
          {pending ? 'Sparar…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-5 rounded-2xl border border-default bg-surface p-5">
      <legend className="px-2 text-sm font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  error,
  required,
  help,
  children
}: {
  label: string;
  error?: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-foreground-muted">
        {label}
        {required ? <span className="ml-1 text-movexum-orange">*</span> : null}
      </span>
      {children}
      {help ? <span className="mt-1 block text-xs text-foreground-subtle">{help}</span> : null}
      {error ? (
        <span className="mt-1 block text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function Checkbox({
  name,
  label,
  defaultChecked
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-start gap-2 text-sm text-foreground-muted">
      <input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} className={checkboxClass} />
      <span>{label}</span>
    </label>
  );
}

function SignedPair({
  boolName,
  dateName,
  label,
  defaultBool,
  defaultDate
}: {
  boolName: string;
  dateName: string;
  label: string;
  defaultBool: boolean;
  defaultDate: string;
}) {
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto] sm:gap-5">
      <Checkbox name={boolName} label={label} defaultChecked={defaultBool} />
      <label className="text-xs text-foreground-subtle">
        <span className="mb-1 block">Datum</span>
        <input
          type="date"
          name={dateName}
          defaultValue={defaultDate}
          className={inputClass}
        />
      </label>
    </div>
  );
}
