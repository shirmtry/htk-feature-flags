import { redirect } from 'next/navigation';
import { Workspace } from '@/components/Workspace';
import { getUser } from '@/lib/auth';

export default async function WorkspacePage() {
  const user = await getUser();
  if (!user) redirect('/login');
  return <Workspace user={user} />;
}
