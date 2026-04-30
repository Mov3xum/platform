import Link from 'next/link';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/startups', label: 'Startups' },
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/education', label: 'Utbildning' }
];

export function Navbar() {
  return (
    <nav style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <strong>Moveum Inkubator</strong>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} style={{ color: '#2563eb' }}>
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
