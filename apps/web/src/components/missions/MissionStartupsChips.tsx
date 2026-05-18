import Link from 'next/link';
import { Icon } from '@/components/proto';

interface StartupRef {
  id: string;
  name: string;
}

export function MissionStartupsChips({ startups }: { startups: StartupRef[] }) {
  if (!startups || startups.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-foreground-subtle">
        Bolag
      </span>
      {startups.map((s) => (
        <Link
          key={s.id}
          href={`/startups/${s.id}`}
          className="inline-flex items-center gap-1 rounded-md bg-canvas-muted px-2 py-0.5 text-[11.5px] font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
        >
          <Icon name="briefcase" size={10} />
          {s.name}
        </Link>
      ))}
    </div>
  );
}
