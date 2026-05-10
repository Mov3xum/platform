export type {
  Role,
  StartupPhase,
  TenantType,
  Tenant,
  UserProfile,
  Startup,
  Partner,
  ModuleDefinition,
  ToolCategory,
  ToolModel,
  ToolOutputFormat,
  ToolRunStatus,
  Tool,
  ToolRun,
  WorkshopStatus,
  WorkshopAudience,
  WorkshopBlockType,
  WorkshopBlock,
  Workshop,
  WorkshopAssignmentStatus,
  WorkshopAssignment,
  WorkshopRunStatus,
  WorkshopRun
} from '@platform/shared';

export { ALL_ROLES, ALL_PHASES, coreModules } from '@platform/shared';

export interface ModuleCardProps {
  title: string;
  description: string;
  route: string;
}
