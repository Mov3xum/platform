import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { PageHead, Card, Chip, Icon } from '@/components/proto';
import { getModuleBySlug, listQuestionsForModule } from '@/lib/compass/store';
import { CompassChat } from '@/components/compass/CompassChat';
import { ModuleWizard } from '@/components/compass/ModuleWizard';
import { ModuleQuiz } from '@/components/compass/ModuleQuiz';
import { FLOW_TYPE_LABEL } from '@/lib/compass/types';
import {
  applyCompassModuleTranslation,
  applyCompassQuestionTranslation,
  contactSectionForModule,
  parseCompassLocale,
  storedEnglishTexts
} from '@platform/shared';
import { CompassLocaleProvider } from '@/components/compass/locale';
import { ensureEnglishTexts } from '@/lib/compass/auto-translate';
import { getSuperuserPb } from '@/lib/integrations/credentials';

export const dynamic = 'force-dynamic';

export default async function ModulePage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const pb = await getServerPb();
  const swedishModule = await getModuleBySlug(pb, user.tenant, slug);
  if (!swedishModule) notFound();

  // Förhandsgranskning på engelska (§ 23.13, `?lang=en`): samma automatiska
  // översättning som den publika sidan — och den sparas, så första
  // besökaren slipper vänta. Sparandet kräver superusern (roll + tenant är
  // verifierade ovan); utan den visas det som redan finns översatt.
  const locale = parseCompassLocale(sp.lang);
  const allQuestions = await listQuestionsForModule(pb, swedishModule.id);
  let texts: Record<string, string> | null = null;
  if (locale === 'en') {
    const su = await getSuperuserPb();
    texts = su.ok
      ? await ensureEnglishTexts(su.pb, swedishModule, allQuestions, user.tenant)
      : storedEnglishTexts(swedishModule.translations, 'en');
  }
  const mod = texts ? applyCompassModuleTranslation(swedishModule, texts) : swedishModule;
  // Chatten ställer frågorna själv — förhandsgranskningen renderar dem inte.
  const swedishQuestions = swedishModule.flow_type === 'chat' ? [] : allQuestions;
  const questions = texts ? applyCompassQuestionTranslation(swedishQuestions, texts) : swedishQuestions;

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
            <Link
              href={locale === 'en' ? `/inflode/m/${encodeURIComponent(slug)}` : `/inflode/m/${encodeURIComponent(slug)}?lang=en`}
              className="mx-btn"
            >
              <Icon name="globe" size={13} /> {locale === 'en' ? 'Svenska' : 'English'}
            </Link>
            <Chip variant={mod.flow_type === 'chat' ? 'cyan' : 'default'} mono>
              {FLOW_TYPE_LABEL[mod.flow_type].toUpperCase()}
            </Chip>
          </>
        }
      />

      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted" style={{ flexWrap: 'wrap' }}>
          <Icon name="shield" size={13} />
          <span>
            Förhandsgranskning — leads härifrån markeras som{' '}
            <strong>Förhandsgranskning</strong> och räknas inte i statistik eller export.
            Den publika sidan ligger på <code className="mx-mono">/m/[publik-slug]</code>.
          </span>
        </div>
      </Card>

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

      <CompassLocaleProvider locale={locale}>
      {mod.flow_type === 'chat' ? (
        <div style={{ height: '70vh', minHeight: 520 }}>
          <CompassChat
            moduleSlug={mod.slug}
            initialAssistantMessage={mod.intro_message || undefined}
            title={mod.chat_persona || mod.name}
            avatarInitial={(mod.name || 'M').slice(0, 1).toUpperCase()}
          />
        </div>
      ) : mod.flow_type === 'quiz' ? (
        <Card style={{ padding: 24 }}>
          <ModuleQuiz
            moduleSlug={mod.slug}
            questions={questions}
            contactSection={contactSectionForModule(mod)}
            successMessage={mod.success_message}
          />
        </Card>
      ) : (
        <Card style={{ padding: 24 }}>
          <ModuleWizard
            moduleSlug={mod.slug}
            questions={questions}
            contactSection={contactSectionForModule(mod)}
            successMessage={mod.success_message}
            redirectUrl={mod.redirect_url}
          />
        </Card>
      )}
      </CompassLocaleProvider>

      <div
        className="mx-mt-6 mx-muted mx-t-xs mx-mono"
        style={{ textAlign: 'center', marginTop: 24 }}
      >
        Drivs av Mistral / Le Chat (EU-suveränt) · Genererat av AI – verifiera innan delning
      </div>
    </div>
  );
}
