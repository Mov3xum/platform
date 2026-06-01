// ── Fildelar-ämnen (migration 1700000110) ───────────────────────────────
// Fast Movexum-ämnestaxonomi för det personliga filarkivet (/filer). En
// AI-agent klassar varje fil till exakt ETT ämne (CLAUDE.md § 24). Listan är
// medvetet liten och förutsägbar — UI:t designas kring den, och en osäker
// AI-gissning faller tillbaka på `osorterat` + människa-i-loopen-dialog.
//
// Lägg ALDRIG till ett ämne här utan att även utöka select-värdena i
// migration 1700000110 (eller en ny migration) — fältet är en PB-select.

export type FileTopic =
  | 'affarsplan_strategi'
  | 'finansiering_kapital'
  | 'hallbarhet_esg'
  | 'internationalisering'
  | 'pitch_material'
  | 'juridik_avtal'
  | 'rapporter_uppfoljning'
  | 'osorterat';

/** Var en fil befinner sig i kategoriserings-livscykeln. */
export type FileTopicStatus =
  | 'pending' // inte kategoriserad än
  | 'auto' // AI klassade med tillräcklig säkerhet
  | 'needs_review' // AI osäker → kräver användarens bekräftelse (dialog)
  | 'confirmed'; // människa har valt/bekräftat ämnet

export interface FileTopicDef {
  id: FileTopic;
  /** Visningsnamn i UI (svenska). */
  label: string;
  /** Kort beskrivning — matas till AI-agenten som klassningsledtråd. */
  description: string;
  /** Ikonnamn i proto/Icon. */
  icon: string;
}

/** Default-ämnet för osorterade/osäkra filer. */
export const DEFAULT_FILE_TOPIC: FileTopic = 'osorterat';

/**
 * Källan av sanning för ämnesmapparna. Ordningen styr även renderingen i
 * mappgriden (osorterat sist).
 */
export const FILE_TOPICS: readonly FileTopicDef[] = [
  {
    id: 'affarsplan_strategi',
    label: 'Affärsplaner & strategi',
    description:
      'Affärsplaner, affärsmodell, strategidokument, roadmaps, marknadsanalyser, GTM.',
    icon: 'compass'
  },
  {
    id: 'finansiering_kapital',
    label: 'Finansiering & kapital',
    description:
      'Kapitalrundor, term sheets, investerarunderlag, budget, cap table, ekonomi.',
    icon: 'graph'
  },
  {
    id: 'hallbarhet_esg',
    label: 'Hållbarhet & ESG',
    description:
      'Hållbarhetsrapporter, ESG, miljö, klimat, sociala mål, impact.',
    icon: 'spark'
  },
  {
    id: 'internationalisering',
    label: 'Internationalisering',
    description:
      'Exportplaner, marknadsetablering utomlands, internationell expansion.',
    icon: 'globe'
  },
  {
    id: 'pitch_material',
    label: 'Pitch & material',
    description:
      'Pitchdecks, presentationer, säljmaterial, one-pagers, demo-underlag.',
    icon: 'star'
  },
  {
    id: 'juridik_avtal',
    label: 'Juridik & avtal',
    description:
      'Avtal, NDA, IP/patent, bolagsordning, juridiska underlag och villkor.',
    icon: 'shield'
  },
  {
    id: 'rapporter_uppfoljning',
    label: 'Rapporter & uppföljning',
    description:
      'Kvartals-/årsrapporter, uppföljning, KPI:er, statusrapporter, mätetal.',
    icon: 'calendar'
  },
  {
    id: 'osorterat',
    label: 'Osorterat',
    description:
      'Filer som inte passar i något annat ämne, eller där AI:n är osäker.',
    icon: 'inbox'
  }
] as const;

export const FILE_TOPIC_IDS: readonly FileTopic[] = FILE_TOPICS.map((t) => t.id);

export const FILE_TOPIC_LABELS: Record<FileTopic, string> = FILE_TOPICS.reduce(
  (acc, t) => {
    acc[t.id] = t.label;
    return acc;
  },
  {} as Record<FileTopic, string>
);

/** Typ-säker check att en sträng är ett giltigt ämne. */
export function isFileTopic(value: unknown): value is FileTopic {
  return typeof value === 'string' && (FILE_TOPIC_IDS as string[]).includes(value);
}

/** Normaliserar en (möjligen ogiltig) sträng till ett giltigt ämne. */
export function resolveFileTopic(value: unknown): FileTopic {
  return isFileTopic(value) ? value : DEFAULT_FILE_TOPIC;
}
