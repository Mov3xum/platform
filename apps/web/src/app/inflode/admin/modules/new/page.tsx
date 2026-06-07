import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, CardHead, Icon } from '@/components/proto';
import { createModuleAction } from '@/lib/actions/compass';

export const dynamic = 'force-dynamic';

const ERROR_TEXT: Record<string, string> = {
  slug_invalid: 'Slug kunde inte genereras. Ange ett tydligare namn eller slug.',
  public_slug_taken: 'Publik slug är upptagen. Prova en annan publik länk.',
  collections_missing:
    'Startupkompassen-kollektioner saknas i PocketBase. Kör migrationer/redeploy av PocketBase och försök igen.',
  forbidden: 'Du saknar behörighet att skapa moduler i den här tenanten.',
  create_failed: 'Kunde inte skapa modul. Försök igen eller kontrollera serverloggarna.'
};

export default async function NewModulePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/inflode');
  }
  const params = searchParams ? await searchParams : {};
  const errorKeyRaw = params.error;
  const errorKey = Array.isArray(errorKeyRaw) ? errorKeyRaw[0] : errorKeyRaw;
  const errorText = errorKey ? ERROR_TEXT[errorKey] || ERROR_TEXT.create_failed : null;

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Inflöde / Admin / Moduler / Ny"
        title="Skapa intag-modul"
        subtitle="Välj flow-typ och deploya på en egen URL. Du kan redigera frågor, prompt och brand efter du sparat."
        actions={
          <Link href="/inflode/admin/modules" className="mx-btn">
            <Icon name="arrow" size={13} /> Tillbaka
          </Link>
        }
      />

      <Card>
        <CardHead label="Ny modul" />
        {errorText && (
          <div
            role="alert"
            style={{
              margin: '12px 16px 0',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--mx-movexum-morkorange)',
              background: 'var(--mx-movexum-pastell-orange)',
              color: 'var(--mx-movexum-morkorange)'
            }}
            className="mx-t-13"
          >
            {errorText}
          </div>
        )}
        <form
          action={createModuleAction}
          style={{ padding: 16, display: 'grid', gap: 14 }}
        >
          <label className="mx-label">
            Namn *
            <input
              type="text"
              name="name"
              required
              className="mx-input"
              style={{ marginTop: 4 }}
              placeholder="t.ex. Hackathon-intag Hösten 2026"
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="mx-label">
              Slug (intern)
              <input
                type="text"
                name="slug"
                className="mx-input"
                style={{ marginTop: 4 }}
                placeholder="genereras från namnet om tomt"
              />
            </label>
            <label className="mx-label">
              Publik länk (slug)
              <input
                type="text"
                name="public_slug"
                className="mx-input"
                style={{ marginTop: 4, fontFamily: 'var(--mx-mono)' }}
                placeholder="globalt unik — /m/[slug]"
              />
            </label>
          </div>
          <span className="mx-mono mx-t-xs mx-muted">
            Modulen blir publikt svarbar på <code>/m/[publik-slug]</code> — dela via QR-kod efter
            att du sparat.
          </span>

          <label className="mx-label">
            Beskrivning
            <textarea
              name="description"
              className="mx-textarea"
              style={{ marginTop: 4, minHeight: 80 }}
              placeholder="Vad gör den här modulen? Vem är den för?"
            />
          </label>

          <div>
            <div className="mx-label" style={{ marginBottom: 8 }}>
              Flow-typ *
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8
              }}
            >
              <FlowOption
                value="chat"
                title="AI-chatt"
                desc="Naturligt samtal — AI ställer frågor och extraherar idé + kontakt"
                defaultChecked
              />
              <FlowOption
                value="wizard"
                title="Formulär"
                desc="Fasta frågor i ordning — bra för ansökningar"
              />
              <FlowOption
                value="quiz"
                title="Quiz"
                desc="Frågor med poängsättning — för screening"
              />
            </div>
          </div>

          <div className="mx-flex mx-items-c mx-gap-3" style={{ flexWrap: 'wrap' }}>
            <label
              className="mx-flex mx-items-c mx-gap-2 mx-t-13"
              style={{ cursor: 'pointer' }}
            >
              <input type="checkbox" name="is_active" defaultChecked />
              <span>
                <strong>Aktivera direkt</strong> · synlig för alla i tenanten
              </span>
            </label>
            <label
              className="mx-flex mx-items-c mx-gap-2 mx-t-13"
              style={{ cursor: 'pointer' }}
            >
              <input type="checkbox" name="public_url_enabled" />
              <span>
                <strong>Publik URL</strong> · markera om du delar länken externt
              </span>
            </label>
          </div>

          <div className="mx-flex mx-items-c mx-gap-2" style={{ justifyContent: 'flex-end' }}>
            <Link href="/inflode/admin/modules" className="mx-btn">
              Avbryt
            </Link>
            <button type="submit" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa modul
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function FlowOption({
  value,
  title,
  desc,
  defaultChecked
}: {
  value: string;
  title: string;
  desc: string;
  defaultChecked?: boolean;
}) {
  return (
    <label
      style={{
        padding: 12,
        borderRadius: 12,
        border: '1px solid var(--mx-line)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        background: 'var(--mx-paper)'
      }}
    >
      <input
        type="radio"
        name="flow_type"
        value={value}
        defaultChecked={defaultChecked}
        style={{ accentColor: '#002c40', marginTop: 4 }}
      />
      <div>
        <div className="mx-disp mx-fw-6 mx-t-13" style={{ marginBottom: 2 }}>
          {title}
        </div>
        <div className="mx-t-12 mx-muted" style={{ lineHeight: 1.4 }}>
          {desc}
        </div>
      </div>
    </label>
  );
}
