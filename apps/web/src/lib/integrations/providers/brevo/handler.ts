import 'server-only';
import type { IntegrationHandler, NormalizedRecord } from '../../types';
import { IntegrationFetchError } from '../../http';
import {
  createBrevoClient,
  type BrevoAccount,
  type BrevoCampaignsResponse,
  type BrevoListsResponse
} from './client';
import { normalizeCampaign, normalizeList } from './normalize';

const SYNC_LIST_LIMIT = 50;
const SYNC_CAMPAIGN_LIMIT = 50;

export const brevoHandler: IntegrationHandler = {
  slug: 'brevo',
  residency: 'Frankrike (EU)',
  riskClass: 'minimal',
  complianceNote:
    'Brevo lagrar e-postadresser i Frankrike. Vi synkar endast aggregerade metrics — inga adresser eller namn lagras i plattformen.',
  credentialFields: [
    {
      key: 'api_key',
      label: 'Brevo API-nyckel',
      type: 'password',
      required: true,
      help: 'Skapas under Brevo → SMTP & API → API-nycklar. Behöver scope för Contacts och Campaigns.'
    }
  ],

  async testConnection(creds) {
    const apiKey = creds.api_key?.trim();
    if (!apiKey) return { ok: false, error: 'API-nyckel saknas.' };
    try {
      const client = createBrevoClient(apiKey);
      await client<BrevoAccount>('/account');
      return { ok: true };
    } catch (err) {
      if (err instanceof IntegrationFetchError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, error: 'API-nyckeln avvisades av Brevo (401/403).' };
        }
        return { ok: false, error: `Brevo svarade ${err.status}.` };
      }
      return { ok: false, error: 'Kunde inte nå Brevo (nätverksfel).' };
    }
  },

  async sync(creds) {
    const apiKey = creds.api_key?.trim();
    if (!apiKey) throw new Error('API-nyckel saknas.');
    const client = createBrevoClient(apiKey);
    const records: NormalizedRecord[] = [];

    const lists = await client<BrevoListsResponse>('/contacts/lists', {
      query: { limit: SYNC_LIST_LIMIT, offset: 0 }
    });
    for (const list of lists.lists ?? []) {
      records.push(normalizeList(list));
    }

    const campaigns = await client<BrevoCampaignsResponse>('/emailCampaigns', {
      query: {
        type: 'classic',
        status: 'sent',
        limit: SYNC_CAMPAIGN_LIMIT,
        offset: 0
      }
    });
    for (const campaign of campaigns.campaigns ?? []) {
      records.push(normalizeCampaign(campaign));
    }

    return records;
  }
};
