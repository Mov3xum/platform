import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageHead, Card, CardHead, Icon } from '@/components/proto';
import { listLeadSources } from '@/lib/compass/store';
import { createManualLeadAction } from '@/lib/actions/compass';

export const dynamic = 'force-dynamic';

export default async function NewLeadPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/inflode');
  }
  const pb = await getServerPb();
  const sources = await listLeadSources(pb);

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Inflöde / Leads / Nytt"
        title="Nytt lead manuellt"
        subtitle="Lägg in en idébärare som du fångat upp via samtal, event eller hänvisning."
        actions={
          <Link href="/inflode/leads" className="mx-btn">
            <Icon name="arrow" size={13} /> Tillbaka
          </Link>
        }
      />

      <Card>
        <CardHead label="Idébärare" />
        <form
          action={createManualLeadAction}
          style={{ padding: 16, display: 'grid', gap: 12 }}
        >
          <label className="mx-label">
            Namn *
            <input
              type="text"
              name="name"
              required
              className="mx-input"
              style={{ marginTop: 4 }}
              autoComplete="name"
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="mx-label">
              E-post
              <input
                type="email"
                name="email"
                className="mx-input"
                style={{ marginTop: 4 }}
                autoComplete="email"
              />
            </label>
            <label className="mx-label">
              Telefon
              <input
                type="tel"
                name="phone"
                className="mx-input"
                style={{ marginTop: 4 }}
                autoComplete="tel"
              />
            </label>
          </div>
          <label className="mx-label">
            Organisation
            <input
              type="text"
              name="organization"
              className="mx-input"
              style={{ marginTop: 4 }}
            />
          </label>
          <label className="mx-label">
            Idé-sammanfattning
            <textarea
              name="idea_summary"
              className="mx-textarea"
              style={{ marginTop: 4, minHeight: 120 }}
              placeholder="Vad är idén? Vilket problem löser den? För vem?"
            />
          </label>
          <label className="mx-label">
            Källa
            <select name="source_key" className="mx-input" defaultValue="call" style={{ marginTop: 4 }}>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div
            className="mx-flex mx-items-c mx-gap-2"
            style={{ justifyContent: 'flex-end', marginTop: 8 }}
          >
            <Link href="/inflode/leads" className="mx-btn">
              Avbryt
            </Link>
            <button type="submit" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa lead
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
