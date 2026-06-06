import { NextResponse } from 'next/server';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createLead } from '@/lib/compass/store';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!hasRole(user.roles, [...STAFF_ROLES])) {
      return NextResponse.redirect(new URL('/inflode', request.url));
    }

    const formData = await request.formData();
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim() || undefined;
    const phone = String(formData.get('phone') || '').trim() || undefined;
    const organization = String(formData.get('organization') || '').trim() || undefined;
    const idea = String(formData.get('idea_summary') || '').trim() || undefined;
    const source = String(formData.get('source_key') || 'call');

    if (!name) {
      return redirectWithError(request, 'missing_name');
    }

    const pb = await getServerPb();
    const lead = await createLead(pb, user.tenant, {
      name,
      email,
      phone,
      organization,
      idea_summary: idea,
      source_key: source
    });

    if (!lead) {
      return redirectWithError(request, 'creation_failed');
    }

    return NextResponse.redirect(new URL(`/inflode/leads/${lead.id}`, request.url));
  } catch (error) {
    console.error('Manual lead creation failed', {
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    return redirectWithError(request, 'creation_failed');
  }
}

function redirectWithError(request: Request, error: 'missing_name' | 'creation_failed') {
  return NextResponse.redirect(new URL(`/inflode/leads/new?error=${error}`, request.url));
}
