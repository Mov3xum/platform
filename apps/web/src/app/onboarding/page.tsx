import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'onboarding', user.disabledModules)) redirect('/dashboard');

  return (
    <section>
      <h1>Digital onboarding</h1>
      <p>Modul för företag att starta onboardingprocess, signera avtal och komma in i inkubatorn.</p>
      <div style={{ marginTop: 24, border: '1px solid #d1d5db', borderRadius: 12, padding: 20, background: '#ffffff' }}>
        <h2>Onboardingsteg</h2>
        <ul>
          <li>Registrera företagsinformation</li>
          <li>Ladda upp dokument</li>
          <li>Signera NDA och inkubatoravtal</li>
          <li>Starta första mötet med ansvarig coach</li>
        </ul>
      </div>
    </section>
  );
}
