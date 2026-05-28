'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Card, CardHead, Icon } from '@/components/proto';

interface Props {
  slug: string;
  name: string;
}

// QR-koden genereras helt lokalt med 'qrcode' (ren JS, inga externa anrop) —
// EU-suveränt enligt CLAUDE.md § 10.2. Staff kan ladda ner PNG/SVG och
// publicera på event, affischer eller hemsidor.
export function ShareModule({ slug, name }: Props) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [pngUrl, setPngUrl] = useState('');
  const [svg, setSvg] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = origin ? `${origin}/inflode/m/${slug}` : '';

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const opts = { margin: 1, width: 480, errorCorrectionLevel: 'M' as const };
    QRCode.toDataURL(url, opts)
      .then((d) => {
        if (!cancelled) setPngUrl(d);
      })
      .catch(() => undefined);
    QRCode.toString(url, { ...opts, type: 'svg' })
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);

  function copy() {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function download(href: string, ext: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = `qr-${slug}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadSvg() {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const href = URL.createObjectURL(blob);
    download(href, 'svg');
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  }

  return (
    <Card>
      <CardHead label="Dela modulen" />
      <div style={{ padding: 16, display: 'grid', gap: 12 }}>
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
          {url || `…/inflode/m/${slug}`}
        </div>

        <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
          <button type="button" onClick={copy} className="mx-btn mx-sm mx-primary">
            <Icon name="copy" size={12} /> {copied ? 'Kopierad!' : 'Kopiera URL'}
          </button>
          {url && (
            <a href={url} target="_blank" rel="noreferrer noopener" className="mx-btn mx-sm">
              <Icon name="external" size={12} /> Öppna
            </a>
          )}
        </div>

        {pngUrl && (
          <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pngUrl}
              alt={`QR-kod för modulen ${name}`}
              width={180}
              height={180}
              style={{
                borderRadius: 8,
                border: '1px solid var(--mx-line-soft)',
                background: '#fff',
                padding: 8
              }}
            />
            <div className="mx-flex mx-items-c mx-gap-2 mx-wrap" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => download(pngUrl, 'png')}
                className="mx-btn mx-sm"
              >
                <Icon name="download" size={12} /> PNG
              </button>
              <button type="button" onClick={downloadSvg} className="mx-btn mx-sm" disabled={!svg}>
                <Icon name="download" size={12} /> SVG
              </button>
            </div>
          </div>
        )}

        <div className="mx-mono mx-t-xs mx-muted">
          Tips: ladda ner QR-koden och lägg på affischer eller event. Lägg på{' '}
          <code>?utm_source=...&amp;utm_campaign=...</code> i URL:en för att mäta vilken kanal som
          genererar leads.
        </div>
      </div>
    </Card>
  );
}
