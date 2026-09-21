import { getServerPb } from '@/lib/auth.server';
import {
  AgentMemoryManager,
  type AgentMemoryItem,
  type StartupOption
} from '../AgentMemoryManager';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

export default async function AiMinnePage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();

  // AI-minne (agent_memory, § 16.4) — läses via användarens auth-token → RLS
  // (staff-only, tenant-scope) gäller.
  let memoryItems: AgentMemoryItem[] = [];
  let startupOptions: StartupOption[] = [];
  try {
    const mem = await pb.collection('agent_memory').getList<{
      id: string;
      key: string;
      content: string;
      startup?: string;
      updated: string;
      expand?: {
        startup?: { name?: string };
        updated_by?: { display_name?: string; email?: string };
      };
    }>(1, 200, {
      filter: pb.filter('tenant = {:t}', { t: user.tenant }),
      sort: '-updated',
      expand: 'startup,updated_by'
    });
    memoryItems = mem.items.map((m) => {
      const editor = m.expand?.updated_by;
      return {
        id: m.id,
        key: m.key,
        content: m.content,
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

  return (
    <SettingsSectionPage
      slug="ai-minne"
      roles={user.roles}
      intro="När du rättar AI-chatten sparar den slutsatsen här och tar med den i framtida samtal (per tenant). Redigera en notering om den blev fel, ta bort den, eller lägg till en bestående regel manuellt."
      actions={
        <span className="rounded-full bg-canvas-muted px-3 py-1 text-[11px] font-medium text-foreground-subtle">
          {memoryItems.length} {memoryItems.length === 1 ? 'notering' : 'noteringar'}
        </span>
      }
    >
      <div className="max-w-3xl rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 dark:border-movexum-bla/40 dark:bg-movexum-bla/10">
        <p className="text-xs text-movexum-djupbla dark:text-movexum-bla">
          Minnet får bara innehålla generella regler och slutsatser — aldrig personuppgifter.
          Det syns för all Movexum-personal i din tenant.
        </p>
      </div>
      <AgentMemoryManager items={memoryItems} startups={startupOptions} />
    </SettingsSectionPage>
  );
}
