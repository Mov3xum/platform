import Link from 'next/link';
import { Icon } from '@/components/proto';
import { SURVEY_LINK_KIND_LABEL, surveyLinkHref, type SurveyLinkKind } from '@platform/shared';

/** "Följer upp: <källa>" — länk tillbaka till det enkäten skapades från. */
export function SurveyLinkChip({
  kind,
  id,
  label,
  slug
}: {
  kind: SurveyLinkKind | null;
  id: string;
  label: string;
  slug?: string;
}) {
  if (!kind || !id) return null;
  return (
    <Link
      href={surveyLinkHref({ kind, id }, slug)}
      className="inline-flex items-center gap-1 rounded-full border border-default bg-canvas-subtle px-2 py-0.5 text-[11px] font-medium text-foreground-muted hover:text-brand"
      title={`Följer upp ${SURVEY_LINK_KIND_LABEL[kind].toLowerCase()}: ${label}`}
    >
      <Icon name="link" size={11} />
      <span className="max-w-[220px] truncate">
        {SURVEY_LINK_KIND_LABEL[kind]} · {label || id}
      </span>
    </Link>
  );
}
