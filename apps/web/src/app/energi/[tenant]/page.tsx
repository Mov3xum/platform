import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SparkPublicLanding } from '@/components/spark/PublicLanding';
import { resolveSparkReferrer, resolveSparkTenant } from '@/lib/spark/public.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SPARK — energimatchning',
  description: 'Berätta om era energiutmaningar, er lösning eller er testmiljö. Movexum matchar behov med lösningar i regionen.'
};

/** SPARK:s publika anmälan (§ 61). `?via=` pekar ut partnern som spred länken. */
export default async function SparkPublicPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ via?: string }> }) {
  const [{ tenant: slug }, { via }] = await Promise.all([params, searchParams]);
  const tenant = await resolveSparkTenant(slug);
  if (!tenant) notFound();
  const referrer = await resolveSparkReferrer(tenant.id, via);
  return <SparkPublicLanding tenantName={tenant.name} endpoint={`/api/public/energi/${tenant.slug}`} via={referrer?.id} referrerLabel={referrer?.label} />;
}
