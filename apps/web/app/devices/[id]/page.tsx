import { DeviceDashboard } from '@/components/DeviceDashboard';

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeviceDashboard deviceId={id} />;
}
