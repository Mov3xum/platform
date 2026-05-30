import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { verifyEmailAction } from '@/lib/actions/auth';

export const metadata = {
  title: 'Verifiera e-post — Movexum'
};

export default async function VerifyEmailPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <PageShell>
        <StatusBox
          variant="error"
          title="Ogiltig länk"
          message="Verifieringslänken saknas eller är felaktig. Kontrollera att du kopierade hela länken från mailet."
        />
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
        >
          Till inloggning
        </Link>
      </PageShell>
    );
  }

  const result = await verifyEmailAction(token);

  if (result.success) {
    return (
      <PageShell>
        <StatusBox
          variant="success"
          title="E-post verifierad!"
          message="Ditt konto är nu aktiverat. Du kan logga in med dina uppgifter."
        />
        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
        >
          Logga in
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <StatusBox
        variant="error"
        title="Verifiering misslyckades"
        message={result.error ?? 'Okänt fel. Försök igen eller kontakta administratören.'}
      />
      <Link
        href="/login"
        className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
      >
        Till inloggning
      </Link>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-canvas px-4 py-6 sm:px-6">
      <div className="w-full max-w-md rounded-3xl border border-default bg-surface p-6 shadow-xl shadow-movexum-svart/5 sm:p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo href="/" className="mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            E-postverifiering
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">Movexum inkubatorplattform</p>
        </div>
        <div className="space-y-5">{children}</div>
      </div>
    </main>
  );
}

function StatusBox({
  variant,
  title,
  message
}: {
  variant: 'success' | 'error';
  title: string;
  message: string;
}) {
  const isSuccess = variant === 'success';
  return (
    <div
      className={`rounded-xl px-4 py-4 text-sm ${
        isSuccess
          ? 'bg-movexum-pastell-gron text-movexum-morkgron'
          : 'bg-movexum-pastell-orange text-movexum-morkorange'
      }`}
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}
