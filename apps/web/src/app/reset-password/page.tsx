import { Logo } from '@/components/Logo';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata = {
  title: 'Återställ lösenord — Movexum'
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-3xl border border-default bg-surface p-8 shadow-xl shadow-movexum-svart/5">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo href="/" className="mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Återställ lösenord
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Ange din e-postadress så skickar vi en återställningslänk.
          </p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
