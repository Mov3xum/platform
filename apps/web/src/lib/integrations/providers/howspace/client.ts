import 'server-only';
import { createFetchClient } from '../../http';

const HOWSPACE_BASE_URL = 'https://api.howspace.com/v1';

export function createHowspaceClient(apiToken: string) {
  return createFetchClient(HOWSPACE_BASE_URL, {
    Authorization: `Bearer ${apiToken}`
  });
}

export interface HowspaceWorkspace {
  id: string;
  name: string;
  description?: string;
  status?: string;
  participantCount?: number;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

export interface HowspaceWorkspaceList {
  workspaces?: HowspaceWorkspace[];
  data?: HowspaceWorkspace[];
}

export interface HowspaceParticipantStats {
  total?: number;
  active?: number;
}

export interface HowspaceMe {
  id?: string;
  email?: string;
  organizationName?: string;
}
