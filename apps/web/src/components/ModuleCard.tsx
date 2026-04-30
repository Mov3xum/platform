import type { ModuleCardProps } from '../lib/types';

export function ModuleCard({ title, description, route }: ModuleCardProps) {
  return (
    <article style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 20, width: 300 }}>
      <h3>{title}</h3>
      <p style={{ color: '#4b5563' }}>{description}</p>
      <a href={route} style={{ color: '#2563eb', marginTop: 12, display: 'inline-block' }}>
        Gå till modulen ↗
      </a>
    </article>
  );
}
