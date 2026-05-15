'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type {
  IncubatorReport,
  ReportRecipient,
  ReportSection,
  ReportStatus,
  Role
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead'];

export type ReportActionState = {
  error?: string;
  reportId?: string;
};

const RECIPIENT_LABELS: Record<ReportRecipient, string> = {
  vinnova: 'Vinnova',
  tillvaxtverket: 'Tillväxtverket',
  region: 'Region',
  kommun: 'Kommun',
  other: 'Annan'
};

function defaultSections(recipient: ReportRecipient): ReportSection[] {
  if (recipient === 'tillvaxtverket') {
    return [
      { id: 'reg_spread', name: 'Regional spridning', state: 'pending', auto: true },
      { id: 'jobs', name: 'Jobb skapade', state: 'pending', auto: true },
      { id: 'sustain', name: 'Hållbarhetsbidrag', state: 'pending', auto: true },
      { id: 'final_note', name: 'Slutkommentar', state: 'pending', auto: false }
    ];
  }
  // default = Vinnova-style
  return [
    { id: 'portfolio', name: 'Bolagsportfölj', state: 'pending', auto: true },
    { id: 'activities', name: 'Aktiviteter & uppdrag', state: 'pending', auto: true },
    { id: 'admitted', name: 'Antagna under perioden', state: 'pending', auto: true },
    { id: 'analysis', name: 'Kvalitativ analys', state: 'pending', auto: false },
    { id: 'attachments', name: 'Bilagor', state: 'pending', auto: false }
  ];
}

function computeCompletion(sections: ReportSection[]): number {
  if (sections.length === 0) return 0;
  const score = sections.reduce((sum, s) => {
    if (s.state === 'done') return sum + 1;
    if (s.state === 'review') return sum + 0.7;
    if (s.state === 'auto') return sum + 0.6;
    return sum;
  }, 0);
  return Math.round((score / sections.length) * 100);
}

export async function createReportAction(input: {
  title: string;
  recipient: ReportRecipient;
  period_label: string;
  period_start: string;
  period_end: string;
  due_date?: string;
  accent?: string;
}): Promise<ReportActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };

  const title = input.title.trim();
  if (!title) return { error: 'Titel krävs.' };

  const pb = await getServerPb();
  const sections = defaultSections(input.recipient);

  try {
    const rec = await pb.collection(PB_COLLECTIONS.reports).create({
      tenant: user.tenant,
      title,
      recipient: input.recipient,
      recipient_label: RECIPIENT_LABELS[input.recipient] || input.recipient,
      status: 'draft_ai' satisfies ReportStatus,
      period_label: input.period_label,
      period_start: input.period_start,
      period_end: input.period_end,
      due_date: input.due_date || null,
      completion: 0,
      sections_json: sections,
      preview_md: '',
      accent: input.accent || 'brown',
      created_by: user.id
    });
    revalidatePath('/rapporter');
    return { reportId: String(rec.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa rapport.' };
  }
}

async function loadReportWithAccess(reportId: string) {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' as const };
  const pb = await getServerPb();
  let report: IncubatorReport;
  try {
    report = await pb.collection(PB_COLLECTIONS.reports).getOne<IncubatorReport>(reportId);
  } catch {
    return { error: 'Rapporten hittades inte.' as const };
  }
  if (report.tenant !== user.tenant) return { error: 'Åtkomst nekad.' as const };
  return { user, pb, report };
}

export async function updateSectionAction(
  reportId: string,
  sectionId: string,
  partial: Partial<ReportSection>
): Promise<ReportActionState> {
  const loaded = await loadReportWithAccess(reportId);
  if ('error' in loaded) return { error: loaded.error };
  const { pb, report } = loaded;

  const sections = Array.isArray(report.sections_json) ? [...report.sections_json] : [];
  const idx = sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) return { error: 'Sektionen hittades inte.' };
  sections[idx] = { ...sections[idx], ...partial, id: sections[idx].id };

  try {
    await pb.collection(PB_COLLECTIONS.reports).update(reportId, {
      sections_json: sections,
      completion: computeCompletion(sections)
    });
    revalidatePath('/rapporter');
    revalidatePath(`/rapporter/${reportId}`);
    return { reportId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera sektion.' };
  }
}

export async function generateAiDraftAction(reportId: string): Promise<ReportActionState> {
  const loaded = await loadReportWithAccess(reportId);
  if ('error' in loaded) return { error: loaded.error };
  const { pb, report } = loaded;

  // Stubbed AI generation — produces a placeholder preview.
  // A full Mistral-integration kan kopplas in via lib/ai/mistral.ts senare.
  const previewMd = [
    `Under perioden ${report.period_label} har Movexum drivit ett aktivt program ` +
      `riktat mot ${report.recipient_label}. Texten nedan är ett AI-utkast som ` +
      `auto-genererats från portföljen — granska och justera innan publicering.`,
    '',
    `Sammanfattning: portföljen omfattar aktiva bolag i för-inkubator, inkubator och scale-fas. ` +
      `Antagningar under perioden loggas via Idag-vyn och Sprint X-mätningarna.`,
    '',
    `[Auto-genererat av Rapportskrivaren · ${new Date().toLocaleDateString('sv-SE')}]`
  ].join('\n');

  const sections = Array.isArray(report.sections_json) ? [...report.sections_json] : [];
  const updatedSections = sections.map((s) =>
    s.auto && s.state === 'pending' ? { ...s, state: 'auto' as const } : s
  );

  try {
    await pb.collection(PB_COLLECTIONS.reports).update(reportId, {
      preview_md: previewMd,
      sections_json: updatedSections,
      completion: computeCompletion(updatedSections),
      status: 'draft_ai' satisfies ReportStatus
    });
    revalidatePath('/rapporter');
    revalidatePath(`/rapporter/${reportId}`);
    return { reportId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte regenerera utkast.' };
  }
}

export async function sendReportAction(reportId: string): Promise<ReportActionState> {
  const loaded = await loadReportWithAccess(reportId);
  if ('error' in loaded) return { error: loaded.error };
  const { pb, report } = loaded;

  try {
    await pb.collection(PB_COLLECTIONS.reports).update(reportId, {
      status: 'sent' satisfies ReportStatus,
      completion: 100
    });
    revalidatePath('/rapporter');
    revalidatePath(`/rapporter/${reportId}`);
    return { reportId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skicka rapport.' };
  }
  // unreachable: redirect on success — let caller decide.
}

export async function createReportAndRedirectAction(formData: FormData): Promise<void> {
  const recipient = (String(formData.get('recipient') || 'vinnova') as ReportRecipient);
  const result = await createReportAction({
    title: String(formData.get('title') || ''),
    recipient,
    period_label: String(formData.get('period_label') || ''),
    period_start: String(formData.get('period_start') || new Date().toISOString().slice(0, 10)),
    period_end: String(formData.get('period_end') || new Date().toISOString().slice(0, 10)),
    accent: recipient === 'tillvaxtverket' ? 'copper' : recipient === 'region' ? 'green' : 'brown'
  });
  if (result.reportId) redirect(`/rapporter/${result.reportId}`);
}
