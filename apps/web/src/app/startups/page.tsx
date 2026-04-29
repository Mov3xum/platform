export default function StartupsPage() {
  return (
    <section>
      <h1>Startup-översikt</h1>
      <p>En gemensam modul för att samla all nödvändig information om bolag.</p>
      <div style={{ marginTop: 24, display: 'grid', gap: 16 }}>
        <article style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 20, background: '#ffffff' }}>
          <h2>Startupkompassen</h2>
          <p>Företagsprofil, IRL-faser, dokument, team och avtal samlat.</p>
        </article>
        <article style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 20, background: '#ffffff' }}>
          <h2>AVTAL & NDA</h2>
          <p>Full avtalshantering med Movexum, signerade dokument och egen dashboard.</p>
        </article>
      </div>
    </section>
  );
}
