import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, CardHead, Icon } from '@/components/proto';
import {
  getLeadAnalytics,
  getModuleBySlug,
  listModules,
  listQuestionsForModule
} from '@/lib/compass/store';
import { FLOW_TYPE_LABEL } from '@/lib/compass/types';
import { deleteModuleAction } from '@/lib/actions/compass';
import { ShareModule } from '@/components/compass/ShareModule';
import { ConfirmSubmitButton } from '@/components/ConfirmSubmitButton';
import { QuestionsManager } from '@/components/compass/QuestionsManager';
import { ModuleSettingsForm } from '@/components/compass/ModuleSettingsForm';
import { moduleHeroImageUrl } from '@/lib/compass/media';

export const dynamic = 'force-dynamic';

const MODEL_OPTIONS = [
  { value: 'mistral-large-latest', label: 'Mistral Large (rikast)' },
  { value: 'mistral-medium-latest', label: 'Mistral Medium' },
  { value: 'mistral-small-latest', label: 'Mistral Small (snabb/billig)' }
];

export default async function EditModulePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/inflode');
  }
  const pb = await getServerPb();
  const mod = await getModuleBySlug(pb, user.tenant, slug);
  if (!mod) notFound();

  const [questions, analytics, allModules] = await Promise.all([
    listQuestionsForModule(pb, mod.id),
    getLeadAnalytics(pb, user.tenant, 365),
    listModules(pb, user.tenant)
  ]);
  // Publika flöden lagrar landing_module som modulens PUBLIKA slug, interna
  // förhandsgranskningar som den interna — slå ihop bägge så statistiken
  // stämmer (tidigare visades 0 leads när public_slug skilde sig från slug).
  const metricRows = analytics.byModule.filter(
    (m) => m.slug === mod.slug || (mod.public_slug && m.slug === mod.public_slug)
  );
  const metrics =
    metricRows.length > 0
      ? metricRows.reduce(
          (acc, m) => ({
            total: acc.total + m.total,
            accepted: acc.accepted + m.accepted,
            converted: acc.converted + m.converted
          }),
          { total: 0, accepted: 0, converted: 0 }
        )
      : undefined;
  const heroImageUrl = moduleHeroImageUrl(mod);
  // Övriga moduler i tenanten — kandidater för "nästa modul"-kedjan (ej sig själv).
  const otherModules = allModules
    .filter((m) => m.id !== mod.id)
    .map((m) => ({
      id: m.id,
      name: m.name,
      public_slug: m.public_slug,
      is_active: m.is_active,
      public_url_enabled: m.public_url_enabled
    }));

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Startupkompassen / Admin / Moduler / ${mod.name}`}
        title={mod.name}
        subtitle={`${mod.public_slug ? `/m/${mod.public_slug}` : '(ingen publik länk)'} · ${FLOW_TYPE_LABEL[mod.flow_type]} · ${mod.is_active ? 'Aktiv' : 'Utkast'}`}
        actions={
          <>
            <Link href="/inflode/admin/modules" className="mx-btn">
              <Icon name="arrow" size={13} /> Tillbaka
            </Link>
            <Link href={`/inflode/m/${mod.slug}`} className="mx-btn">
              <Icon name="spark" size={13} /> Förhandsgranska
            </Link>
          </>
        }
      />

      {metrics && (
        <Card style={{ padding: 14, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
          <div className="mx-flex mx-items-c mx-gap-3 mx-t-13 mx-wrap">
            <Stat label="Leads" value={metrics.total} />
            <Stat label="Accepterade" value={metrics.accepted} />
            <Stat label="Konverterade bolag" value={metrics.converted} />
            <span className="mx-grow" />
            <Link
              href={`/inflode/leads?landing=${encodeURIComponent(mod.public_slug || mod.slug)}`}
              className="mx-btn mx-sm mx-ghost"
            >
              Visa leads från modulen →
            </Link>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {/* Inställningar — stegindelat formulär */}
          <Card>
            <CardHead label="Inställningar" right={<span className="mx-mono mx-t-xs mx-muted">4 steg</span>} />
            <ModuleSettingsForm
              module={mod}
              heroImageUrl={heroImageUrl}
              modelOptions={MODEL_OPTIONS}
              otherModules={otherModules}
            />
          </Card>

          {/* Frågor */}
          <Card>
            <CardHead
              label="Frågor"
              right={
                <span className="mx-mono mx-t-xs mx-muted">
                  {questions.length} {questions.length === 1 ? 'fråga' : 'frågor'}
                </span>
              }
            />
            <div style={{ padding: 16 }}>
              <QuestionsManager
                moduleId={mod.id}
                moduleSlug={mod.slug}
                flowType={mod.flow_type}
                initialQuestions={questions}
                resultBuckets={mod.result_buckets ?? []}
              />
            </div>
          </Card>
        </div>

        {/* Höger: dela, exempel-URL, ta bort */}
        <div style={{ display: 'grid', gap: 16 }}>
          <ShareModule slug={mod.slug} name={mod.name} publicSlug={mod.public_slug} />

          <Card>
            <CardHead label="Kampanj-länk-byggare" />
            <div style={{ padding: 16 }}>
              <div className="mx-muted mx-t-12" style={{ marginBottom: 8 }}>
                Lägg på UTM-parametrar för att mäta var leads kommer ifrån:
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--mx-paper-2)',
                  border: '1px solid var(--mx-line-soft)',
                  fontFamily: 'var(--mx-mono)',
                  fontSize: 11,
                  lineHeight: 1.5,
                  wordBreak: 'break-all'
                }}
              >
                /m/{mod.public_slug || '[ange-publik-slug]'}?utm_source=<em>linkedin</em>&amp;utm_medium=<em>post</em>&amp;utm_campaign=<em>varomgang26</em>
              </div>
              <div className="mx-t-12 mx-muted" style={{ marginTop: 10 }}>
                Mätningen syns på översikten och per modul. Stöder:{' '}
                <code className="mx-mono">utm_source</code>,{' '}
                <code className="mx-mono">utm_medium</code>,{' '}
                <code className="mx-mono">utm_campaign</code>,{' '}
                <code className="mx-mono">utm_term</code>,{' '}
                <code className="mx-mono">utm_content</code>.
              </div>
            </div>
          </Card>

          <Card>
            <CardHead label="Farlig zon" />
            <form action={deleteModuleAction} style={{ padding: 16 }}>
              <input type="hidden" name="id" value={mod.id} />
              <ConfirmSubmitButton
                confirmText={`Radera modulen "${mod.name}"? Alla frågor raderas också (cascade) och den publika länken slutar fungera — detta kan inte ångras. Befintliga leads bevaras.`}
                className="mx-btn"
                style={{ width: '100%', color: '#4b2718', borderColor: '#d67e47' }}
              >
                <Icon name="trash" size={13} /> Radera modul
              </ConfirmSubmitButton>
              <div
                className="mx-mono mx-t-xs mx-muted"
                style={{ marginTop: 8, textAlign: 'center' }}
              >
                Frågor raderas också (cascade). Befintliga leads bevaras.
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">{label}</div>
      <div className="mx-disp mx-fw-6" style={{ fontSize: 20 }}>
        {value}
      </div>
    </div>
  );
}
