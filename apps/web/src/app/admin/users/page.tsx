import { redirect } from 'next/navigation';

/** Legacy-route — användaradministrationen bor nu under Inställningar. */
export default function AdminUsersRedirect() {
  redirect('/installningar/anvandare');
}
