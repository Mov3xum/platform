// Movexum OS — delade UI-primitives för alla vyer
// Använd dessa istället för att duplicera inline-styling.

import type { ReactNode } from 'react';
import { SPRINT_X_AXES, type SprintXScore } from '@platform/shared';
import { Icon } from './Icon';

/* ────────── PageHead / IdTag / SectionHead ────────── */

export function IdTag({ children }: { children: ReactNode }) {
  return <span className="mx-id-tag">{children}</span>;
}

export function PageHead({
  crumb,
  title,
  subtitle,
  actions
}: {
  crumb: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-page-head">
      <div>
        <IdTag>{crumb}</IdTag>
        <h1>{title}</h1>
        {subtitle && <div className="mx-sub">{subtitle}</div>}
      </div>
      {actions && <div className="mx-actions">{actions}</div>}
    </div>
  );
}

export function SectionHead({
  title,
  label,
  right
}: {
  title: string;
  label?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mx-section-head">
      <h2>{title}</h2>
      {label && <span className="mx-lab">{label}</span>}
      <span className="mx-grow" />
      {right}
    </div>
  );
}

/* ────────── Card ────────── */

export function Card({
  children,
  className = '',
  ink,
  style
}: {
  children: ReactNode;
  className?: string;
  ink?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`mx-card${ink ? ' mx-ink-card' : ''}${className ? ' ' + className : ''}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function CardHead({
  label,
  right,
  children
}: {
  label?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-card-head">
      {label && <span className="mx-lab">{label}</span>}
      {children}
      <span className="mx-grow" />
      {right}
    </div>
  );
}

/* ────────── Chip & Avatar ────────── */

type ChipVariant =
  | 'default'
  | 'draft'
  | 'active'
  | 'review'
  | 'done'
  | 'archive'
  | 'danger'
  | 'green'
  | 'purple'
  | 'brown'
  | 'copper'
  | 'yellow'
  | 'cyan'
  | 'ink-chip';

export function Chip({
  children,
  variant = 'default',
  mono = false,
  dot = false
}: {
  children: ReactNode;
  variant?: ChipVariant;
  mono?: boolean;
  dot?: boolean;
}) {
  return (
    <span
      className={`mx-chip${variant !== 'default' ? ` mx-${variant}` : ''}${mono ? ' mx-mono' : ''}`}
    >
      {dot && <span className="mx-dot" />}
      {children}
    </span>
  );
}

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

export function Avatar({
  initial,
  size = 'md',
  accent = 'ink'
}: {
  initial: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  accent?: AvatarAccent;
}) {
  return (
    <div className={`mx-av mx-${size} mx-${accent}`} style={size === 'md' ? {} : undefined}>
      {initial.slice(0, 2)}
    </div>
  );
}

/* ────────── Spark line ────────── */

export function Spark({
  data,
  color = 'var(--mx-ink)',
  width = 64,
  height = 22
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const pts = data
    .map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const y = height - ((v - min) / Math.max(1, max - min)) * height;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={pts}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / Math.max(1, max - min)) * height}
        r="2"
        fill={color}
      />
    </svg>
  );
}

/* ────────── Radar charts ────────── */

const RADAR_COLORS: Record<string, string> = {
  funding: '#ca9323',
  intl: '#005470',
  sustain: '#4a7d4a',
  team: '#6138b5'
};

export function MiniRadar({ score, size = 44 }: { score: SprintXScore; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const pts = SPRINT_X_AXES.map((a, i) => {
    const angle = (Math.PI * 2 * i) / SPRINT_X_AXES.length - Math.PI / 2;
    const v = (score[a.id] || 0) / 100;
    return `${cx + Math.cos(angle) * r * v},${cy + Math.sin(angle) * r * v}`;
  }).join(' ');
  return (
    <svg width={size} height={size} aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--mx-line)" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx={cx} cy={cy} r={r * 0.5} fill="none" stroke="var(--mx-line-soft)" strokeWidth="1" />
      <polygon
        points={pts}
        fill="#6138b5"
        fillOpacity="0.14"
        stroke="#8e6fd6"
        strokeWidth="1.2"
      />
      {SPRINT_X_AXES.map((a, i) => {
        const angle = (Math.PI * 2 * i) / SPRINT_X_AXES.length - Math.PI / 2;
        const v = (score[a.id] || 0) / 100;
        return (
          <circle
            key={a.id}
            cx={cx + Math.cos(angle) * r * v}
            cy={cy + Math.sin(angle) * r * v}
            r="2"
            fill={RADAR_COLORS[a.id]}
          />
        );
      })}
    </svg>
  );
}

export function BigRadar({ score, size = 360 }: { score: SprintXScore; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 60;
  const pts = SPRINT_X_AXES.map((a, i) => {
    const angle = (Math.PI * 2 * i) / SPRINT_X_AXES.length - Math.PI / 2;
    const v = (score[a.id] || 0) / 100;
    return { x: cx + Math.cos(angle) * r * v, y: cy + Math.sin(angle) * r * v, axis: a, angle };
  });

  return (
    <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      {[0.25, 0.5, 0.75, 1].map((p) => (
        <circle
          key={p}
          cx={cx}
          cy={cy}
          r={r * p}
          fill="none"
          stroke={p === 1 ? 'var(--mx-line-strong)' : 'var(--mx-line)'}
          strokeWidth="1"
          strokeDasharray={p < 1 ? '2 3' : ''}
        />
      ))}
      {SPRINT_X_AXES.map((a, i) => {
        const angle = (Math.PI * 2 * i) / SPRINT_X_AXES.length - Math.PI / 2;
        return (
          <line
            key={a.id}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(angle) * r}
            y2={cy + Math.sin(angle) * r}
            stroke="var(--mx-line)"
            strokeWidth="1"
          />
        );
      })}
      <polygon
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="#6138b5"
        fillOpacity="0.14"
        stroke="#8e6fd6"
        strokeWidth="2"
      />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="5"
          fill={RADAR_COLORS[p.axis.id]}
          stroke="white"
          strokeWidth="2"
        />
      ))}
      {SPRINT_X_AXES.map((a, i) => {
        const angle = (Math.PI * 2 * i) / SPRINT_X_AXES.length - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (r + 32);
        const ly = cy + Math.sin(angle) * (r + 32);
        return (
          <g key={'l' + a.id}>
            <text
              x={lx}
              y={ly - 5}
              textAnchor="middle"
              fontFamily="JetBrains Mono"
              fontSize="10"
              fontWeight="600"
              letterSpacing="1.5"
              fill="var(--mx-muted)"
            >
              {a.label.toUpperCase()}
            </text>
            <text
              x={lx}
              y={ly + 12}
              textAnchor="middle"
              fontFamily="Sora"
              fontSize="20"
              fontWeight="500"
              fill={RADAR_COLORS[a.id]}
            >
              {score[a.id] || 0}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ────────── ProgressBar ────────── */

export function ProgressBar({ pct, accent = 'ink' }: { pct: number; accent?: string }) {
  const colorMap: Record<string, string> = {
    ink: '#6138b5',
    green: '#4a7d4a',
    purple: '#6138b5',
    brown: '#4b2718',
    copper: '#d67e47',
    yellow: '#ca9323',
    cyan: '#005470'
  };
  return (
    <div
      style={{
        flex: 1,
        height: 4,
        background: 'var(--mx-line-soft)',
        borderRadius: 999,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: '100%',
          background: colorMap[accent] || accent,
          transition: 'width .25s'
        }}
      />
    </div>
  );
}

/* ────────── Meta label/value ────────── */

export function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">{label}</div>
      <div style={{ marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* ────────── Toggle ────────── */

export function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!checked);
      }}
      style={{
        width: 32,
        height: 18,
        borderRadius: 999,
        background: checked ? '#6138b5' : 'var(--mx-line)',
        position: 'relative',
        flexShrink: 0,
        transition: 'background .15s',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        border: 0
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: 50,
          background: 'white',
          transition: 'left .15s',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          display: 'block'
        }}
      />
    </button>
  );
}

/* ────────── KPI block ────────── */

export function KpiBlock({
  label,
  value,
  hint,
  spark,
  foot
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  spark?: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <Card style={{ padding: 16 }}>
      <div className="mx-flex mx-justify-b mx-items-c mx-mb-2">
        <span className="mx-t-xs mx-mono mx-fw-6 mx-muted mx-t-up">{label}</span>
        <Icon name="arrow" size={12} style={{ color: 'var(--mx-muted-2)' }} />
      </div>
      <div className="mx-flex mx-items-e mx-justify-b" style={{ marginBottom: 8 }}>
        <div>
          <span
            className="mx-disp"
            style={{ fontSize: 30, fontWeight: 500, letterSpacing: -1, lineHeight: 1 }}
          >
            {value}
          </span>
          {hint && (
            <span className="mx-muted mx-t-12 mx-fw-5" style={{ marginLeft: 6 }}>
              {hint}
            </span>
          )}
        </div>
        {spark}
      </div>
      {foot}
    </Card>
  );
}
