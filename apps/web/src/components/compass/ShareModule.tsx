'use client';

import { useEffect, useState } from 'react';
import { Card, CardHead, Icon } from '@/components/proto';

interface Props {
  slug: string;
  name: string;
}

export function ShareModule({ slug, name }: Props) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin ? `${origin}/inflode/m/${slug}` : `/inflode/m/${slug}`;

  function copy() {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  // Lightweight QR via Google Charts API alternativ? Vi använder en
  // inbäddad SVG-genererad QR. För enkelhetens skull använder vi en
  // CSS-baserad placeholder och lägger till en QR-bild via en
  // ren API från charts ej tillåten (EU-suveränitet) — vi visar URL
  // tydligt istället och låter staff generera QR utanför systemet.
  return (
    <Card>
      <CardHead label="Dela modulen" />
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            background: 'var(--mx-paper-2)',
            border: '1px solid var(--mx-line-soft)',
            fontFamily: 'var(--mx-mono)',
            fontSize: 12,
            wordBreak: 'break-all'
          }}
        >
          {url}
        </div>
        <div className="mx-flex mx-items-c mx-gap-2">
          <button type="button" onClick={copy} className="mx-btn mx-sm mx-primary">
            <Icon name="copy" size={12} /> {copied ? 'Kopierad!' : 'Kopiera URL'}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="mx-btn mx-sm"
          >
            Öppna i ny flik →
          </a>
        </div>
        <div className="mx-mono mx-t-xs mx-muted">
          Tips: maila länken till en kollega, klistra in på er hemsida eller spara
          som QR-kod för event. Lägg på <code>?utm_source=...&amp;utm_campaign=...</code>{' '}
          för att mäta vilken kanal som genererar leads.
        </div>
      </div>
    </Card>
  );
}
