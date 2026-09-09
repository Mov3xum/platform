import { redirect } from 'next/navigation';

// Den globala modultogglingen är borttagen (CLAUDE.md § 36.3): moduler styrs
// per användare under Inställningar → Användare. Gammal länk skickas dit.
export default function ModulerRedirectPage() {
  redirect('/installningar/anvandare');
}
