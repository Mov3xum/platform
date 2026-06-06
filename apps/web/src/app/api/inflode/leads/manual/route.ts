import { NextResponse } from 'next/server';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createLead } from '@/lib/compass/store';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

export async function POST(request: Request) {
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
    return NextResponse.redirect(new URL('/inflode/leads/new', request.url));
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
    return NextResponse.redirect(new URL('/inflode/leads/new', request.url));
  }

  return NextResponse.redirect(new URL(`/inflode/leads/${lead.id}`, request.url));
}
