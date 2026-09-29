import {
  AGENT_MEMORY_CATEGORIES,
  normalizeAgentMemoryCategory,
  resolveAgentMemoryCategory
} from '@platform/shared';
import { getServerPb } from '@/lib/auth.server';
import {
  AgentMemoryManager,
  type AgentMemoryItem,
  type StartupOption
} from '../AgentMemoryManager';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

// Läsvägen paginerar (§ 33.4-principen): ett växande minne får aldrig kapas
// tyst vid en sidgräns. Hårt tak som robusthetsgräns (§ 10).
const PAGE_SIZE = 200;
const MAX_ROWS = 5000;

interface AgentMemoryRecord {
  id: string;
  key: string;
  content: string;
  category?: unknown;
  startup?: string;
  updated: string;
  expand?: {
    startup?: { name?: string };
    updated_by?: { display_name?: string; email?: string };
  };
}

export default async function AiMinnePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const params = (await searchParams) ?? {};
  const rawCategory = Array.isArray(params.kategori) ? params.kategori[0] : params.kategori;
  // Bara formatvaliderat — okänt värde faller tyst tillbaka på "alla".
  const initialCategory = normalizeAgentMemoryCategory(rawCategory) ?? null;

  // AI-minne (agent_memory, § 16.4) — läses via användarens auth-token → RLS
  // (staff-only, tenant-scope) gäller.
  let memoryItems: AgentMemoryItem[] = [];
  let startupOptions: StartupOption[] = [];
  let readNotice: string | null = null;
  try {
    const rows: AgentMemoryRecord[] = [];
    let page = 1;
    let truncated = false;
    for (;;) {
      const res = await pb.collection('agent_memory').getList<AgentMemoryRecord>(page, PAGE_SIZE, {
        filter: pb.filter('tenant = {:t}', { t: user.tenant }),
        sort: '-updated',
        expand: 'startup,updated_by'
      });
      rows.push(...res.items);
      if (page >= res.totalPages || res.items.length === 0) break;
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        break;
      }
      page += 1;
    }
    if (truncated) {
      readNotice = `Visar de ${rows.length} senast uppdaterade noteringarna — minnet har fler rader.`;
    }
    memoryItems = rows.map((m) => {
      const editor = m.expand?.updated_by;
      const { category, categorySource } = resolveAgentMemoryCategory({
        category: m.category,
        key: m.key,
        content: m.content
      });
      return {
        id: m.id,
        key: m.key,
        content: m.content,
        category,
        categorySource,
        scoped: Boolean(m.startup),
        scopeLabel: m.startup ? m.expand?.startup?.name || 'Bolag' : 'Hela tenanten',
        updatedAt: m.updated,
        updatedBy: editor?.display_name?.trim() || editor?.email || ''
      };
    });
  } catch (error) {
    console.error('[installningar/ai-minne] failed to load agent_memory', {
      tenant: user.tenant,
      error
    });
    readNotice = 'Kunde inte läsa AI-minnet just nu. Försök ladda om sidan.';
  }
  try {
    const s = await pb.collection('startups').getList<{ id: string; name: string }>(1, 200, {
      filter: pb.filter('tenant = {:t}', { t: user.tenant }),
      sort: 'name',
      fields: 'id,name'
    });
    startupOptions = s.items.map((it) => ({ id: it.id, name: it.name }));
  } catch {
    /* scope-väljaren faller tillbaka på bara tenant-brett */
  }

  const inferredCount = memoryItems.filter((m) => m.categorySource === 'inferred').length;
  const categoriesInUse = new Set(memoryItems.map((m) => m.category)).size;

  return (
    <SettingsSectionPage
      slug="ai-minne"
      roles={user.roles}
      intro="När du rättar AI-chatten sparar den slutsatsen här och tar med den i framtida samtal (per tenant). Noteringarna är sorterade i kategorier så att du ser vad chatten lärt sig om terminologi, datatolkning, arbetssätt, bolag, portfölj och processer. Redigera en notering om den blev fel, ta bort den, eller lägg till en bestående regel manuellt."
      actions={
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-canvas-muted px-3 py-1 text-[11px] font-medium text-foreground-subtle mx-tnum">
            {memoryItems.length} {memoryItems.length === 1 ? 'notering' : 'noteringar'}
          </span>
          {memoryItems.length > 0 && (
            <span className="rounded-full bg-canvas-muted px-3 py-1 text-[11px] font-medium text-foreground-subtle mx-tnum">
              {categoriesInUse} av {AGENT_MEMORY_CATEGORIES.length} kategorier
            </span>
          )}
        </span>
      }
    >
      <div className="max-w-3xl rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 dark:border-movexum-bla/40 dark:bg-movexum-bla/10">
        <p className="text-xs text-movexum-djupbla dark:text-movexum-bla">
          Minnet får bara innehålla generella regler och slutsatser — aldrig personuppgifter.
          Det syns för all Movexum-personal i din tenant.
        </p>
      </div>
      {readNotice && (
        <p className="max-w-3xl rounded-2xl bg-movexum-pastell-gul px-4 py-3 text-xs text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          {readNotice}
        </p>
      )}
      <AgentMemoryManager
        items={memoryItems}
        startups={startupOptions}
        initialCategory={initialCategory}
        inferredCount={inferredCount}
      />
    </SettingsSectionPage>
  );
}
