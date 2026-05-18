import 'server-only';
import { createFetchClient } from '../../http';

const BREVO_BASE_URL = 'https://api.brevo.com/v3';

export function createBrevoClient(apiKey: string) {
  return createFetchClient(BREVO_BASE_URL, {
    'api-key': apiKey
  });
}

export interface BrevoList {
  id: number;
  name: string;
  totalSubscribers?: number;
  totalBlacklisted?: number;
  folderId?: number;
  createdAt?: string;
}

export interface BrevoListsResponse {
  lists?: BrevoList[];
  count?: number;
}

export interface BrevoCampaign {
  id: number;
  name: string;
  subject?: string;
  type?: string;
  status?: string;
  createdAt?: string;
  modifiedAt?: string;
  sentDate?: string;
  statistics?: {
    globalStats?: {
      sent?: number;
      delivered?: number;
      uniqueViews?: number;
      viewed?: number;
      uniqueClicks?: number;
      clickers?: number;
      hardBounces?: number;
      softBounces?: number;
      unsubscriptions?: number;
    };
  };
}

export interface BrevoCampaignsResponse {
  campaigns?: BrevoCampaign[];
  count?: number;
}

export interface BrevoAccount {
  email?: string;
  companyName?: string;
  plan?: Array<{ type?: string; credits?: number }>;
}
