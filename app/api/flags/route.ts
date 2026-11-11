import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { getDb, saveState } from '@/lib/db';
import { createFlag, listFlags } from '@/lib/flags';
import { fail, route } from '@/lib/http';
import { hitLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.array(z.string().trim().min(1).max(64)).max(50);

const flagSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,49}$/, 'Key chỉ gồm a-z, 0-9 và dấu gạch ngang (2-50 ký tự)'),
  name: z.string().trim().min(2, 'Tên cần ít nhất 2 ký tự').max(80),
  description: z.string().trim().max(280).default(''),
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
  targetUsers: listSchema.default([]),
  targetTenants: listSchema.default([]),
});

function uniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}

export const GET = route(async () => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để xem feature flags.');
  const db = await getDb();
  const flags = await listFlags(db);
  return Response.json({
    flags,
    role: user.role,
    canManage: user.role === 'admin',
    serverTime: new Date().toISOString(),
  });
});

export const POST = route(async (req) => {
  const user = await getUser();
  if (!user) return fail(401, 'unauthorized', 'Cần đăng nhập để tạo flag.');
  if (user.role !== 'admin') return fail(403, 'forbidden', 'Chỉ admin được tạo flag.');

  const limit = await hitLimit(`flag-create:${user.id}`, 20, 60);
  if (!limit.ok) {
    return fail(429, 'rate_limited', 'Quá nhiều thao tác tạo flag. Thử lại sau.', {
      'Retry-After': String(limit.retryAfter),
    });
  }

  const parsed = flagSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Dữ liệu không hợp lệ');
  }

  const db = await getDb();
  const existing = await db.query('select id from flags where key = $1', [parsed.data.key]);
  if (existing.rows.length) return fail(409, 'key_taken', 'Key này đã tồn tại.');

  try {
    const flag = await createFlag(db, parsed.data, user);
    await saveState();
    return Response.json({ flag }, { status: 201 });
  } catch (error) {
    if (uniqueViolation(error)) return fail(409, 'key_taken', 'Key này đã tồn tại.');
    throw error;
  }
});
