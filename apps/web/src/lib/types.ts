export type {
  Role,
  StartupPhase,
  TenantType,
  Tenant,
  UserProfile,
  Startup,
  Partner,
  ModuleDefinition
} from '@platform/shared';

export { ALL_ROLES, ALL_PHASES, coreModules } from '@platform/shared';

export interface ModuleCardProps {
  title: string;
  description: string;
  route: string;
}
