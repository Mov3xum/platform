import { PageShell } from '@/components/PageShell';
import { ShareModule } from '@/components/compass/ShareModule';
import { Notice, Panel } from '@/components/talent/ui';
import { requireTalentStaff, talentTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/** Den publika studentsidans länk + QR (§ 54) — dela med lärosäten, på mässor och i nyhetsbrev. */
export default async function PublicTalentPage() {
  const { user } = await requireTalentStaff();
  const slug = user.tenantSlug ?? '';
  return (
    <PageShell title="Studenter & talang" tabs={talentTabs()}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Studentsidan">
          <p className="mb-3 text-sm text-foreground-muted">
            På studentsidan ser studenter alla publicerade behov, skapar en profil med hashtags (samma vokabulär som er kompetensprofil) och söker uppdrag. Inloggning sker med en
            e-postlänk — inget konto, inget lösenord.
          </p>
          {slug ? <ShareModule slug={slug} name="Studentsidan" publicSlug={slug} basePath="/s" noun="studentsidan" /> : <Notice kind="warning">Organisationen saknar slug — länken kan inte byggas.</Notice>}
        </Panel>
        <Panel title="Så fungerar det">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground-muted">
            <li>Bolaget lägger upp ett behov på Mitt bolag → Studenter &amp; talang (eller ni gör det åt dem) och skickar till granskning.</li>
            <li>Ni läser igenom texten under fliken Behov och publicerar. Bolaget kan aldrig publicera själv.</li>
            <li>Studenter registrerar sig på studentsidan och söker, eller blir föreslagna av er/bolaget utifrån den deterministiska rankningen.</li>
            <li>Bolaget ser en students namn och kontakt först när studenten sökt eller tackat ja. Dialog och match markeras av bolaget; utfallet (exjobb genomfört, anställd) registreras när det är klart.</li>
            <li>Matchade uppdrag syns på bolagskortet och räknas i nyckeltalen (Mål &amp; VP). Studentprofiler gallras efter ett år om studenten inte förlänger.</li>
          </ol>
          <p className="mt-3 text-xs text-foreground-subtle">Ingen AI rankar eller bedömer studenter (EU AI Act bilaga III). Rättslig grund för studenterna är samtycke; profiler och intressen når aldrig AI-chatten.</p>
        </Panel>
      </div>
    </PageShell>
  );
}
