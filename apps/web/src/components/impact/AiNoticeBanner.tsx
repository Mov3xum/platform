/** Transparensbanner (CLAUDE.md § 9.7 / EU AI Act art. 50) — visas på alla ytor i Impact Navigator. */
export function AiNoticeBanner({ generated }: { generated?: boolean }) {
  return (
    <p className="rounded-2xl border border-default bg-canvas-subtle px-4 py-2 text-xs text-foreground-muted">
      AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella anteckningar exkluderas alltid.
      {generated ? <> <strong className="font-semibold text-foreground">Genererat av AI – verifiera innan delning.</strong></> : null}
    </p>
  );
}
