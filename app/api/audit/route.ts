import { getUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { fail, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xem audit log.');
  if (user.role !== 'admin') return fail(403, 'forbidden', 'Chỉ admin được xem audit log.');

  const db = await getDb();
  const result = await db.query<{
    actor: string;
    action: string;
    detail: Record<string, unknown>;
    created_at: string;
  }>('select actor, action, detail, created_at from audit_logs order by created_at desc limit 50');

  return Response.json({ logs: result.rows });
});
