import 'server-only';
import type PocketBase from 'pocketbase';
import type { UserFileDocKind } from '@platform/shared';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { pbFieldCodes, pbStatus } from '@/lib/pb-error';

/**
 * Skapa en rad i det personliga filarkivet (`user_files`, strikt ägaren-bara
 * § 17.2) — delad av `/api/filer` (uppladdning från UI:t) och
 * `lib/actions/files.ts` så skrivvägen aldrig divergerar.
 *
 * Varför superuser-fallback: PB v0.23.4:s rule-eval kan TYST neka en behörig
 * användares create (§ 21.3, migration 1700000111 beskriver exakt symtomet:
 * "Failed to create record." → 500 i uppladdningsrouten). En instans där
 * migrationen ännu inte körts (PB-containern byggs om mer sällan än web-appen)
 * bär fortfarande `@request.auth.tenant = tenant`-joinen i createRule → varje
 * uppladdning fallerar trots att listning fungerar.
 *
 * Säkerhetsgränsen är oförändrad: `tenant` och `owner` sätts I KODEN från den
 * inloggade användaren, aldrig från klienten, och posten verifieras efter
 * skrivningen. Fallbacken är en robusthetsväg, inte en behörighetsväg (samma
 * mönster som § 18.3/§ 20.5/§ 30.4/§ 34.3).
 */

export interface CreateUserFileInput {
  file: Blob;
  filename: string;
  mime: string;
  sizeBytes: number;
  source: 'upload' | 'agent_generated';
  docKind: UserFileDocKind;
  /** Extra fält (t.ex. `topic_status`, `chat_thread`, `tool_run`). */
  extra?: Record<string, string | undefined>;
}

export interface CreatedUserFile {
  id: string;
  tenant: string;
  owner: string;
}

export async function createUserFileRecord(
  pb: PocketBase,
  user: { id: string; tenant: string },
  input: CreateUserFileInput
): Promise<CreatedUserFile> {
  const buildForm = (): FormData => {
    const fd = new FormData();
    fd.append('tenant', user.tenant);
    fd.append('owner', user.id);
    fd.append('file', input.file, input.filename);
    fd.append('filename', input.filename);
    fd.append('mime', input.mime);
    fd.append('size_bytes', String(input.sizeBytes));
    fd.append('source', input.source);
    fd.append('doc_kind', input.docKind);
    for (const [k, v] of Object.entries(input.extra || {})) {
      if (v) fd.append(k, v);
    }
    return fd;
  };

  let rec: CreatedUserFile;
  try {
    // Nytt FormData per försök: en Blob kan läsas om, men ett redan skickat
    // FormData-objekt ska inte återanvändas mellan klienter.
    rec = (await writeWithFallback(pb, (client) =>
      client.collection('user_files').create<CreatedUserFile>(buildForm())
    )) as CreatedUserFile;
  } catch (err) {
    // PII-fri logg: status + vilka fält PB klagade på, aldrig filnamn/innehåll.
    console.error('[user-files] create failed', {
      status: pbStatus(err),
      fields: Object.keys(pbFieldCodes(err)),
      codes: pbFieldCodes(err)
    });
    throw err;
  }

  if (rec.owner !== user.id || rec.tenant !== user.tenant) {
    // Ska aldrig hända (vi satte fälten själva) — ett tydligt fel i stället
    // för att returnera en post som inte tillhör den inloggade.
    throw new Error('Filposten fick fel ägare/tenant.');
  }
  return rec;
}
