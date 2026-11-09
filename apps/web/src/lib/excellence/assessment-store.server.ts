import 'server-only';
import type PocketBase from 'pocketbase';
import { createUserFileRecord } from '@/lib/user-files.server';
import { extractAndIndexUserFile } from '@/lib/user-files-index.server';
import { pbStatus } from '@/lib/pb-error';
import { buildExcellenceAssessmentPdf } from './assessment-pdf';
import { EXCELLENCE_FILE_TOPIC, excellenceAssessmentFilename } from './assessment-file';
import type { ExcellenceAssessment } from './types';

/**
 * Sparar bedömningen som PDF i den inloggades Filer (`user_files`, strikt
 * ägaren-bara § 17.2) under ämnet Rapporter & uppföljning och — när
 * bedömningen gällde ett portföljbolag — i bolagets mapp (`startup`, fliken
 * Bolag i /filer). Registerdata från leverantören sparas fortfarande INTE på
 * bolagskortet (§ 51); det är själva underlaget som arkiveras, så en körning
 * (som kostar credits) aldrig behöver göras om för att visa vad den gav.
 *
 * Fail-soft: kan filen inte skapas visas bedömningen ändå med `fileError`.
 * owner/tenant sätts av `createUserFileRecord` från den inloggade — aldrig
 * från klienten. Ingen ny dataväg: PDF:en innehåller bara det vyn redan visar
 * (fysiska personer i ägarbilden utan namn; grundarnamn ur teamet på
 * bolagskortet, samma staff-krets som bolagskortet).
 */
export async function renderExcellenceAssessmentPdf(
  assessment: ExcellenceAssessment
): Promise<{ buffer: Buffer; filename: string } | null> {
  try {
    const buffer = await buildExcellenceAssessmentPdf(assessment);
    return {
      buffer,
      filename: excellenceAssessmentFilename({
        subjectName: assessment.subject.name,
        orgNr: assessment.subject.orgNr,
        assessedAt: assessment.assessedAt
      })
    };
  } catch (err) {
    console.error('[excellence] pdf render failed', { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function storeExcellenceAssessmentPdf(
  pb: PocketBase,
  user: { id: string; tenant: string },
  assessment: ExcellenceAssessment,
  pdf: { buffer: Buffer; filename: string } | null
): Promise<ExcellenceAssessment> {
  if (!pdf) return { ...assessment, fileError: 'Bedömningen kunde inte renderas som PDF. Den visas ändå nedan.' };
  const { buffer, filename } = pdf;
  try {
    const rec = await createUserFileRecord(
      pb,
      { id: user.id, tenant: user.tenant },
      {
        file: new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
        filename,
        mime: 'application/pdf',
        sizeBytes: buffer.length,
        // Deterministisk rendering (ingen AI) → `upload`, så filen inte märks
        // "genererad" (art. 50 gäller AI-innehåll) och inte AI-klassas på nytt.
        source: 'upload',
        docKind: 'pdf',
        extra: {
          topic: EXCELLENCE_FILE_TOPIC,
          topic_status: 'confirmed',
          startup: assessment.subject.startupId
        }
      }
    );
    // Gör underlaget sökbart i chatten (`search_my_files`/`read_my_file`,
    // § 27) — best-effort, texten personnummer-saneras i indexeraren.
    extractAndIndexUserFile(pb, user.tenant, user.id, rec.id).catch(() => undefined);
    return {
      ...assessment,
      file: {
        id: rec.id,
        filename,
        href: `/api/files/${rec.id}`,
        startupId: assessment.subject.startupId
      }
    };
  } catch (err) {
    // PII-fri logg: status, aldrig filnamn (bär bolagsnamn) eller innehåll.
    console.error('[excellence] pdf store failed', { status: pbStatus(err), userId: user.id });
    return {
      ...assessment,
      fileError:
        'Bedömningen kunde inte sparas i Filer' +
        (pbStatus(err) === 404 ? ' (kollektionen user_files saknas — har migrationerna körts?).' : '. Den visas ändå nedan.')
    };
  }
}
