import { useId } from 'react';
import {
  KTH_IRL_AXES,
  IRL_MAX,
  irlRadarPoints,
  irlRingPoints,
  type IrlAxisKey,
  type IrlProfile
} from '@platform/shared';

/**
 * KTH Innovation Readiness Level™ som radar (sexhörning), ritad som inline-SVG.
 * Fyllningen är en radiell gradient från centrum (orange) via gul till grön i
 * ytterkanten — samma läsning som KTH:s diagram (låg nivå = varm, hög = grön)
 * men med Movexums palett (ingen röd, § 2.3). Färger och text via CSS-
 * variabler så dark mode följer med. Ren presentation: används både i
 * serverkomponenter (översikt) och i den interaktiva editorn (klient).
 */
export function IrlRadar({
  profile,
  previous,
  size = 'md',
  activeAxis,
  onAxisClick,
  title = 'KTH Innovation Readiness Level'
}: {
  profile: IrlProfile;
  /** Föregående bedömning — ritas som streckad kontur. */
  previous?: IrlProfile | null;
  size?: 'sm' | 'md' | 'lg';
  activeAxis?: IrlAxisKey | null;
  onAxisClick?: (key: IrlAxisKey) => void;
  title?: string;
}) {
  const gid = useId().replace(/:/g, '');
  const W = 440;
  const H = 330;
  const geometry = { cx: W / 2, cy: H / 2, r: 108 };
  const points = irlRadarPoints(profile, geometry);
  const prevPoints = previous ? irlRadarPoints(previous, geometry) : null;
  const anyLevel = points.some((p) => p.level !== null);
  const width = size === 'sm' ? 300 : size === 'lg' ? 460 : 380;
  const labelR = geometry.r + 22;
  // Avrundade koordinater — server och klient räknar sin/cos olika på sista
  // decimalen, vilket annars ger hydreringsvarning.
  const r1 = (n: number) => Math.round(n * 10) / 10;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ maxWidth: width }}
      role="img"
      aria-label={`${title}: ${KTH_IRL_AXES.map((a) => `${a.label} ${profile[a.key] ?? 'ej bedömd'}`).join(', ')}`}
      className="mx-auto block h-auto"
    >
      <defs>
        <radialGradient id={`irl-fill-${gid}`} cx={geometry.cx} cy={geometry.cy} r={geometry.r} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--movexum-orange)" />
          <stop offset="50%" stopColor="var(--movexum-gul)" />
          <stop offset="100%" stopColor="var(--movexum-gron)" />
        </radialGradient>
      </defs>

      {/* Nivåringar 1–9 (3, 6 och 9 lite tydligare) */}
      {Array.from({ length: IRL_MAX }, (_, i) => i + 1).map((lvl) => (
        <polygon
          key={lvl}
          points={irlRingPoints(lvl, geometry)}
          fill="none"
          stroke={lvl % 3 === 0 ? 'var(--color-border-strong)' : 'var(--color-border-default)'}
          strokeWidth={1}
        />
      ))}
      {/* Axlar */}
      {points.map((p) => (
        <line
          key={p.key}
          x1={geometry.cx}
          y1={geometry.cy}
          x2={p.outerX}
          y2={p.outerY}
          stroke={activeAxis === p.key ? 'var(--color-brand)' : 'var(--color-border-default)'}
          strokeWidth={activeAxis === p.key ? 2 : 1}
        />
      ))}

      {anyLevel ? (
        <polygon
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={`url(#irl-fill-${gid})`}
          fillOpacity={0.88}
          stroke="var(--movexum-gron)"
          strokeWidth={1.25}
          strokeLinejoin="round"
        />
      ) : null}

      {prevPoints && prevPoints.some((p) => p.level !== null) ? (
        <polygon
          points={prevPoints.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--color-foreground-subtle)"
          strokeWidth={1.25}
          strokeDasharray="4 3"
          strokeLinejoin="round"
        />
      ) : null}

      {/* Värden vid hörnen */}
      {points.map((p) =>
        p.level !== null ? (
          <g key={`v-${p.key}`}>
            <circle cx={p.x} cy={p.y} r={3} fill="var(--color-foreground)" />
            <text
              x={r1(p.x + Math.sin(p.angle) * 14)}
              y={r1(p.y - Math.cos(p.angle) * 14 + 5)}
              textAnchor="middle"
              fontSize={size === 'sm' ? 18 : 15}
              fontWeight={700}
              fill="var(--color-foreground)"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {p.level}
            </text>
          </g>
        ) : null
      )}

      {/* Axeletiketter */}
      {points.map((p) => {
        const axis = KTH_IRL_AXES.find((a) => a.key === p.key)!;
        const lx = r1(geometry.cx + labelR * Math.sin(p.angle));
        const ly = r1(geometry.cy - labelR * Math.cos(p.angle));
        const anchor = Math.abs(Math.sin(p.angle)) < 0.2 ? 'middle' : Math.sin(p.angle) > 0 ? 'start' : 'end';
        const dy = Math.cos(p.angle) > 0.5 ? -18 : Math.cos(p.angle) < -0.5 ? 12 : -4;
        const active = activeAxis === p.key;
        const label = (
          <text
            x={lx}
            y={ly + dy}
            textAnchor={anchor}
            fontSize={size === 'sm' ? 15 : 13}
            fill={active ? 'var(--color-brand)' : 'var(--color-foreground)'}
            fontWeight={active ? 700 : 600}
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {axis.label}
            <tspan x={lx} dy={size === 'sm' ? 16 : 14} fontSize={size === 'sm' ? 12 : 10.5} fontWeight={500} fill="var(--color-foreground-subtle)">
              {axis.short}
              {p.level === null ? ' · ej bedömd' : ''}
            </tspan>
          </text>
        );
        if (!onAxisClick) return <g key={`l-${p.key}`}>{label}</g>;
        return (
          <g
            key={`l-${p.key}`}
            role="button"
            tabIndex={0}
            aria-label={`Välj ${axis.label}`}
            className="cursor-pointer focus:outline-none"
            onClick={() => onAxisClick(p.key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onAxisClick(p.key);
              }
            }}
          >
            {/* Större träffyta */}
            <circle cx={lx} cy={ly + dy + 4} r={26} fill="transparent" />
            {label}
          </g>
        );
      })}
    </svg>
  );
}
