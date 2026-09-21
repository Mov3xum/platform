import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, Icon } from '@/components/proto';
import { createModuleAction } from '@/lib/actions/compass';

export const dynamic = 'force-dynamic';

const ERROR_TEXT: Record<string, string> = {
  slug_invalid: 'Länken kunde inte skapas från namnet. Prova ett tydligare namn.',
  public_slug_taken: 'Länken är upptagen. Prova ett annat namn.',
  collections_missing:
    'Startupkompassen-kollektioner saknas i PocketBase. Kör migrationer/redeploy av PocketBase och försök igen.',
  forbidden: 'Du saknar behörighet att skapa moduler.',
  create_failed: 'Kunde inte skapa modulen. Försök igen.'
};

// Avsiktligt minimal: namn + typ. Allt annat (landningssida, frågor, målgrupp,
// kedja, publicering) byggs i den stegvisa editorn efter att modulen skapats.
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
        crumb="Startupkompassen / Moduler / Ny"
        title="Skapa modul"
        subtitle="Ge modulen ett namn och välj typ. Resten bygger du steg för steg efteråt."
        actions={
          <Link href="/inflode/admin/modules" className="mx-btn">
            <Icon name="arrow" size={13} /> Tillbaka
          </Link>
        }
      />

      <Card>
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
          {/* Länkar genereras från namnet; modulen aktiveras direkt men blir
              publik först när det slås på i editorns sista steg. */}
          <input type="hidden" name="is_active" value="on" />

          <label className="mx-label">
            Namn
            <input
              type="text"
              name="name"
              required
              className="mx-input"
              style={{ marginTop: 4 }}
              placeholder="t.ex. Är du redo för inkubator?"
            />
          </label>

          <div>
            <div className="mx-label" style={{ marginBottom: 8 }}>
              Typ av modul
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8
              }}
            >
              <FlowOption
                value="wizard"
                title="Formulär"
                desc="Fasta frågor i ordning"
                defaultChecked
              />
              <FlowOption
                value="quiz"
                title="Quiz"
                desc="Frågor med poäng och resultat"
              />
              <FlowOption
                value="chat"
                title="AI-chatt"
                desc="Ett samtal som ställer frågorna"
              />
            </div>
          </div>

          <div className="mx-flex mx-items-c mx-gap-2" style={{ justifyContent: 'flex-end' }}>
            <Link href="/inflode/admin/modules" className="mx-btn">
              Avbryt
            </Link>
            <button type="submit" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa och bygg vidare
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
