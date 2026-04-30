export default function DashboardPage() {
  return (
    <section>
      <h1>Dashboard</h1>
      <p>Rollanpassad översikt för inkubatorteam, mentorer och bolag.</p>
      <div style={{ marginTop: 24, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div style={{ padding: 20, border: '1px solid #d1d5db', borderRadius: 12, background: '#ffffff' }}>
          <h2>Aktiviteter</h2>
          <p>Visa kommande möten, aktiviteter och nästa steg för valda bolag.</p>
        </div>
        <div style={{ padding: 20, border: '1px solid #d1d5db', borderRadius: 12, background: '#ffffff' }}>
          <h2>Status</h2>
          <p>Översikt över innovation readiness level och avtalsstatus.</p>
        </div>
      </div>
    </section>
  );
}
