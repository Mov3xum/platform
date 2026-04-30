export default function EducationPage() {
  return (
    <section>
      <h1>Utbildningsplattform</h1>
      <p>Moduler för finansiering, hållbarhet, internationalisering och teamutveckling.</p>
      <div style={{ marginTop: 24, display: 'grid', gap: 16 }}>
        <article style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 20, background: '#ffffff' }}>
          <h2>Finansiering</h2>
          <p>Kurser, checklistor och verktyg för kapital, pitch och investerarrelationer.</p>
        </article>
        <article style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 20, background: '#ffffff' }}>
          <h2>Hållbarhet</h2>
          <p>Innehål som hjälper startupbolag att bygga långsiktig hållbarhet i kärnverksamheten.</p>
        </article>
      </div>
    </section>
  );
}
