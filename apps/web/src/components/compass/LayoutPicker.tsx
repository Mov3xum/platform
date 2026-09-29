'use client';

import { useState } from 'react';
import { COMPASS_LAYOUTS, COMPASS_LAYOUT_META } from '@platform/shared';
import type { CompassLayout } from '@platform/shared';
import type { FlowType } from '@/lib/compass/types';

interface Props {
  /** Fältnamn i modul-formuläret (postas med Spara). */
  name?: string;
  initial: CompassLayout;
  flowType: FlowType;
  onChange?: (layout: CompassLayout) => void;
}

/**
 * Mallväljare för den publika modulsidan (§ 23.7). Varje mall ritas som en
 * liten skiss (ren SVG, inga bilder) så man ser kompositionen innan man
 * väljer: var bilden hamnar, var rubriken ligger och var flödet sitter.
 * Valet postas som `layout` i modul-formuläret; ingenting sparas förrän
 * Spara/Publicera trycks.
 */
export function LayoutPicker({ name = 'layout', initial, flowType, onChange }: Props) {
  const [value, setValue] = useState<CompassLayout>(initial);

  return (
    <div className="mx-layoutpick" role="radiogroup" aria-label="Mall för modulen">
      {COMPASS_LAYOUTS.map((layout) => {
        const meta = COMPASS_LAYOUT_META[layout];
        const active = value === layout;
        const recommended = meta.bestFor.includes(flowType);
        return (
          <label key={layout} className={`mx-layoutpick-item${active ? ' is-active' : ''}`}>
            <input
              type="radio"
              name={name}
              value={layout}
              checked={active}
              onChange={() => {
                setValue(layout);
                onChange?.(layout);
              }}
            />
            <LayoutThumb layout={layout} active={active} />
            <span className="mx-layoutpick-text">
              <span className="mx-layoutpick-label">
                {meta.label}
                {recommended && <span className="mx-layoutpick-rec">Passar {flowWord(flowType)}</span>}
              </span>
              <span className="mx-layoutpick-desc">{meta.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function flowWord(flow: FlowType): string {
  return flow === 'chat' ? 'chatt' : flow === 'quiz' ? 'quiz' : 'formulär';
}

/**
 * Skiss av mallen i 160×100. Tre byggstenar: media (accent-toning), rubrik
 * (mörka streck) och flöde (ljust kort med rader). Ritas med currentColor så
 * den följer aktiv/inaktiv-tillstånd och dark mode.
 */
function LayoutThumb({ layout, active }: { layout: CompassLayout; active: boolean }) {
  const ink = active ? 'var(--mx-accent-thumb, #002c40)' : 'var(--mx-ink-soft)';
  const media = active ? 'var(--mx-accent-thumb, #002c40)' : 'var(--mx-muted-2)';
  const card = 'var(--mx-paper)';
  const line = 'var(--mx-line-strong)';

  // Små hjälpare för skissens byggstenar.
  const Title = ({ x, y, w, light = false }: { x: number; y: number; w: number; light?: boolean }) => (
    <g fill={light ? 'rgba(255,255,255,0.92)' : ink}>
      <rect x={x} y={y} width={w * 0.34} height={3} rx={1.5} opacity={0.55} />
      <rect x={x} y={y + 7} width={w} height={6} rx={2} />
      <rect x={x} y={y + 17} width={w * 0.72} height={3} rx={1.5} opacity={0.45} />
    </g>
  );
  const Card = ({ x, y, w, h, bare = false }: { x: number; y: number; w: number; h: number; bare?: boolean }) => (
    <g>
      {!bare && <rect x={x} y={y} width={w} height={h} rx={6} fill={card} stroke={line} />}
      {bare && <line x1={x} y1={y} x2={x + w} y2={y} stroke={line} />}
      <rect x={x + 8} y={y + 9} width={w - 16} height={3} rx={1.5} fill={media} opacity={0.5} />
      <rect x={x + 8} y={y + 18} width={w - 16} height={7} rx={3} fill="none" stroke={line} />
      <rect x={x + 8} y={y + 29} width={w - 16} height={7} rx={3} fill="none" stroke={line} />
      {h > 48 && <rect x={x + 8} y={y + 40} width={w - 16} height={7} rx={3} fill="none" stroke={line} />}
    </g>
  );
  const Media = ({ x, y, w, h, r = 6 }: { x: number; y: number; w: number; h: number; r?: number }) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={media} opacity={0.82} />
      <circle cx={x + w * 0.72} cy={y + h * 0.3} r={Math.min(w, h) * 0.09} fill="rgba(255,255,255,0.55)" />
      <path
        d={`M${x} ${y + h * 0.78} L${x + w * 0.35} ${y + h * 0.5} L${x + w * 0.55} ${y + h * 0.68} L${x + w * 0.72} ${y + h * 0.56} L${x + w} ${y + h * 0.8} L${x + w} ${y + h} L${x} ${y + h} Z`}
        fill="rgba(255,255,255,0.28)"
      />
    </g>
  );

  let body: React.ReactNode;
  switch (layout) {
    case 'split_left':
      body = (
        <>
          <Media x={10} y={10} w={56} h={80} r={8} />
          <Title x={78} y={12} w={70} />
          <Card x={78} y={42} w={72} h={48} />
        </>
      );
      break;
    case 'split_right':
      body = (
        <>
          <Title x={10} y={12} w={70} />
          <Card x={10} y={42} w={72} h={48} />
          <Media x={94} y={10} w={56} h={80} r={8} />
        </>
      );
      break;
    case 'cover':
      body = (
        <>
          <Media x={0} y={0} w={160} h={100} r={0} />
          <rect x={0} y={0} width={160} height={100} fill="rgba(0,20,30,0.38)" />
          <Title x={44} y={12} w={72} light />
          <Card x={30} y={44} w={100} h={48} />
        </>
      );
      break;
    case 'panel':
      body = (
        <>
          <rect x={10} y={8} width={140} height={54} rx={8} fill={media} opacity={0.9} />
          <Title x={20} y={16} w={60} light />
          <rect x={98} y={16} width={44} height={36} rx={5} fill="rgba(255,255,255,0.35)" />
          <Card x={24} y={50} w={112} h={42} />
        </>
      );
      break;
    case 'minimal':
      body = (
        <>
          <line x1={24} y1={12} x2={136} y2={12} stroke={ink} />
          <g fill={ink}>
            <rect x={24} y={20} width={90} height={9} rx={3} />
            <rect x={24} y={34} width={60} height={3} rx={1.5} opacity={0.45} />
          </g>
          <Card x={24} y={50} w={112} h={42} bare />
        </>
      );
      break;
    case 'classic':
    default:
      body = (
        <>
          <Media x={10} y={8} w={140} h={30} r={6} />
          <Title x={10} y={44} w={70} />
          <Card x={10} y={70} w={140} h={26} />
        </>
      );
  }

  return (
    <svg viewBox="0 0 160 100" className="mx-layoutpick-thumb" aria-hidden>
      <rect x={0} y={0} width={160} height={100} rx={10} fill="var(--mx-paper-2)" />
      {body}
    </svg>
  );
}
