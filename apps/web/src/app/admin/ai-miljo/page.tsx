import { redirect } from 'next/navigation';
import { aiAnalysHref } from '@/app/installningar/ai-analys/paths';

export const dynamic = 'force-dynamic';

/** Legacy-route (§ 36.1): innehållet bor under Inställningar → AI-analys. */
export default async function LegacyRedirect({
  searchParams
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const params = await searchParams;
  redirect(aiAnalysHref('miljo', params.range));
}
