/**
 * Route "/parcel/[pk]" — Property Deep-Dive (PRD §7.2). Server component:
 * resolves the parcel bundle (mock ParcelDeepDive today; GET /api/parcel/:pk
 * tomorrow) and hands it to the client <DeepDive> for the interactive teach-
 * rail / drawer / distress decomposition.
 */
import type { Metadata } from 'next';
import { DeepDive } from './DeepDive';
import { getDeepDive } from '../../../lib/mock/parcel';

interface PageProps {
  params: Promise<{ pk: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pk } = await params;
  const data = getDeepDive(pk);
  return {
    title: `${data.parcel.address} · OPA ${data.parcel.parcel_pk} — PhillyBricks`,
    description: `Parcel deep-dive for ${data.parcel.address}: assessment vs. sale, sale history, permits & violations, taxes, comps + value estimate, and a decomposable distress score — every figure sourced to the public record.`,
  };
}

export default async function Page({ params }: PageProps) {
  const { pk } = await params;
  const data = getDeepDive(pk);
  return <DeepDive data={data} />;
}
