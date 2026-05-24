import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { PageHead, Card, Chip, Icon } from '@/components/proto';
import { getModuleBySlug, listQuestionsForModule } from '@/lib/compass/store';
import { CompassChat } from '@/components/compass/CompassChat';
import { ModuleWizard } from '@/components/compass/ModuleWizard';
import { FLOW_TYPE_LABEL } from '@/lib/compass/types';

export const dynamic = 'force-dynamic';

export default async function ModulePage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  const pb = await getServerPb();
  const mod = await getModuleBySlug(pb, user.tenant, slug);
  if (!mod) notFound();

  const questions = mod.flow_type === 'chat' ? [] : await listQuestionsForModule(pb, mod.id);

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb={`Inflöde / ${mod.name}`}
        title={mod.name}
        subtitle={mod.description}
        actions={
          <>
            <Link href="/inflode" className="mx-btn">
              <Icon name="arrow" size={13} /> Översikt
            </Link>
            <Chip variant={mod.flow_type === 'chat' ? 'cyan' : 'default'} mono>
              {FLOW_TYPE_LABEL[mod.flow_type].toUpperCase()}
            </Chip>
          </>
        }
      />

      {mod.intro_message && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div className="mx-t-13" style={{ lineHeight: 1.5 }}>
            {mod.intro_message}
          </div>
        </Card>
      )}

      {mod.consent_note && (
        <Card style={{ padding: 14, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
          <div
            className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted"
            style={{ flexWrap: 'wrap' }}
          >
            <Icon name="shield" size={13} />
            <span>{mod.consent_note}</span>
          </div>
        </Card>
      )}

      {mod.flow_type === 'chat' ? (
        <div style={{ height: '70vh', minHeight: 520 }}>
          <CompassChat
            moduleSlug={mod.slug}
            initialAssistantMessage={mod.intro_message || undefined}
          />
        </div>
      ) : (
        <Card style={{ padding: 24 }}>
          <ModuleWizard
            moduleSlug={mod.slug}
            questions={questions}
            successMessage={mod.success_message}
            redirectUrl={mod.redirect_url}
          />
        </Card>
      )}

      <div
        className="mx-mt-6 mx-muted mx-t-xs mx-mono"
        style={{ textAlign: 'center', marginTop: 24 }}
      >
        Drivs av Mistral / Le Chat (EU-suveränt) · Genererat av AI – verifiera innan delning
      </div>
    </div>
  );
}
