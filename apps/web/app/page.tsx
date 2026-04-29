import { coreModules } from '@platform/shared';
import { ModuleCard } from '../components/ModuleCard';

export default function HomePage() {
  return (
    <section>
      <header>
        <h1>Välkommen till Moveums inkubatorplattform</h1>
        <p>Modulär plattform för startupdata, onboarding och roller i inkubatorn.</p>
      </header>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: '2rem' }}>
        {coreModules.map((module) => (
          <ModuleCard key={module.id} title={module.title} description={module.description} route={module.route} />
        ))}
      </div>
    </section>
  );
}
