import type { ModuleCardProps } from '../lib/types';

export function ModuleCard({ title, description, route }: ModuleCardProps) {
  return (
    <article className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-foreground-muted">{description}</p>
      <a
        href={route}
        className="mt-3 inline-block text-sm font-medium text-link transition hover:underline"
      >
        Gå till modulen ↗
      </a>
    </article>
  );
}
