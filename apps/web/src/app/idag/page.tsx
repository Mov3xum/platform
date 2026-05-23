import { redirect } from 'next/navigation';

// Bakåtkompatibel redirect: /idag bytte namn till /chatt (maj 2026).
// Behålls så gamla länkar och bokmärken fortsätter fungera.
export default function IdagRedirect() {
  redirect('/chatt');
}
