import { redirect } from 'next/navigation';
import { AI_ANALYS_PATH } from '../ai-analys/paths';

/** Legacy-route: sektionen heter numera AI-analys (§ 36.1). */
export default function LegacyAiKostnadRedirect() {
  redirect(AI_ANALYS_PATH);
}
