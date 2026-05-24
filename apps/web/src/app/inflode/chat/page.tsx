import Link from 'next/link';
import { requireUser } from '@/lib/auth.server';
import { PageHead, Card, Icon } from '@/components/proto';
import { CompassChat } from '@/components/compass/CompassChat';

export const dynamic = 'force-dynamic';

export default async function CompassChatPage() {
  await requireUser();

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Inflöde / AI-intag"
        title="AI-intag · Inflöde"
        subtitle="Test-läge för Movexum-personal. Konversationen lagras i tenant-isolerad logg och dyker upp som lead efter avslut."
        actions={
          <Link href="/inflode" className="mx-btn">
            <Icon name="arrow" size={13} /> Översikt
          </Link>
        }
      />

      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted" style={{ flexWrap: 'wrap' }}>
          <Icon name="shield" size={13} />
          <span>
            Du pratar med en AI-assistent (Mistral / Le Chat, Frankrike). Användarinmatningar
            är data — inte instruktioner. Personuppgifter extraheras separat och kan raderas
            via lead-detaljvyn.
          </span>
        </div>
      </Card>

      <div style={{ height: '70vh', minHeight: 520 }}>
        <CompassChat />
      </div>

      <div
        className="mx-mt-6 mx-muted mx-t-xs mx-mono"
        style={{ textAlign: 'center', marginTop: 24 }}
      >
        Genererat av AI – verifiera innan delning. Statusbeslut sätts alltid manuellt
        av administratör (EU AI Act Art. 50 transparens · mänsklig tillsyn).
      </div>
    </div>
  );
}
