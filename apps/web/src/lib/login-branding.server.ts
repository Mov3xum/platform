import 'server-only';
import { cache } from 'react';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_LOGIN_BRANDING,
  missingLoginBrandingFields,
  normalizeLoginBranding,
  type LoginBranding,
  type LoginBrandingField
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { toLoginBrandingView, type LoginBrandingView } from '@/lib/login-branding';

// Inloggningssidans utseende (CLAUDE.md § 48) — enda läsvägen.
//
// /login är oinloggad: det finns ingen session och därmed ingen tenant i
// requesten. Sidan visar därför utseendet för DEN tenant deployen resolvar
// (`resolveLoginBrandingTenant`): env `MOVEXUM_LOGIN_TENANT_SLUG` →
// seed-tenanten `movexum` → äldsta tenanten. En Movexum-deploy har i praktiken
// en inkubator-tenant, så admins val gäller för alla som loggar in.
// Läsningen sker via den cachade superusern (tenants list/view kräver auth)
// och delas per request via React `cache`. Fail-soft: utan superuser eller
// vid läsfel renderas standardutseendet — sidan blir aldrig 500.

export interface TenantLoginBrandingRow {
  id: string;
  name?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface TenantLoginBranding {
  tenantId: string;
  branding: LoginBranding;
  view: LoginBrandingView;
  /** Fält som saknas i det deployade PB-schemat (migration 1700000172 inte körd). */
  schemaMissing: LoginBrandingField[];
}

export function tenantLoginBrandingFromRecord(record: TenantLoginBrandingRow): TenantLoginBranding {
  const branding = normalizeLoginBranding(record);
  return {
    tenantId: record.id,
    branding,
    view: toLoginBrandingView(record.id, branding),
    schemaMissing: missingLoginBrandingFields(record)
  };
}

/** Läser en tenants inloggningsutseende med den givna klienten (t.ex. användarens token). */
export async function loadTenantLoginBranding(
  pb: PocketBase,
  tenantId: string
): Promise<TenantLoginBranding | null> {
  try {
    const record = await pb.collection('tenants').getOne<TenantLoginBrandingRow>(tenantId);
    return tenantLoginBrandingFromRecord(record);
  } catch {
    return null;
  }
}

export const LOGIN_TENANT_SLUG_ENV = 'MOVEXUM_LOGIN_TENANT_SLUG';

const TENANT_SLUG_RE = /^[a-z0-9-]{2,64}$/;

/**
 * Vilken tenant inloggningssidan visar. Deterministisk: env-slug (om satt och
 * giltig) → `movexum` → äldsta tenanten. Returnerar null utan superuser
 * eller när inga tenants finns.
 */
export const resolveLoginBrandingTenant = cache(
  async (): Promise<TenantLoginBrandingRow | null> => {
    const su = await getSuperuserPb();
    if (!su.ok) return null;
    const envSlug = (process.env[LOGIN_TENANT_SLUG_ENV] || '').trim().toLowerCase();
    const candidates = [envSlug, 'movexum'].filter((s) => TENANT_SLUG_RE.test(s));
    for (const slug of candidates) {
      try {
        return await su.pb
          .collection('tenants')
          .getFirstListItem<TenantLoginBrandingRow>(su.pb.filter('slug = {:slug}', { slug }));
      } catch {
        // prova nästa
      }
    }
    try {
      const page = await su.pb
        .collection('tenants')
        .getList<TenantLoginBrandingRow>(1, 1, { sort: 'created' });
      return page.items[0] ?? null;
    } catch {
      try {
        // Instans utan autodate på tenants (äldre schema): osorterat.
        const page = await su.pb.collection('tenants').getList<TenantLoginBrandingRow>(1, 1);
        return page.items[0] ?? null;
      } catch {
        return null;
      }
    }
  }
);

/** Utseendet /login renderar. Alltid ett värde — standard vid fel. */
export const loadPublicLoginBranding = cache(async (): Promise<TenantLoginBranding> => {
  const row = await resolveLoginBrandingTenant();
  if (!row) {
    return {
      tenantId: '',
      branding: { ...DEFAULT_LOGIN_BRANDING },
      view: toLoginBrandingView('', DEFAULT_LOGIN_BRANDING),
      schemaMissing: []
    };
  }
  return tenantLoginBrandingFromRecord(row);
});

/**
 * Sann när admins egen tenant är den som /login visar. Editorn varnar
 * annars — ändringarna sparas men syns inte på inloggningssidan.
 */
export async function isLoginBrandingTenant(tenantId: string): Promise<boolean | null> {
  const row = await resolveLoginBrandingTenant();
  if (!row) return null;
  return row.id === tenantId;
}
