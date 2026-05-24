import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, CardHead, Icon } from '@/components/proto';
import { createModuleAction } from '@/lib/actions/compass';

export const dynamic = 'force-dynamic';

export default async function NewModulePage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/inflode');
  }

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

          <label className="mx-label">
            Slug (URL)
            <input
              type="text"
              name="slug"
              className="mx-input"
              style={{ marginTop: 4 }}
              placeholder="genereras från namnet om tomt"
            />
            <span className="mx-mono mx-t-xs mx-muted">
              Modulen blir tillgänglig på <code>/inflode/m/[slug]</code>
            </span>
          </label>

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
