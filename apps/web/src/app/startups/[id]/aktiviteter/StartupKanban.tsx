'use client';

import { TaskKanban } from '@/components/kanban/TaskKanban';
import {
  createStartupBoardTaskAction,
  moveStartupBoardTaskAction,
  setTaskAssigneesAction
} from '@/lib/actions/tasks';
import type { StartupBoardTask } from '@/lib/startup-board/board';
import type { AssignableResource } from '@/lib/assignments/types';

// Bolagskanbanen (CLAUDE.md § 15.7) — tunn wrapper som binder bolagets
// server actions till den delade TaskKanban-tavlan (ingen divergerande kopia).

export function StartupKanban({
  startupId,
  tasks,
  resources,
  canManage
}: {
  startupId: string;
  tasks: StartupBoardTask[];
  resources: AssignableResource[];
  canManage: boolean;
}) {
  return (
    <TaskKanban
      tasks={tasks}
      resources={resources}
      canManage={canManage}
      actions={{
        onCreate: (input) => createStartupBoardTaskAction({ startupId, ...input }),
        onMove: (taskId, status) => moveStartupBoardTaskAction(taskId, status),
        onAssign: (taskId, ids) => setTaskAssigneesAction(taskId, ids)
      }}
    />
  );
}
