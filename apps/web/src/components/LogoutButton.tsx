import { logoutAction } from '@/lib/actions/auth';

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="inline-flex rounded-full border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
      >
        Logga ut
      </button>
    </form>
  );
}
