'use client';

import { TaskKanban } from '@/components/kanban/TaskKanban';
import {
  createMissionBoardTaskAction,
  moveMissionBoardTaskAction,
  setTaskAssigneesAction
} from '@/lib/actions/tasks';
import type { StartupBoardTask } from '@/lib/startup-board/board';
import type { AssignableResource } from '@/lib/assignments/types';

// Uppdragskanbanen (CLAUDE.md § 29) — tunn wrapper som binder uppdragets
// server actions till den delade TaskKanban-tavlan (ingen divergerande kopia).

export function MissionTaskBoard({
  missionId,
  tasks,
  resources,
  canManage
}: {
  missionId: string;
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
        onCreate: (input) => createMissionBoardTaskAction({ missionId, ...input }),
        onMove: (taskId, status) => moveMissionBoardTaskAction(taskId, status),
        onAssign: (taskId, ids) => setTaskAssigneesAction(taskId, ids)
      }}
    />
  );
}
